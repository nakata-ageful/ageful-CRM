-- ISOLATED TEST ONLY. Explicit one-occurrence creation, not calendar generation.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Draft migration blocked';
  END IF;
END $$;
CREATE FUNCTION public.create_invoice_plan(
  p_operation_key uuid,p_project_id bigint,p_contract_id bigint,
  p_expected_plan_id bigint,p_expected_plan_revision integer,
  p_occurrence_key text,p_service_year integer,p_round_number integer,p_scheduled_date date
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  actor uuid:=auth.uid();
  op public.billing_operations%ROWTYPE;
  active_plan public.billing_recipient_plans%ROWTYPE;
  new_unit public.billing_units%ROWTYPE;
  fingerprint text;
  result jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_operation_key IS NULL OR p_project_id IS NULL OR p_contract_id IS NULL
    OR p_expected_plan_id IS NULL OR p_expected_plan_revision IS NULL OR p_expected_plan_revision<0
    OR p_occurrence_key IS NULL OR length(trim(p_occurrence_key))=0
    OR p_service_year IS NULL OR p_service_year NOT BETWEEN 2000 AND 2200
    OR p_round_number IS NULL OR p_round_number<=0 OR p_scheduled_date IS NULL THEN
    RAISE EXCEPTION '予定・請求先の確認情報が不足しています';
  END IF;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','create_invoice_plan',
    'project',p_project_id,'contract',p_contract_id,'plan',p_expected_plan_id,'revision',p_expected_plan_revision,
    'occurrence',p_occurrence_key,'year',p_service_year,'round',p_round_number,'date',p_scheduled_date,'actor',actor)::text,'UTF8')),'hex');
  INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
    VALUES(p_operation_key,'plan',p_project_id,fingerprint,actor) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_operation_key FOR UPDATE;
  IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION '同じ操作IDで違う予定は保存できません';
  END IF;
  IF op.completed_at IS NOT NULL THEN
    SELECT after_value INTO STRICT result FROM public.billing_unit_events WHERE operation_key=p_operation_key;
    RETURN result; -- Original result only; caller reloads current values.
  END IF;
  PERFORM 1 FROM public.projects WHERE id=p_project_id FOR UPDATE;
  SELECT * INTO active_plan FROM public.billing_recipient_plans
    WHERE project_id=p_project_id AND retired_at IS NULL FOR UPDATE;
  IF active_plan.id IS DISTINCT FROM p_expected_plan_id OR active_plan.revision IS DISTINCT FROM p_expected_plan_revision THEN
    RAISE EXCEPTION '今後の請求先が更新されています。確認し直してください';
  END IF;
  IF p_scheduled_date<active_plan.effective_from THEN
    RAISE EXCEPTION '現在の請求先指定より前の予定は自動作成できません';
  END IF;
  PERFORM id FROM public.contracts WHERE project_id=p_project_id ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.contracts WHERE project_id=p_project_id)<>1
    OR NOT EXISTS(SELECT 1 FROM public.contracts WHERE project_id=p_project_id AND id=p_contract_id AND billing_method='請求書') THEN
    RAISE EXCEPTION '対象の契約を確認してください';
  END IF;
  INSERT INTO public.billing_units(project_id,contract_id,recipient_plan_id,recipient_customer_id,recipient_source,
    occurrence_key,service_year,round_number,scheduled_date,original_method,collection_method)
    VALUES(p_project_id,p_contract_id,active_plan.id,active_plan.default_recipient_customer_id,'default',
      p_occurrence_key,p_service_year,p_round_number,p_scheduled_date,'invoice','invoice') RETURNING * INTO new_unit;
  INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,before_value,after_value,actor_user_id)
    VALUES(p_project_id,new_unit.id,p_operation_key,'created',NULL,to_jsonb(new_unit),actor);
  UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_operation_key;
  RETURN to_jsonb(new_unit);
END $$;
REVOKE ALL ON FUNCTION public.create_invoice_plan(uuid,bigint,bigint,bigint,integer,text,integer,integer,date) FROM PUBLIC;
