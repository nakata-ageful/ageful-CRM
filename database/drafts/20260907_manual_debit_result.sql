-- Isolated draft only. Human observation, no bank execution or date-driven result inference.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF;
END $$;
CREATE FUNCTION public.record_manual_debit_result(p_operation_key uuid,p_unit_id bigint,p_revision integer,p_kind text,p_value jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); old_unit public.billing_units%ROWTYPE; new_unit public.billing_units%ROWTYPE;
  op public.billing_operations%ROWTYPE; project_key bigint; fingerprint text; result jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_operation_key IS NULL OR p_unit_id IS NULL OR p_revision IS NULL OR p_revision<0
    OR p_kind IS NULL OR p_kind NOT IN ('received','invoice_switch') OR jsonb_typeof(p_value) IS DISTINCT FROM 'object'
    OR p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION '対象回・操作・確認内容を入力してください'; END IF;
  IF p_kind='invoice_switch' AND p_value<>'{}'::jsonb THEN RAISE EXCEPTION '切替時は元の請求先・予定額を維持します'; END IF;
  IF p_kind='received' THEN
    IF NOT(p_value ?& ARRAY['received_on','amount','line_items'])
      OR (SELECT count(*) FROM jsonb_object_keys(p_value))<>3
      OR jsonb_typeof(p_value->'received_on') IS DISTINCT FROM 'string'
      OR (p_value->>'received_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR jsonb_typeof(p_value->'amount') IS DISTINCT FROM 'number'
      OR (p_value->>'amount') !~ '^[0-9]+$'
      OR (p_value->>'amount')::numeric>9007199254740991 THEN RAISE EXCEPTION '入金日・実額・明細を確認してください'; END IF;
  END IF;
  SELECT project_id INTO STRICT project_key FROM public.billing_units WHERE id=p_unit_id;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','manual_debit_result','unit',p_unit_id,'revision',p_revision,
    'kind',p_kind,'value',p_value,'reason',p_reason,'actor',actor)::text,'UTF8')),'hex');
  INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
    VALUES(p_operation_key,CASE WHEN p_kind='received' THEN 'collection' ELSE 'plan' END,project_key,fingerprint,actor) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_operation_key FOR UPDATE;
  IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION '同じ操作IDで別の内容は保存できません'; END IF;
  IF op.completed_at IS NOT NULL THEN
    SELECT after_value INTO STRICT result FROM public.billing_unit_events WHERE operation_key=p_operation_key AND billing_unit_id=p_unit_id;
    RETURN result;
  END IF;
  PERFORM 1 FROM public.projects WHERE id=project_key FOR UPDATE;
  PERFORM 1 FROM public.billing_recipient_plans WHERE project_id=project_key ORDER BY id FOR UPDATE;
  SELECT * INTO STRICT old_unit FROM public.billing_units WHERE id=p_unit_id FOR UPDATE;
  IF old_unit.revision<>p_revision THEN RAISE EXCEPTION '情報が更新されています'; END IF;
  IF old_unit.original_method<>'direct_debit' OR old_unit.collection_method<>'direct_debit'
    OR old_unit.lifecycle<>'planned' OR old_unit.received_on IS NOT NULL OR old_unit.frozen_amount IS NOT NULL THEN
    RAISE EXCEPTION '未確認の振替予定だけが対象です'; END IF;
  IF old_unit.recipient_customer_id IS NULL THEN RAISE EXCEPTION '元の請求先を確認してください'; END IF;
  IF p_kind='received' THEN
    UPDATE public.billing_units SET lifecycle='received',collection_state='succeeded',received_on=(p_value->>'received_on')::date,
      frozen_amount=(p_value->>'amount')::bigint,frozen_line_items=p_value->'line_items',frozen_at=clock_timestamp(),
      amount_basis='operator_confirmed',revision=revision+1 WHERE id=p_unit_id RETURNING * INTO new_unit;
  ELSE
    UPDATE public.billing_units SET collection_method='invoice',collection_state='failed',revision=revision+1
      WHERE id=p_unit_id RETURNING * INTO new_unit;
  END IF;
  INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,before_value,after_value,actor_user_id,reason)
    VALUES(project_key,p_unit_id,p_operation_key,CASE WHEN p_kind='received' THEN 'collection_recorded' ELSE 'plan_changed' END,
      to_jsonb(old_unit),to_jsonb(new_unit),actor,p_reason);
  UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_operation_key;
  RETURN to_jsonb(new_unit);
END $$;
REVOKE ALL ON FUNCTION public.record_manual_debit_result(uuid,bigint,integer,text,jsonb,text) FROM PUBLIC;
