-- ISOLATED DRAFT ONLY. Requires foundation, invoice_write_rpc and transfer_detail_choices.
-- Limited to complete, wholly unissued invoice years. No legacy cutover or UI connection.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Draft migration blocked';
  END IF;
END $$;

CREATE TABLE public.invoice_schedule_changes (
  operation_key uuid PRIMARY KEY,
  project_id bigint NOT NULL,
  contract_id bigint NOT NULL,
  contract_before jsonb NOT NULL CHECK(jsonb_typeof(contract_before)='object'),
  contract_after jsonb NOT NULL CHECK(jsonb_typeof(contract_after)='object'),
  confirmed_request jsonb NOT NULL CHECK(jsonb_typeof(confirmed_request)='object'),
  receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
  actor_user_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version>0),
  FOREIGN KEY(operation_key,project_id) REFERENCES public.billing_operations(operation_key,project_id) ON DELETE RESTRICT,
  FOREIGN KEY(contract_id,project_id) REFERENCES public.contracts(id,project_id) ON DELETE RESTRICT
);
CREATE TRIGGER invoice_schedule_changes_append_only BEFORE UPDATE OR DELETE ON public.invoice_schedule_changes
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_row_mutation();
CREATE TRIGGER invoice_schedule_changes_reject_truncate BEFORE TRUNCATE ON public.invoice_schedule_changes
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_row_mutation();
ALTER TABLE public.invoice_schedule_changes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.invoice_schedule_changes FROM PUBLIC;

CREATE FUNCTION public.write_invoice_schedule(
  p_operation_key uuid,p_project_id bigint,p_contract_id bigint,p_expected_contract jsonb,
  p_expected_plan_id bigint,p_expected_plan_revision integer,p_expected_units jsonb,
  p_configuration jsonb,p_targets jsonb,p_retire jsonb,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  actor uuid:=auth.uid();
  op public.billing_operations%ROWTYPE;
  plan public.billing_recipient_plans%ROWTYPE;
  old_contract public.contracts%ROWTYPE;
  new_contract public.contracts%ROWTYPE;
  old_unit public.billing_units%ROWTYPE;
  new_unit public.billing_units%ROWTYPE;
  request jsonb;
  fingerprint text;
  actual_units jsonb;
  target jsonb;
  entry jsonb;
  covered bigint[]:=ARRAY[]::bigint[];
  pairs text[]:=ARRAY[]::text[];
  years integer[]:=ARRAY[]::integer[];
  source_id bigint;
  yr integer;
  round_no integer;
  rounds integer;
  parts text[];
  scheduled date;
  dates date[]:=ARRAY[]::date[];
  mappings jsonb:='[]';
  result jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_operation_key IS NULL OR p_project_id IS NULL OR p_project_id<=0 OR p_contract_id IS NULL OR p_contract_id<=0
    OR p_expected_plan_id IS NULL OR p_expected_plan_revision IS NULL OR p_expected_plan_revision<0 THEN
    RAISE EXCEPTION '対象・請求先指定の版を確認してください';
  END IF;
  IF p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION '予定構成を変更する理由が必要です'; END IF;
  IF jsonb_typeof(p_expected_contract) IS DISTINCT FROM 'object' OR jsonb_typeof(p_expected_units) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_configuration) IS DISTINCT FROM 'object' OR jsonb_typeof(p_targets) IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_retire) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '予定変更の形式が不正です'; END IF;
  IF NOT(p_configuration ?& ARRAY['billing_count','billing_schedule_days','billing_amount_overrides']) OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_configuration) k WHERE k NOT IN('billing_count','billing_schedule_days','billing_amount_overrides')) THEN
    RAISE EXCEPTION '回数・予定日・個別金額をすべて明示してください';
  END IF;
  IF jsonb_typeof(p_configuration->'billing_count') IS DISTINCT FROM 'number'
    OR p_configuration->>'billing_count' !~ '^[1-9][0-9]*$'
    OR jsonb_typeof(p_configuration->'billing_schedule_days') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '請求回数・予定日の形式が不正です';
  END IF;
  rounds:=(p_configuration->>'billing_count')::integer;
  IF rounds<>jsonb_array_length(p_configuration->'billing_schedule_days') OR jsonb_array_length(p_targets)=0 THEN
    RAISE EXCEPTION '請求回数と予定日の数を確認してください';
  END IF;
  request:=jsonb_build_object('action','invoice_schedule','project',p_project_id,'contract',p_contract_id,
    'expected_contract',p_expected_contract,'plan',p_expected_plan_id,'plan_revision',p_expected_plan_revision,
    'units',p_expected_units,'configuration',p_configuration,'targets',p_targets,'retire',p_retire,'reason',p_reason,'actor',actor);
  fingerprint:=encode(sha256(convert_to(request::text,'UTF8')),'hex');
  INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
    VALUES(p_operation_key,'plan',p_project_id,fingerprint,actor) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_operation_key FOR UPDATE;
  IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION '同じ操作IDで違う変更は保存できません';
  END IF;
  IF op.completed_at IS NOT NULL THEN
    SELECT receipt INTO STRICT result FROM public.invoice_schedule_changes WHERE operation_key=p_operation_key;
    RETURN result; -- A historical receipt, never a request to restore historical state.
  END IF;
  PERFORM 1 FROM public.projects WHERE id=p_project_id FOR UPDATE;
  SELECT * INTO plan FROM public.billing_recipient_plans WHERE project_id=p_project_id AND retired_at IS NULL FOR UPDATE;
  IF plan.id IS DISTINCT FROM p_expected_plan_id OR plan.revision IS DISTINCT FROM p_expected_plan_revision THEN
    RAISE EXCEPTION '請求先指定が更新されています';
  END IF;
  PERFORM 1 FROM public.contracts WHERE project_id=p_project_id ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.contracts WHERE project_id=p_project_id)<>1 THEN RAISE EXCEPTION '現契約の対応を確認してください'; END IF;
  SELECT * INTO STRICT old_contract FROM public.contracts WHERE id=p_contract_id AND project_id=p_project_id;
  IF to_jsonb(old_contract) IS DISTINCT FROM p_expected_contract THEN RAISE EXCEPTION '契約が更新されています'; END IF;
  IF old_contract.billing_method IS DISTINCT FROM '請求書' THEN RAISE EXCEPTION '今回は請求書のみ対象です'; END IF;
  IF EXISTS(SELECT 1 FROM public.annual_records WHERE contract_id=p_contract_id) THEN
    RAISE EXCEPTION '旧年度記録の移行確認後に対応します。旧記録を削除して進めないでください';
  END IF;
  -- Reuse amount/flag/fee validation, against the explicitly selected new schedule.
  PERFORM public.prepare_transfer_detail_choices('{}',to_jsonb(old_contract)||p_configuration,
    jsonb_build_object('contract',jsonb_build_object('billing_amount_overrides',
      jsonb_build_object('mode','change','value',p_configuration->'billing_amount_overrides'))));
  PERFORM 1 FROM public.billing_units WHERE project_id=p_project_id ORDER BY id FOR UPDATE;
  SELECT coalesce(jsonb_object_agg(id::text,revision),'{}') INTO actual_units
    FROM public.billing_units WHERE project_id=p_project_id AND lifecycle='planned';
  IF actual_units IS DISTINCT FROM p_expected_units THEN RAISE EXCEPTION '未発行予定が更新されています'; END IF;
  IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=p_project_id AND
    (lifecycle='review_required' OR (lifecycle='planned' AND (original_method<>'invoice' OR collection_method<>'invoice'
      OR contract_id<>p_contract_id OR recipient_customer_id IS NULL OR recipient_plan_id IS DISTINCT FROM plan.id
      OR service_month IS NOT NULL OR schedule_slot_id IS NOT NULL)))) THEN
    RAISE EXCEPTION '請求回・請求先の対応を先に確認してください';
  END IF;
  IF EXISTS(SELECT 1 FROM public.billing_units u LEFT JOIN public.billing_recipient_plan_overrides o
    ON o.recipient_plan_id=plan.id AND o.billing_unit_id=u.id
    WHERE u.project_id=p_project_id AND u.lifecycle='planned' AND
      (u.recipient_customer_id IS DISTINCT FROM coalesce(o.recipient_customer_id,plan.default_recipient_customer_id)
       OR u.recipient_source IS DISTINCT FROM CASE WHEN o.id IS NULL THEN 'default' ELSE 'override' END)) THEN
    RAISE EXCEPTION '個別の請求先指定と各回の対応が一致しません';
  END IF;
  -- Every planned occurrence must explicitly survive or be retired. Identity never follows array position.
  FOR target IN SELECT value FROM jsonb_array_elements(p_targets) LOOP
    IF jsonb_typeof(target) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '変更後の回の形式が不正です'; END IF;
    IF NOT(target ?& ARRAY['source_id','service_year','round_number']) OR
      EXISTS(SELECT 1 FROM jsonb_object_keys(target) k WHERE k NOT IN('source_id','service_year','round_number')) OR
      jsonb_typeof(target->'service_year') IS DISTINCT FROM 'number' OR target->>'service_year' !~ '^[0-9]{4}$' OR
      jsonb_typeof(target->'round_number') IS DISTINCT FROM 'number' OR target->>'round_number' !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION '変更後の年度・回を確認してください';
    END IF;
    IF target->'source_id'<>'null'::jsonb AND (jsonb_typeof(target->'source_id') IS DISTINCT FROM 'number'
      OR target->>'source_id' !~ '^[1-9][0-9]*$') THEN RAISE EXCEPTION '元の回IDが不正です'; END IF;
    yr:=(target->>'service_year')::integer; round_no:=(target->>'round_number')::integer;
    source_id:=(target->>'source_id')::bigint;
    IF yr NOT BETWEEN 2000 AND 2200 OR round_no>rounds THEN RAISE EXCEPTION '変更後の年度・回が範囲外です'; END IF;
    IF (yr::text||':'||round_no::text)=ANY(pairs) THEN RAISE EXCEPTION '同じ年度・回を重複指定しています'; END IF;
    pairs:=array_append(pairs,yr::text||':'||round_no::text); years:=array_append(years,yr);
    parts:=regexp_match(p_configuration->'billing_schedule_days'->>(round_no-1),'^([0-9]{1,2})月([0-9]{1,2})日$');
    scheduled:=make_date(yr,parts[1]::integer,parts[2]::integer);
    IF scheduled<current_date OR scheduled<plan.effective_from THEN RAISE EXCEPTION '過去日・請求先指定開始前への構成変更は未対応です'; END IF;
    IF scheduled=ANY(dates) THEN RAISE EXCEPTION '同日の複数回は追加検証後に対応します'; END IF;
    dates:=array_append(dates,scheduled);
    IF source_id IS NOT NULL THEN
      IF source_id=ANY(covered) THEN RAISE EXCEPTION '元の回を重複指定しています'; END IF;
      SELECT * INTO old_unit FROM public.billing_units WHERE id=source_id AND project_id=p_project_id AND lifecycle='planned';
      IF NOT FOUND OR old_unit.service_year<>yr THEN RAISE EXCEPTION '元の未発行回・年度を確認してください'; END IF;
      covered:=array_append(covered,source_id);
    END IF;
  END LOOP;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_retire) LOOP
    IF jsonb_typeof(entry) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '取りやめの形式が不正です'; END IF;
    IF NOT(entry ?& ARRAY['id','reason']) OR EXISTS(SELECT 1 FROM jsonb_object_keys(entry) k WHERE k NOT IN('id','reason'))
      OR jsonb_typeof(entry->'id') IS DISTINCT FROM 'number' OR entry->>'id' !~ '^[1-9][0-9]*$'
      OR jsonb_typeof(entry->'reason') IS DISTINCT FROM 'string' OR length(trim(entry->>'reason'))=0 THEN
      RAISE EXCEPTION '取りやめの回・理由を確認してください';
    END IF;
    source_id:=(entry->>'id')::bigint;
    IF source_id=ANY(covered) OR NOT EXISTS(SELECT 1 FROM public.billing_units WHERE id=source_id AND project_id=p_project_id AND lifecycle='planned') THEN
      RAISE EXCEPTION '取りやめ対象が不正・重複しています';
    END IF;
    covered:=array_append(covered,source_id);
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=p_project_id AND lifecycle='planned'
    AND (NOT(id=ANY(covered)) OR NOT(service_year=ANY(years)))) THEN
    RAISE EXCEPTION 'すべての未発行予定と対象年度の対応を指定してください';
  END IF;
  IF EXISTS(SELECT 1 FROM unnest(years) y GROUP BY y HAVING count(*)<>rounds) THEN
    RAISE EXCEPTION '対象年度は全回分を指定してください';
  END IF;
  IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=p_project_id AND service_year=ANY(years)
    AND lifecycle NOT IN('planned','cancelled')) THEN
    RAISE EXCEPTION '発行済み等がある年度の回数変更は追加検証後に対応します';
  END IF;
  -- No mutation above this point (except the transaction-local operation reservation).
  FOR target IN SELECT value FROM jsonb_array_elements(p_targets) LOOP
    source_id:=(target->>'source_id')::bigint;
    yr:=(target->>'service_year')::integer; round_no:=(target->>'round_number')::integer;
    parts:=regexp_match(p_configuration->'billing_schedule_days'->>(round_no-1),'^([0-9]{1,2})月([0-9]{1,2})日$');
    scheduled:=make_date(yr,parts[1]::integer,parts[2]::integer);
    IF source_id IS NULL THEN
      INSERT INTO public.billing_units(project_id,contract_id,recipient_plan_id,recipient_customer_id,recipient_source,
        occurrence_key,service_year,round_number,scheduled_date,original_method,collection_method)
      VALUES(p_project_id,p_contract_id,plan.id,plan.default_recipient_customer_id,'default',
        'schedule:'||p_operation_key::text||':'||yr::text||':'||round_no::text,yr,round_no,scheduled,'invoice','invoice') RETURNING * INTO new_unit;
      INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,reason,after_value,actor_user_id)
        VALUES(p_project_id,new_unit.id,p_operation_key,'created',p_reason,to_jsonb(new_unit),actor);
    ELSE
      SELECT * INTO STRICT old_unit FROM public.billing_units WHERE id=source_id;
      UPDATE public.billing_units SET round_number=round_no,scheduled_date=scheduled,revision=revision+1
        WHERE id=source_id RETURNING * INTO new_unit;
      INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,reason,before_value,after_value,actor_user_id)
        VALUES(p_project_id,new_unit.id,p_operation_key,'plan_changed',p_reason,to_jsonb(old_unit),to_jsonb(new_unit),actor);
    END IF;
    mappings:=mappings||jsonb_build_array(jsonb_build_object('source_id',source_id,'unit_id',new_unit.id,'service_year',yr,'round_number',round_no));
  END LOOP;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_retire) LOOP
    SELECT * INTO STRICT old_unit FROM public.billing_units WHERE id=(entry->>'id')::bigint;
    UPDATE public.billing_units SET lifecycle='cancelled',collection_state='not_applicable',revision=revision+1
      WHERE id=old_unit.id RETURNING * INTO new_unit;
    INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,reason,before_value,after_value,actor_user_id)
      VALUES(p_project_id,new_unit.id,p_operation_key,'cancelled',entry->>'reason',to_jsonb(old_unit),to_jsonb(new_unit),actor);
  END LOOP;
  -- The selected override map is explicit: never move it by the old array index.
  SELECT * INTO new_contract FROM jsonb_populate_record(NULL::public.contracts,to_jsonb(old_contract)||p_configuration);
  UPDATE public.contracts SET billing_count=new_contract.billing_count,billing_schedule_days=new_contract.billing_schedule_days,
    billing_amount_overrides=new_contract.billing_amount_overrides WHERE id=p_contract_id RETURNING * INTO new_contract;
  UPDATE public.billing_recipient_plans SET revision=revision+1 WHERE id=plan.id;
  result:=jsonb_build_object('operation_key',p_operation_key,'plan_revision',plan.revision+1,'correspondence',mappings,
    'retired_count',jsonb_array_length(p_retire));
  INSERT INTO public.invoice_schedule_changes(operation_key,project_id,contract_id,contract_before,contract_after,confirmed_request,receipt,actor_user_id)
    VALUES(p_operation_key,p_project_id,p_contract_id,to_jsonb(old_contract),to_jsonb(new_contract),request,result,actor);
  UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_operation_key;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.write_invoice_schedule(uuid,bigint,bigint,jsonb,bigint,integer,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC;
