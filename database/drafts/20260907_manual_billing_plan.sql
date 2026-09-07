-- Isolated rehearsal only. Saves explicit existing plans, NOT project ownership.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF;
END $$;
ALTER TABLE public.billing_units ADD COLUMN period_start date, ADD COLUMN period_end date,
  ADD COLUMN plan_note text NOT NULL DEFAULT '',
  ADD CHECK ((period_start IS NULL)=(period_end IS NULL)),
  ADD CHECK (period_end>=period_start);

CREATE FUNCTION public.write_manual_billing_plan(p_key uuid,p_project bigint,p_choices jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); fingerprint text; op public.billing_operations%ROWTYPE;
  old_unit public.billing_units%ROWTYPE; new_unit public.billing_units%ROWTYPE;
  active_plan public.billing_recipient_plans%ROWTYPE;
  c jsonb; versions jsonb; expected jsonb; result jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_key IS NULL OR p_project IS NULL OR jsonb_typeof(p_choices) IS DISTINCT FROM 'array'
    OR p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION '予定と確認理由を入力してください'; END IF;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','manual_plan','project',p_project,
    'choices',p_choices,'reason',p_reason,'actor',actor)::text,'UTF8')),'hex');
  INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
    VALUES(p_key,'plan',p_project,fingerprint,actor) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_key FOR UPDATE;
  IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION '同じ操作IDで別の内容は保存できません'; END IF;
  IF op.completed_at IS NOT NULL THEN RETURN jsonb_build_object('operation_key',p_key,'completed',true); END IF;
  PERFORM 1 FROM public.projects WHERE id=p_project FOR UPDATE;
  PERFORM id FROM public.billing_recipient_plans WHERE project_id=p_project ORDER BY id FOR UPDATE;
  SELECT * INTO active_plan FROM public.billing_recipient_plans WHERE project_id=p_project AND retired_at IS NULL;
  IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=p_project AND source_annual_record_id IS NOT NULL) THEN
    RAISE EXCEPTION '移行済み記録との統合は未対応です';
  END IF;
  PERFORM id FROM public.billing_units WHERE project_id=p_project ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=p_project AND lifecycle='review_required') THEN RAISE EXCEPTION '記録要確認の請求があります'; END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(p_choices) LOOP
    IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR NOT(c ?& ARRAY['unitId','expectedRevision','recipientId','method','scheduledDate','plannedAmount','periodStart','periodEnd','note'])
      OR (SELECT count(*) FROM jsonb_object_keys(c))<>9
      OR jsonb_typeof(c->'unitId') IS DISTINCT FROM 'string' OR (c->>'unitId') !~ '^[1-9][0-9]*$'
      OR jsonb_typeof(c->'expectedRevision') IS DISTINCT FROM 'number' OR (c->>'expectedRevision') !~ '^[0-9]+$'
      OR jsonb_typeof(c->'recipientId') IS DISTINCT FROM 'number' OR (c->>'recipientId') !~ '^[1-9][0-9]*$'
      OR jsonb_typeof(c->'method') IS DISTINCT FROM 'string' OR c->>'method' NOT IN ('請求書','口座振替')
      OR jsonb_typeof(c->'scheduledDate') IS DISTINCT FROM 'string' OR (c->>'scheduledDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR jsonb_typeof(c->'note') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION '予定の入力形式を確認してください'; END IF;
    IF c->'plannedAmount'<>'null'::jsonb AND (jsonb_typeof(c->'plannedAmount') IS DISTINCT FROM 'number'
      OR (c->>'plannedAmount') !~ '^[0-9]+$' OR (c->>'plannedAmount')::numeric>9007199254740991) THEN RAISE EXCEPTION '予定額が不正です'; END IF;
    IF (c->'periodStart'='null'::jsonb)<>(c->'periodEnd'='null'::jsonb) THEN RAISE EXCEPTION '対象期間を確認してください'; END IF;
    IF c->'periodStart'<>'null'::jsonb AND (jsonb_typeof(c->'periodStart') IS DISTINCT FROM 'string'
      OR jsonb_typeof(c->'periodEnd') IS DISTINCT FROM 'string' OR (c->>'periodStart') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR (c->>'periodEnd') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN RAISE EXCEPTION '対象期間を確認してください'; END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'unitId') FROM jsonb_array_elements(p_choices))<>jsonb_array_length(p_choices) THEN RAISE EXCEPTION '請求回が重複しています'; END IF;
  SELECT coalesce(jsonb_object_agg(value->>'unitId',value->'expectedRevision'),'{}') INTO expected FROM jsonb_array_elements(p_choices);
  SELECT coalesce(jsonb_object_agg(id::text,revision),'{}') INTO versions FROM public.billing_units WHERE project_id=p_project AND lifecycle='planned';
  IF versions IS DISTINCT FROM expected THEN RAISE EXCEPTION '予定の全件・版を確認し直してください'; END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(p_choices) LOOP
    SELECT * INTO STRICT old_unit FROM public.billing_units WHERE id=(c->>'unitId')::bigint AND project_id=p_project;
    IF old_unit.collection_state NOT IN ('pending','failed') THEN RAISE EXCEPTION '予定の状態を確認してください'; END IF;
    IF old_unit.collection_state='failed' AND ((c->>'recipientId')::bigint IS DISTINCT FROM old_unit.recipient_customer_id
      OR c->>'method'<>'請求書') THEN RAISE EXCEPTION '振替不能は元の請求先の請求書として残してください'; END IF;
    UPDATE public.billing_units SET recipient_customer_id=(c->>'recipientId')::bigint,recipient_plan_id=active_plan.id,
      recipient_source=CASE WHEN active_plan.id IS NULL THEN 'confirmed' WHEN (c->>'recipientId')::bigint=active_plan.default_recipient_customer_id THEN 'default' ELSE 'override' END,
      collection_method=CASE c->>'method' WHEN '請求書' THEN 'invoice' ELSE 'direct_debit' END,
      scheduled_date=(c->>'scheduledDate')::date,planned_amount=(c->>'plannedAmount')::bigint,
      period_start=(c->>'periodStart')::date,period_end=(c->>'periodEnd')::date,plan_note=c->>'note',revision=revision+1
      WHERE id=old_unit.id RETURNING * INTO new_unit;
    IF active_plan.id IS NOT NULL THEN
      DELETE FROM public.billing_recipient_plan_overrides WHERE recipient_plan_id=active_plan.id AND billing_unit_id=old_unit.id;
      IF new_unit.recipient_source='override' THEN
        INSERT INTO public.billing_recipient_plan_overrides(recipient_plan_id,billing_unit_id,project_id,recipient_customer_id)
          VALUES(active_plan.id,new_unit.id,p_project,new_unit.recipient_customer_id);
      END IF;
    END IF;
    INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,before_value,after_value,actor_user_id,reason)
      VALUES(p_project,old_unit.id,p_key,'plan_changed',to_jsonb(old_unit),to_jsonb(new_unit),actor,p_reason);
  END LOOP;
  IF active_plan.id IS NOT NULL THEN UPDATE public.billing_recipient_plans SET revision=revision+1 WHERE id=active_plan.id; END IF;
  UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_key;
  RETURN jsonb_build_object('operation_key',p_key,'completed',true);
END $$;
REVOKE ALL ON FUNCTION public.write_manual_billing_plan(uuid,bigint,jsonb,text) FROM PUBLIC;
