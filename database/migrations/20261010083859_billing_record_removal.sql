-- NEW APP ONLY. Deploy the version-2/3 compatible client FIRST, then apply.
-- Add reversible record removal; never DELETE a financial row or its source.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS(
    SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN
    RAISE EXCEPTION 'Wrong project: record removal is for the new application only';
  END IF;
END $$;
CREATE TEMP TABLE removal_migration_baseline ON COMMIT DROP AS
 SELECT md5(coalesce(jsonb_agg(to_jsonb(u) ORDER BY id),'[]')::text) units_hash FROM public.billing_units u;
ALTER TABLE removal_migration_baseline ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON removal_migration_baseline FROM PUBLIC,anon,authenticated;

ALTER TABLE public.billing_units ADD COLUMN removed_at timestamptz, ADD COLUMN removal_reason text;
ALTER TABLE public.billing_units ADD CONSTRAINT billing_unit_removal_valid CHECK (
  removed_at IS NULL AND removal_reason IS NULL OR removed_at IS NOT NULL AND removal_reason IS NOT NULL
  AND length(trim(removal_reason)) BETWEEN 1 AND 1000 AND lifecycle IN ('issued','received')
  AND (issued_on IS NOT NULL OR received_on IS NOT NULL));

-- All removed facts are immutable. Only the private remove/restore transaction
-- can switch the flag; even it may not alter dates, payer, period or amounts.
CREATE FUNCTION public.guard_billing_record_removal() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
  IF NEW.removed_at IS DISTINCT FROM OLD.removed_at OR NEW.removal_reason IS DISTINCT FROM OLD.removal_reason THEN
    IF current_setting('ageful.billing_record_removal',true) IS DISTINCT FROM 'yes'
      OR (to_jsonb(NEW)-ARRAY['removed_at','removal_reason','revision','updated_at']) IS DISTINCT FROM
         (to_jsonb(OLD)-ARRAY['removed_at','removal_reason','revision','updated_at']) THEN
      RAISE EXCEPTION '削除・復元は専用操作で行ってください。元の記録は変更しません';
    END IF;
  ELSIF OLD.removed_at IS NOT NULL THEN
    RAISE EXCEPTION '削除済みの記録は編集できません。先に復元してください';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_billing_record_removal() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER billing_record_removal_guard BEFORE UPDATE ON public.billing_units
FOR EACH ROW EXECUTE FUNCTION public.guard_billing_record_removal();

CREATE FUNCTION public.write_billing_record_removal(p_key uuid,v jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); uid bigint; expected integer; target bigint; mode_value text; fingerprint text;
  op public.billing_operations%ROWTYPE; old_unit public.billing_units%ROWTYPE; new_unit public.billing_units%ROWTYPE; result jsonb;
BEGIN
  PERFORM public.assert_billing_runtime_access();
  IF p_key IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR NOT(v ?& ARRAY['unitId','revision','mode','reason'])
    OR (SELECT count(*) FROM jsonb_object_keys(v))<>4
    OR jsonb_typeof(v->'unitId') IS DISTINCT FROM 'number' OR (v->>'unitId') !~ '^[1-9][0-9]*$'
    OR jsonb_typeof(v->'revision') IS DISTINCT FROM 'number' OR (v->>'revision') !~ '^[0-9]+$'
    OR jsonb_typeof(v->'mode') IS DISTINCT FROM 'string' OR v->>'mode' NOT IN ('remove','restore')
    OR jsonb_typeof(v->'reason') IS DISTINCT FROM 'string' OR length(trim(v->>'reason')) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION '対象の記録・削除状態・理由を確認してください';
  END IF;
  uid:=(v->>'unitId')::bigint; expected:=(v->>'revision')::integer; mode_value:=v->>'mode';
  SELECT project_id INTO STRICT target FROM public.billing_units WHERE id=uid;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','record_removal','value',v,'actor',actor)::text,'UTF8')),'hex');
  INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
    VALUES(p_key,'correction',target,fingerprint,actor) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_key FOR UPDATE;
  IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION '同じ操作IDで内容は変更できません'; END IF;
  IF op.completed_at IS NOT NULL THEN
    SELECT after_value INTO STRICT result FROM public.billing_unit_events WHERE operation_key=p_key AND billing_unit_id=uid;
    RETURN result; -- exact prior receipt, not a replay against later state
  END IF;
  PERFORM id FROM public.projects WHERE id=target FOR UPDATE;
  PERFORM id FROM public.billing_recipient_plans WHERE project_id=target ORDER BY id FOR UPDATE;
  SELECT * INTO STRICT old_unit FROM public.billing_units WHERE id=uid FOR UPDATE;
  IF old_unit.revision<>expected THEN RAISE EXCEPTION '記録が更新されています。画面を読み込み直して確認してください'; END IF;
  IF old_unit.lifecycle NOT IN ('issued','received') OR (old_unit.issued_on IS NULL AND old_unit.received_on IS NULL) THEN
    RAISE EXCEPTION '削除できるのは請求・入金実績のある記録です。予定の取りやめとは別の操作です'; END IF;
  IF (mode_value='remove') IS DISTINCT FROM (old_unit.removed_at IS NULL) THEN
    RAISE EXCEPTION '削除状態が変わっています。画面を読み込み直してください'; END IF;
  PERFORM set_config('ageful.billing_record_removal','yes',true);
  UPDATE public.billing_units SET
    removed_at=CASE WHEN mode_value='remove' THEN clock_timestamp() ELSE NULL END,
    removal_reason=CASE WHEN mode_value='remove' THEN trim(v->>'reason') ELSE NULL END,
    revision=revision+1 WHERE id=uid RETURNING * INTO new_unit;
  PERFORM set_config('ageful.billing_record_removal','no',true);
  INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,reason,before_value,after_value,actor_user_id)
    VALUES(target,uid,p_key,'corrected',trim(v->>'reason'),to_jsonb(old_unit),to_jsonb(new_unit),actor);
  UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_key;
  RETURN to_jsonb(new_unit);
END $$;
REVOKE ALL ON FUNCTION public.write_billing_record_removal(uuid,jsonb) FROM PUBLIC,anon,authenticated;

-- Preserve existing helper definitions/privileges. Change only period-evidence
-- loops, NEVER the all-unit revision CAS or the same-identity duplicate guard.
-- Fail closed if deployed code does not contain the expected exact fragment once.
DO $$ DECLARE f text; old_fragment text; new_fragment text; body text; patch text[]; BEGIN
  FOREACH patch SLICE 1 IN ARRAY ARRAY[
    ARRAY['public.create_future_schedule(uuid,bigint,jsonb,jsonb,bigint,jsonb,text)',
      'FOR saved IN SELECT * FROM public.billing_units WHERE project_id=p_project LOOP',
      'FOR saved IN SELECT * FROM public.billing_units WHERE project_id=p_project AND removed_at IS NULL LOOP'],
    ARRAY['public.set_billing_service_period(uuid,bigint,jsonb,jsonb,integer,date,date,text)',
      'WHERE project_id=p_project AND service_year=p_year) THEN',
      'WHERE project_id=p_project AND service_year=p_year AND removed_at IS NULL) THEN'],
    ARRAY['public.set_billing_service_period(uuid,bigint,jsonb,jsonb,integer,date,date,text)',
      'WHERE project_id=p_project AND service_year<>p_year LOOP',
      'WHERE project_id=p_project AND service_year<>p_year AND removed_at IS NULL LOOP'],
    ARRAY['public.set_billing_service_period(uuid,bigint,jsonb,jsonb,integer,date,date,text)',
      'WHERE project_id=p_project AND service_year=p_year ORDER BY id LOOP',
      'WHERE project_id=p_project AND service_year=p_year AND removed_at IS NULL ORDER BY id LOOP'],
    ARRAY['public.write_billing_cycle_rule(uuid,jsonb)',
      'FOR u IN SELECT * FROM public.billing_units WHERE project_id=p ORDER BY id LOOP',
      'FOR u IN SELECT * FROM public.billing_units WHERE project_id=p AND removed_at IS NULL ORDER BY id LOOP']
  ] LOOP
    f:=patch[1];old_fragment:=patch[2];new_fragment:=patch[3];body:=pg_get_functiondef(f::regprocedure);
    IF (length(body)-length(replace(body,old_fragment,'')))/length(old_fragment)<>1 THEN
      RAISE EXCEPTION 'Deployed helper differs: %; inspect before migrating',f; END IF;
    EXECUTE replace(body,old_fragment,new_fragment);
  END LOOP;
END $$;

ALTER FUNCTION public.billing_runtime_write(uuid,jsonb) RENAME TO billing_runtime_write_before_removal;
REVOKE ALL ON FUNCTION public.billing_runtime_write_before_removal(uuid,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.billing_runtime_write(p_key uuid,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
  PERFORM public.assert_billing_runtime_access();
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR NOT(p_request ?& ARRAY['action','value'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_request))<>2 OR jsonb_typeof(p_request->'value') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '保存要求の形式が不正です'; END IF;
  IF p_request->>'action'='record_removal' THEN RETURN public.write_billing_record_removal(p_key,p_request->'value'); END IF;
  RETURN public.billing_runtime_write_before_removal(p_key,p_request);
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_write(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_runtime_write(uuid,jsonb) TO authenticated;

ALTER FUNCTION public.billing_runtime_snapshot() RENAME TO billing_runtime_snapshot_before_removal;
REVOKE ALL ON FUNCTION public.billing_runtime_snapshot_before_removal() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.billing_runtime_snapshot() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
  -- Keep tombstones in the authorized reader for CAS, identity and restoration.
  -- Old version-2 clients reject this response instead of counting removed receipts.
  RETURN public.billing_runtime_snapshot_before_removal()||jsonb_build_object('version',3,'record_removal_ready',true);
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_runtime_snapshot() TO authenticated;

DO $$ BEGIN
  IF (SELECT units_hash FROM removal_migration_baseline) IS DISTINCT FROM
    (SELECT md5(coalesce(jsonb_agg(to_jsonb(u)-ARRAY['removed_at','removal_reason'] ORDER BY id),'[]')::text) FROM public.billing_units u) THEN
    RAISE EXCEPTION 'Business data changed during additive migration'; END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
