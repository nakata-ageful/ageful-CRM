-- ISOLATED DRAFT. Requires foundation + invoice_write_rpc + invoice_import_rpc.
-- This records initial future recipients, not application activation or legacy-write protection.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF;
END $$;
CREATE TABLE public.invoice_recipient_initializations(
  project_id bigint PRIMARY KEY REFERENCES public.projects(id) ON DELETE RESTRICT,
  operation_key uuid NOT NULL UNIQUE,
  recipient_plan_id bigint NOT NULL,
  source_manifest jsonb NOT NULL CHECK(jsonb_typeof(source_manifest)='object'),
  report_before jsonb NOT NULL CHECK(jsonb_typeof(report_before)='object'),
  plan_snapshot jsonb NOT NULL CHECK(jsonb_typeof(plan_snapshot)='object'),
  receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
  actor_user_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
  FOREIGN KEY(operation_key,project_id) REFERENCES public.billing_operations(operation_key,project_id) ON DELETE RESTRICT,
  FOREIGN KEY(recipient_plan_id,project_id) REFERENCES public.billing_recipient_plans(id,project_id) ON DELETE RESTRICT
);
CREATE TRIGGER invoice_recipient_initializations_append_only BEFORE UPDATE OR DELETE ON public.invoice_recipient_initializations
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_row_mutation();
CREATE TRIGGER invoice_recipient_initializations_reject_truncate BEFORE TRUNCATE ON public.invoice_recipient_initializations
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_row_mutation();
ALTER TABLE public.invoice_recipient_initializations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_recipient_initializations FROM PUBLIC;

CREATE FUNCTION public.initialize_invoice_recipients(
  p_operation_key uuid,p_project_id bigint,p_expected_project jsonb,p_expected_contract jsonb,
  p_expected_sources jsonb,p_expected_units jsonb,p_default_recipient_id bigint,p_effective_from date
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  actor uuid:=auth.uid();
  op public.billing_operations%ROWTYPE;
  plan public.billing_recipient_plans%ROWTYPE;
  old_unit public.billing_units%ROWTYPE;
  new_unit public.billing_units%ROWTYPE;
  fingerprint text;
  project_value jsonb;
  contract_value jsonb;
  source_manifest jsonb;
  unit_versions jsonb;
  report jsonb;
  receipt jsonb;
  first_date date;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_operation_key IS NULL OR p_project_id IS NULL OR p_default_recipient_id IS NULL OR p_default_recipient_id<=0
    OR p_effective_from IS NULL OR jsonb_typeof(p_expected_project) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_expected_contract) IS DISTINCT FROM 'object' OR jsonb_typeof(p_expected_sources) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_expected_units) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '初期請求先の確認内容が不正です'; END IF;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','initialize_invoice_recipients','project',p_project_id,
    'expected_project',p_expected_project,'expected_contract',p_expected_contract,'sources',p_expected_sources,
    'units',p_expected_units,'default',p_default_recipient_id,'effective_from',p_effective_from,'actor',actor)::text,'UTF8')),'hex');
  INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
    VALUES(p_operation_key,'plan',p_project_id,fingerprint,actor) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_operation_key FOR UPDATE;
  IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION '同じ操作IDで異なる初期設定は保存できません'; END IF;
  IF op.completed_at IS NOT NULL THEN
    SELECT i.receipt INTO STRICT receipt FROM public.invoice_recipient_initializations i WHERE operation_key=p_operation_key;
    RETURN receipt;
  END IF;
  SELECT to_jsonb(p) INTO STRICT project_value FROM public.projects p WHERE id=p_project_id FOR UPDATE;
  PERFORM 1 FROM public.billing_recipient_plans WHERE project_id=p_project_id ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.billing_recipient_plans WHERE project_id=p_project_id)
    OR EXISTS(SELECT 1 FROM public.invoice_recipient_initializations WHERE project_id=p_project_id)
    OR EXISTS(SELECT 1 FROM public.ownership_transfers WHERE project_id=p_project_id) THEN RAISE EXCEPTION '今後の請求先は初期設定済みです'; END IF;
  PERFORM 1 FROM public.contracts WHERE project_id=p_project_id ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.contracts WHERE project_id=p_project_id)<>1 THEN RAISE EXCEPTION '現契約の対応を先に確認してください'; END IF;
  SELECT to_jsonb(c) INTO STRICT contract_value FROM public.contracts c WHERE project_id=p_project_id;
  IF project_value IS DISTINCT FROM p_expected_project OR contract_value IS DISTINCT FROM p_expected_contract THEN
    RAISE EXCEPTION '確認後に発電所・契約が更新されています';
  END IF;
  -- Current collection settings do not determine the explicitly confirmed historical method.
  IF coalesce(contract_value->>'billing_method','') NOT IN ('請求書','口座振替') THEN RAISE EXCEPTION '現在の請求方法を確認してください'; END IF;
  -- Default is explicitly supplied, not a runtime fallback. Initial D-025 mapping only.
  IF project_value->>'customer_id' IS DISTINCT FROM p_default_recipient_id::text THEN
    RAISE EXCEPTION '初期の既定請求先は確認した現顧客に合わせてください。以降の変更は別操作です';
  END IF;
  PERFORM 1 FROM public.customers WHERE id=p_default_recipient_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '請求先が存在しません'; END IF;
  PERFORM 1 FROM public.annual_records WHERE contract_id=(contract_value->>'id')::bigint ORDER BY id FOR UPDATE;
  PERFORM 1 FROM public.billing_units WHERE project_id=p_project_id ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=p_project_id AND original_method<>'invoice') THEN RAISE EXCEPTION '過去の請求書記録以外は別の初期設定が必要です'; END IF;
  report:=public.inspect_invoice_import(p_project_id);
  IF report->'source_checks_passed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION '元記録の移行点検を完了してください'; END IF;
  SELECT coalesce(jsonb_object_agg(source_annual_record_id::text,source_snapshot_hash),'{}') INTO source_manifest
    FROM public.invoice_import_evidence WHERE project_id=p_project_id;
  SELECT coalesce(jsonb_object_agg(id::text,revision),'{}'),min(scheduled_date) FILTER(WHERE lifecycle='planned')
    INTO unit_versions,first_date FROM public.billing_units WHERE project_id=p_project_id;
  IF source_manifest IS DISTINCT FROM p_expected_sources OR unit_versions IS DISTINCT FROM p_expected_units THEN
    RAISE EXCEPTION '確認した移行元・請求回が更新されています';
  END IF;
  IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=p_project_id AND lifecycle='planned' AND
    (original_method<>'invoice' OR collection_method<>'invoice' OR recipient_customer_id IS NULL OR recipient_source<>'confirmed'
      OR recipient_plan_id IS NOT NULL)) THEN RAISE EXCEPTION '未発行予定の請求先を確認してください'; END IF;
  IF (first_date IS NOT NULL AND p_effective_from<>first_date) OR (first_date IS NULL AND p_effective_from<current_date) THEN
    RAISE EXCEPTION '予定があれば最初の予定日、予定がなければ確認した今後の開始日を指定してください';
  END IF;
  INSERT INTO public.billing_recipient_plans(project_id,default_recipient_customer_id,effective_from)
    VALUES(p_project_id,p_default_recipient_id,p_effective_from) RETURNING * INTO plan;
  FOR old_unit IN SELECT * FROM public.billing_units WHERE project_id=p_project_id AND lifecycle='planned' ORDER BY id LOOP
    -- Keep the imported payer, even if it is an explicitly confirmed one-off exception.
    UPDATE public.billing_units SET recipient_plan_id=plan.id,
      recipient_source=CASE WHEN recipient_customer_id=p_default_recipient_id THEN 'default' ELSE 'override' END,
      revision=revision+1 WHERE id=old_unit.id RETURNING * INTO new_unit;
    IF new_unit.recipient_customer_id<>p_default_recipient_id THEN
      INSERT INTO public.billing_recipient_plan_overrides(project_id,recipient_plan_id,billing_unit_id,recipient_customer_id)
        VALUES(p_project_id,plan.id,new_unit.id,new_unit.recipient_customer_id);
    END IF;
    INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,before_value,after_value,actor_user_id,reason)
      VALUES(p_project_id,new_unit.id,p_operation_key,'plan_changed',to_jsonb(old_unit),to_jsonb(new_unit),actor,'移行済み請求先の初期設定');
  END LOOP;
  receipt:=jsonb_build_object('operation_key',p_operation_key,'project_id',p_project_id,'recipient_plan_id',plan.id,'cutover_ready',false);
  INSERT INTO public.invoice_recipient_initializations(project_id,operation_key,recipient_plan_id,source_manifest,report_before,plan_snapshot,receipt,actor_user_id)
    VALUES(p_project_id,p_operation_key,plan.id,source_manifest,report,to_jsonb(plan),receipt,actor);
  UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_operation_key;
  RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.initialize_invoice_recipients(uuid,bigint,jsonb,jsonb,jsonb,jsonb,bigint,date) FROM PUBLIC;
