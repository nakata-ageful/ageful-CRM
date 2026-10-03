-- New application only. No existing business rows are modified; old facade bodies
-- remain private helpers. Run this migration BEFORE deploying the new client.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.ageful_migration_target)<>1
    OR NOT EXISTS(SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN
    RAISE EXCEPTION 'Wrong project: billing cycle rules are for the new application only';
  END IF;
END $$;

CREATE TEMP TABLE cycle_migration_baseline(table_name text PRIMARY KEY,hash text) ON COMMIT DROP;
ALTER TABLE cycle_migration_baseline ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON cycle_migration_baseline FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; h text; BEGIN
  FOREACH t IN ARRAY ARRAY['customers','projects','contracts','annual_records','maintenance_responses','periodic_maintenance','prospects','attachments',
    'billing_units','billing_operations','billing_recipient_plans','billing_recipient_plan_overrides','billing_unit_events','ownership_transfers',
    'invoice_import_evidence','invoice_recipient_initializations','billing_migration_acceptances','billing_runtime_control','project_management_events'] LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb)::text) FROM public.%I r',t) INTO h;
    INSERT INTO cycle_migration_baseline VALUES(t,h);
  END LOOP;
END $$;

CREATE TABLE public.billing_cycle_rules(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES public.projects(id),
  effective_year integer NOT NULL CHECK(effective_year BETWEEN 2001 AND 2199),
  mode text NOT NULL CHECK(mode IN ('calendar_prepaid','anniversary')),
  before_value jsonb,
  reason text NOT NULL CHECK(length(trim(reason))>0),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_user_id uuid NOT NULL,
  operation_key uuid NOT NULL UNIQUE REFERENCES public.billing_operations(operation_key)
);
CREATE INDEX billing_cycle_rule_lookup ON public.billing_cycle_rules(project_id,effective_year DESC,id DESC);
ALTER TABLE public.billing_cycle_rules ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_cycle_rules FROM PUBLIC,anon,authenticated;
REVOKE ALL ON SEQUENCE public.billing_cycle_rules_id_seq FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.guard_billing_cycle_rule_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
  RAISE EXCEPTION '繰り返し設定の履歴は変更・削除できません。新しい設定を追加してください';
END $$;
REVOKE ALL ON FUNCTION public.guard_billing_cycle_rule_history() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER billing_cycle_rule_immutable BEFORE UPDATE OR DELETE ON public.billing_cycle_rules
FOR EACH ROW EXECUTE FUNCTION public.guard_billing_cycle_rule_history();
CREATE TRIGGER billing_cycle_rule_no_truncate BEFORE TRUNCATE ON public.billing_cycle_rules
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_billing_cycle_rule_history();

CREATE FUNCTION public.write_billing_cycle_rule(p_key uuid,v jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); p bigint; y integer; mode_value text; expected bigint; fingerprint text;
  op public.billing_operations%ROWTYPE; c public.contracts%ROWTYPE; u public.billing_units%ROWTYPE;
  saved public.billing_cycle_rules%ROWTYPE; previous public.billing_cycle_rules%ROWTYPE;
  versions jsonb; ps date; pe date; first_start date; desired_start date; desired_end date; m integer; d integer;
BEGIN
  PERFORM public.assert_billing_runtime_access();
  IF p_key IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object'
    OR NOT(v ?& ARRAY['projectId','contract','versions','expectedRule','year','mode','reason'])
    OR (SELECT count(*) FROM jsonb_object_keys(v))<>7
    OR jsonb_typeof(v->'projectId') IS DISTINCT FROM 'number' OR jsonb_typeof(v->'year') IS DISTINCT FROM 'number'
    OR jsonb_typeof(v->'expectedRule') IS DISTINCT FROM 'number'
    OR (v->>'projectId')::numeric<>trunc((v->>'projectId')::numeric)
    OR (v->>'year')::numeric<>trunc((v->>'year')::numeric)
    OR (v->>'expectedRule')::numeric<>trunc((v->>'expectedRule')::numeric)
    OR jsonb_typeof(v->'contract') IS DISTINCT FROM 'object' OR jsonb_typeof(v->'versions') IS DISTINCT FROM 'object'
    OR jsonb_typeof(v->'reason') IS DISTINCT FROM 'string' OR length(trim(v->>'reason'))=0
    OR jsonb_typeof(v->'mode') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION '繰り返し設定の入力内容を確認してください'; END IF;
  p:=(v->>'projectId')::bigint; y:=(v->>'year')::integer; expected:=(v->>'expectedRule')::bigint; mode_value:=v->>'mode';
  IF p<1 OR y NOT BETWEEN 2001 AND 2199 OR expected<0 OR mode_value NOT IN ('calendar_prepaid','anniversary') THEN
    RAISE EXCEPTION '適用開始年と繰り返し方法を確認してください'; END IF;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','cycle_rule','value',v,'actor',actor)::text,'UTF8')),'hex');
  INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
    VALUES(p_key,'plan',p,fingerprint,actor) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_key FOR UPDATE;
  IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION '同じ操作IDで内容は変更できません'; END IF;
  IF op.completed_at IS NOT NULL THEN
    SELECT * INTO STRICT saved FROM public.billing_cycle_rules WHERE operation_key=p_key;
    RETURN to_jsonb(saved);
  END IF;
  PERFORM id FROM public.projects WHERE id=p FOR UPDATE;
  IF (SELECT count(*) FROM public.contracts WHERE project_id=p)<>1 THEN RAISE EXCEPTION '発電所の契約を確認してください'; END IF;
  SELECT * INTO STRICT c FROM public.contracts WHERE project_id=p FOR UPDATE;
  IF to_jsonb(c) IS DISTINCT FROM v->'contract' OR c.maintenance_start_date IS NULL THEN RAISE EXCEPTION '契約・当初の保守開始日を再確認してください'; END IF;
  IF (SELECT coalesce(max(id),0) FROM public.billing_cycle_rules WHERE project_id=p) IS DISTINCT FROM expected THEN
    RAISE EXCEPTION '繰り返し設定が更新されています。再確認してください'; END IF;
  IF mode_value='calendar_prepaid' AND (c.billing_method IS DISTINCT FROM '請求書'
    OR coalesce(c.billing_count,jsonb_array_length(to_jsonb(c.billing_schedule_days))) IS DISTINCT FROM 1) THEN
    RAISE EXCEPTION 'この設定は「請求書・年1回」の発電所で利用します'; END IF;
  PERFORM id FROM public.billing_units WHERE project_id=p ORDER BY id FOR UPDATE;
  SELECT coalesce(jsonb_object_agg(id::text,revision),'{}') INTO versions FROM public.billing_units WHERE project_id=p;
  IF versions IS DISTINCT FROM v->'versions' THEN RAISE EXCEPTION '請求記録が更新されています。再確認してください'; END IF;
  m:=extract(month FROM c.maintenance_start_date); d:=extract(day FROM c.maintenance_start_date);
  first_start:=CASE WHEN mode_value='calendar_prepaid' THEN make_date(y,1,1)
    ELSE make_date(y,m,least(d,extract(day FROM (make_date(y,m,1)+interval '1 month -1 day'))::integer)) END;
  FOR u IN SELECT * FROM public.billing_units WHERE project_id=p ORDER BY id LOOP
    ps:=coalesce(u.period_start,make_date(u.service_year,m,least(d,extract(day FROM (make_date(u.service_year,m,1)+interval '1 month -1 day'))::integer)));
    pe:=coalesce(u.period_end,make_date(u.service_year+1,m,least(d,extract(day FROM (make_date(u.service_year+1,m,1)+interval '1 month -1 day'))::integer))-1);
    IF u.service_year<y AND pe>=first_start THEN
      RAISE EXCEPTION '切替前の保守期間が新しい期間と重なります。請求詳細で移行期間の終了日を先に確認・修正してください'; END IF;
    IF u.service_year>=y THEN
      desired_start:=CASE WHEN mode_value='calendar_prepaid' THEN make_date(u.service_year,1,1) ELSE ps END;
      desired_end:=CASE WHEN mode_value='calendar_prepaid' THEN make_date(u.service_year,12,31)
        ELSE make_date(u.service_year+1,m,least(d,extract(day FROM (make_date(u.service_year+1,m,1)+interval '1 month -1 day'))::integer))-1 END;
      IF mode_value='anniversary' THEN desired_start:=make_date(u.service_year,m,least(d,extract(day FROM (make_date(u.service_year,m,1)+interval '1 month -1 day'))::integer)); END IF;
      IF u.period_start IS NULL OR u.period_end IS NULL OR ps<>desired_start OR pe<>desired_end THEN
        RAISE EXCEPTION '%年の保存済み記録の保守期間を先に確認・修正してください。保存済みの期間は自動変更しません',u.service_year; END IF;
    END IF;
  END LOOP;
  SELECT * INTO previous FROM public.billing_cycle_rules WHERE project_id=p AND effective_year<=y ORDER BY effective_year DESC,id DESC LIMIT 1;
  INSERT INTO public.billing_cycle_rules(project_id,effective_year,mode,before_value,reason,actor_user_id,operation_key)
    VALUES(p,y,mode_value,CASE WHEN previous.id IS NULL THEN NULL ELSE to_jsonb(previous)-'before_value' END,trim(v->>'reason'),actor,p_key) RETURNING * INTO saved;
  UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_key;
  RETURN to_jsonb(saved);
END $$;
REVOKE ALL ON FUNCTION public.write_billing_cycle_rule(uuid,jsonb) FROM PUBLIC,anon,authenticated;

-- Preserve every existing mode and its exact implementation; add only one narrow mode.
ALTER FUNCTION public.billing_runtime_write(uuid,jsonb) RENAME TO billing_runtime_write_before_cycles;
REVOKE ALL ON FUNCTION public.billing_runtime_write_before_cycles(uuid,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.billing_runtime_write(p_key uuid,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v jsonb:=p_request->'value'; item jsonb; y integer; pe date; next_rule public.billing_cycle_rules%ROWTYPE; anchor date; cutoff date;
BEGIN
  PERFORM public.assert_billing_runtime_access();
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR NOT(p_request ?& ARRAY['action','value'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_request))<>2 OR jsonb_typeof(v) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '保存要求の形式が不正です'; END IF;
  IF p_request->>'action'='cycle_rule' THEN RETURN public.write_billing_cycle_rule(p_key,v); END IF;
  IF p_request->>'action' IN ('future_schedule','service_period')
    AND NOT EXISTS(SELECT 1 FROM public.billing_operations WHERE operation_key=p_key AND completed_at IS NOT NULL) THEN
    PERFORM id FROM public.projects WHERE id=(v->>'projectId')::bigint FOR UPDATE;
    IF v ? 'cycleRevision' AND (jsonb_typeof(v->'cycleRevision') IS DISTINCT FROM 'number'
      OR (SELECT coalesce(max(id),0) FROM public.billing_cycle_rules WHERE project_id=(v->>'projectId')::bigint) IS DISTINCT FROM (v->>'cycleRevision')::bigint) THEN
      RAISE EXCEPTION '繰り返し設定が更新されています。予定の候補を再確認してください'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(CASE WHEN p_request->>'action'='future_schedule' THEN v->'items' ELSE jsonb_build_array(v) END) LOOP
      y:=(item->>'year')::integer; pe:=(item->>'periodEnd')::date;
      SELECT * INTO next_rule FROM public.billing_cycle_rules WHERE project_id=(v->>'projectId')::bigint AND effective_year<=y+1 ORDER BY effective_year DESC,id DESC LIMIT 1;
      IF next_rule.id IS NOT NULL THEN
        IF next_rule.mode='calendar_prepaid' THEN cutoff:=make_date(y+1,1,1);
        ELSE SELECT maintenance_start_date INTO anchor FROM public.contracts WHERE project_id=(v->>'projectId')::bigint;
          cutoff:=make_date(y+1,extract(month FROM anchor)::integer,least(extract(day FROM anchor)::integer,extract(day FROM (make_date(y+1,extract(month FROM anchor)::integer,1)+interval '1 month -1 day'))::integer)); END IF;
        IF pe>=cutoff THEN RAISE EXCEPTION '繰り返し設定の次の保守期間と重なります。移行期間などの終了日を個別に確認してください'; END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN public.billing_runtime_write_before_cycles(p_key,p_request);
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_write(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_runtime_write(uuid,jsonb) TO authenticated;

ALTER FUNCTION public.billing_runtime_snapshot() RENAME TO billing_runtime_snapshot_before_cycles;
REVOKE ALL ON FUNCTION public.billing_runtime_snapshot_before_cycles() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.billing_runtime_snapshot() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s jsonb; rules jsonb; events jsonb;
BEGIN
  s:=public.billing_runtime_snapshot_before_cycles();
  SELECT coalesce(jsonb_agg(to_jsonb(r)-'before_value' ORDER BY id),'[]') INTO rules FROM public.billing_cycle_rules r;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id','cycle:'||id,'project_id',project_id,'event_type','cycle_rule_changed',
    'recorded_at',recorded_at,'reason',reason,'before_value',before_value,'after_value',to_jsonb(r)-'before_value') ORDER BY id),'[]') INTO events FROM public.billing_cycle_rules r;
  RETURN s||jsonb_build_object('cycle_rules_ready',true,'cycle_rules',rules,'events',coalesce(s->'events','[]')||events);
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_runtime_snapshot() TO authenticated;

ALTER FUNCTION public.billing_runtime_backup() RENAME TO billing_runtime_backup_before_cycles;
REVOKE ALL ON FUNCTION public.billing_runtime_backup_before_cycles() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.billing_runtime_backup() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  RETURN public.billing_runtime_backup_before_cycles()||jsonb_build_object('billing_cycle_rules',
    (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY id),'[]') FROM public.billing_cycle_rules r));
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_backup() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_runtime_backup() TO authenticated;

DO $$ DECLARE b record; h text; BEGIN
  FOR b IN SELECT * FROM cycle_migration_baseline LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb)::text) FROM public.%I r',b.table_name) INTO h;
    IF h IS DISTINCT FROM b.hash THEN RAISE EXCEPTION 'Existing rows changed: %',b.table_name; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.billing_cycle_rules) THEN RAISE EXCEPTION 'Migration must not configure any project automatically'; END IF;
END $$;
NOTIFY pgrst,'reload schema';
COMMIT;
SELECT 'billing_cycle_rules_ready; existing business rows unchanged; no rules applied' AS result;
