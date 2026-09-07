-- Isolated draft. Requires invoice_import_rpc. No billing units are created.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF;
END $$;
CREATE FUNCTION public.preserve_maintenance_source(
  p_operation_key uuid,p_record_id bigint,p_expected_project jsonb,p_expected_contract jsonb,p_source_signature text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); project_key bigint; contract_key bigint; source jsonb;
  project_value jsonb; contract_value jsonb; fingerprint text; receipt jsonb; op public.billing_operations%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_operation_key IS NULL OR p_record_id IS NULL OR p_source_signature IS NULL
    OR jsonb_typeof(p_expected_project) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_expected_contract) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '保全の確認内容が不正です'; END IF;
  SELECT c.id,c.project_id INTO STRICT contract_key,project_key FROM public.annual_records a JOIN public.contracts c ON c.id=a.contract_id WHERE a.id=p_record_id;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','preserve_maintenance_source','actor',actor,
    'record',p_record_id,'project',p_expected_project,'contract',p_expected_contract,'source',p_source_signature)::text,'UTF8')),'hex');
  INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
    VALUES(p_operation_key,'plan',project_key,fingerprint,actor) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_operation_key FOR UPDATE;
  IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION '同じ操作IDで異なる保全はできません'; END IF;
  IF op.completed_at IS NOT NULL THEN
    SELECT e.receipt INTO STRICT receipt FROM public.invoice_import_evidence e WHERE operation_key=p_operation_key;
    RETURN receipt;
  END IF;
  SELECT to_jsonb(p) INTO STRICT project_value FROM public.projects p WHERE id=project_key FOR UPDATE;
  PERFORM 1 FROM public.billing_recipient_plans WHERE project_id=project_key ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.billing_recipient_plans WHERE project_id=project_key)
    OR EXISTS(SELECT 1 FROM public.ownership_transfers WHERE project_id=project_key) THEN RAISE EXCEPTION '初期設定前に保全してください'; END IF;
  SELECT to_jsonb(c) INTO STRICT contract_value FROM public.contracts c WHERE id=contract_key FOR UPDATE;
  SELECT to_jsonb(a) INTO STRICT source FROM public.annual_records a WHERE id=p_record_id FOR UPDATE;
  IF project_value IS DISTINCT FROM p_expected_project OR contract_value IS DISTINCT FROM p_expected_contract
    OR source IS DISTINCT FROM p_source_signature::jsonb OR source->>'contract_id' IS DISTINCT FROM contract_key::text
    OR contract_value->>'project_id' IS DISTINCT FROM project_key::text THEN RAISE EXCEPTION '確認後に保全元・発電所・契約が変わっています'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_each(source) e WHERE e.key=ANY(ARRAY['billing_scheduled_date','billing_date','payment_due_date','received_date']) AND e.value NOT IN ('null'::jsonb,'""'::jsonb))
    OR coalesce(source->'payments','null') NOT IN ('null'::jsonb,'[]'::jsonb)
    OR coalesce(source->'line_items','null') NOT IN ('null'::jsonb,'[]'::jsonb)
    OR coalesce(source->'transfer_failed','null') NOT IN ('null'::jsonb,'false'::jsonb)
    OR coalesce(source->>'status','') NOT IN ('','未入金') THEN RAISE EXCEPTION '請求情報があるため保守専用として保全できません'; END IF;
  IF EXISTS(SELECT 1 FROM public.invoice_import_evidence WHERE source_annual_record_id=p_record_id)
    OR EXISTS(SELECT 1 FROM public.billing_units WHERE source_annual_record_id=p_record_id) THEN RAISE EXCEPTION '元記録は保全・取込済みです'; END IF;
  receipt:=jsonb_build_object('operation_key',p_operation_key,'record_id',p_record_id,'unit_ids','[]'::jsonb,
    'source_kind','maintenance_only','cutover_ready',false);
  INSERT INTO public.invoice_import_evidence(source_annual_record_id,operation_key,project_id,source_record,project_snapshot,contract_snapshot,
    source_signature,source_snapshot_hash,confirmed_payloads,receipt,actor_user_id)
    VALUES(p_record_id,p_operation_key,project_key,source,project_value,contract_value,p_source_signature,
      encode(sha256(convert_to(p_source_signature,'UTF8')),'hex'),'[]',receipt,actor);
  UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_operation_key;
  RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.preserve_maintenance_source(uuid,bigint,jsonb,jsonb,text) FROM PUBLIC;
