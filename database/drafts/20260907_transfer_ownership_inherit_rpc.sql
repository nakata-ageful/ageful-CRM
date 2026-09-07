-- ISOLATED INHERIT-ALL REHEARSAL ONLY. No field editing, legacy cutover or public access.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Draft migration blocked';
  END IF;
END $$;
CREATE FUNCTION public.transfer_ownership_inherit(
  p_operation_key uuid,p_project_id bigint,p_new_owner_id bigint,p_transfer_date date,
  p_expected_project jsonb,p_expected_contract jsonb,
  p_expected_plan_id bigint,p_expected_plan_revision integer,p_expected_units jsonb,
  p_default_recipient_id bigint,p_overrides jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  actor uuid:=auth.uid();
  op public.billing_operations%ROWTYPE;
  old_project public.projects%ROWTYPE;
  new_project public.projects%ROWTYPE;
  old_contract public.contracts%ROWTYPE;
  new_contract public.contracts%ROWTYPE;
  prior_plan public.billing_recipient_plans%ROWTYPE;
  transfer_row public.ownership_transfers%ROWTYPE;
  old_owner_name text;
  fingerprint text;
  child_operation uuid;
  last_transfer_date date;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_operation_key IS NULL OR p_project_id IS NULL OR p_new_owner_id IS NULL
    OR p_transfer_date IS NULL OR p_transfer_date>current_date
    OR jsonb_typeof(p_expected_project) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_expected_contract) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '所有者・移転日・確認内容が不正です。未来日予約は未対応です';
  END IF;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','transfer_ownership_inherit',
    'project',p_project_id,'owner',p_new_owner_id,'date',p_transfer_date,
    'expected_project',p_expected_project,'expected_contract',p_expected_contract,
    'plan',p_expected_plan_id,'plan_revision',p_expected_plan_revision,'units',p_expected_units,
    'default',p_default_recipient_id,'overrides',p_overrides,'actor',actor)::text,'UTF8')),'hex');
  INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
    VALUES(p_operation_key,'ownership_transfer',p_project_id,fingerprint,actor) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_operation_key FOR UPDATE;
  IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION '同じ操作IDで違う所有者変更は保存できません';
  END IF;
  IF op.completed_at IS NOT NULL THEN
    SELECT * INTO STRICT transfer_row FROM public.ownership_transfers WHERE operation_key=p_operation_key;
    RETURN jsonb_build_object('transfer_id',transfer_row.id,'operation_key',p_operation_key,'completed',true);
  END IF;
  SELECT * INTO STRICT old_project FROM public.projects WHERE id=p_project_id FOR UPDATE;
  SELECT * INTO prior_plan FROM public.billing_recipient_plans
    WHERE project_id=p_project_id AND retired_at IS NULL FOR UPDATE;
  PERFORM id FROM public.contracts WHERE project_id=p_project_id ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.contracts WHERE project_id=p_project_id)<>1 THEN
    RAISE EXCEPTION '契約が1件ではありません。対象を確認してください';
  END IF;
  SELECT * INTO STRICT old_contract FROM public.contracts WHERE project_id=p_project_id;
  IF to_jsonb(old_project) IS DISTINCT FROM p_expected_project
    OR to_jsonb(old_contract) IS DISTINCT FROM p_expected_contract THEN
    RAISE EXCEPTION '発電所・契約が更新されています。確認し直してください';
  END IF;
  IF old_project.customer_id=p_new_owner_id THEN RAISE EXCEPTION '現在と同じ所有者です'; END IF;
  PERFORM id FROM public.customers WHERE id IN(old_project.customer_id,p_new_owner_id) ORDER BY id FOR KEY SHARE;
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_new_owner_id) THEN RAISE EXCEPTION '新所有者が存在しません'; END IF;
  SELECT name INTO STRICT old_owner_name FROM public.customers WHERE id=old_project.customer_id;
  IF old_contract.billing_method IS DISTINCT FROM '請求書' THEN RAISE EXCEPTION 'この検証処理は請求書のみ対象です'; END IF;
  SELECT max(transfer_date) INTO last_transfer_date FROM public.ownership_transfers WHERE project_id=p_project_id;
  IF p_transfer_date<last_transfer_date OR p_transfer_date<old_contract.ownership_transfer_date THEN
    RAISE EXCEPTION '前の所有者変更より前の日付にはできません';
  END IF;
  -- Fail closed: this draft must never silently bypass the unfinished legacy migration.
  PERFORM id FROM public.annual_records WHERE contract_id=old_contract.id ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.annual_records WHERE contract_id=old_contract.id) THEN
    RAISE EXCEPTION '旧年度記録がある発電所は移行完了の検証接続後に対応します';
  END IF;
  -- Child request is deterministic and committed/rolled back with the parent transaction.
  child_operation:=substr(encode(sha256(convert_to(p_operation_key::text||':recipient-plan','UTF8')),'hex'),1,32)::uuid;
  PERFORM public.write_invoice_recipient_plan(child_operation,p_project_id,p_expected_plan_id,
    p_expected_plan_revision,p_expected_units,p_default_recipient_id,p_overrides);
  UPDATE public.projects SET customer_id=p_new_owner_id,old_owner=old_owner_name
    WHERE id=p_project_id RETURNING * INTO new_project;
  UPDATE public.contracts SET ownership_transfer_date=p_transfer_date
    WHERE id=old_contract.id RETURNING * INTO new_contract;
  -- Full value snapshots, never used as the source of invoice calculations.
  INSERT INTO public.ownership_transfers(operation_key,project_id,from_customer_id,to_customer_id,transfer_date,
    contract_before,contract_after,project_fields_before,project_fields_after,field_decisions,validation_result,actor_user_id)
    VALUES(p_operation_key,p_project_id,old_project.customer_id,p_new_owner_id,p_transfer_date,
      to_jsonb(old_contract),to_jsonb(new_contract),to_jsonb(old_project),to_jsonb(new_project),
      jsonb_build_object('mode','inherit_all','policy','D-026','system_updated',
        jsonb_build_array('projects.customer_id','projects.old_owner','contracts.ownership_transfer_date')),
      jsonb_build_object('scope','isolated_invoice_without_legacy_records','source_rows_matched',true,
        'recipient_operation_key',child_operation,'field_edits_applied',false),actor)
    RETURNING * INTO transfer_row;
  UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_operation_key;
  RETURN jsonb_build_object('transfer_id',transfer_row.id,'operation_key',p_operation_key,'completed',true);
END $$;
REVOKE ALL ON FUNCTION public.transfer_ownership_inherit(uuid,bigint,bigint,date,jsonb,jsonb,bigint,integer,jsonb,bigint,jsonb) FROM PUBLIC;
