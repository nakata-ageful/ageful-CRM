-- ISOLATED DRAFT. Detail choices and amounts with unchanged billing method/schedule.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Draft migration blocked';
  END IF;
END $$;
CREATE FUNCTION public.prepare_transfer_detail_choices(p_project jsonb,p_contract jsonb,p_choices jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp AS $$
DECLARE
  scope_name text;
  base jsonb;
  choices jsonb;
  patch jsonb;
  result jsonb:='{}';
  entry record;
  mode text;
  val jsonb;
  allowed text[];
  money_keys text[]:=ARRAY['annual_maintenance_ex','annual_maintenance_inc','land_cost_monthly','insurance_fee',
    'other_fee','communication_fee','local_association_fee','issuance_fee_ex','issuance_fee_inc',
    'transfer_fee_ex','transfer_fee_inc','subcontract_fee_ex','subcontract_fee_inc',
    'billing_amount_ex','billing_amount_inc','transfer_fee','transfer_account'];
  billing_changed boolean:=false;
  candidate jsonb;
  item record;
  rounds integer;
  total numeric:=0;
  fee numeric:=0;
  date_parts text[];
  debit boolean;
BEGIN
  IF jsonb_typeof(p_project) IS DISTINCT FROM 'object' OR jsonb_typeof(p_contract) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_choices) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '項目選択の形式が不正です'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_choices) k WHERE k NOT IN('project','contract')) THEN
    RAISE EXCEPTION '項目選択の対象が不正です';
  END IF;
  FOREACH scope_name IN ARRAY ARRAY['project','contract'] LOOP
    base:=CASE scope_name WHEN 'project' THEN p_project ELSE p_contract END;
    choices:=coalesce(p_choices->scope_name,'{}'::jsonb);
    patch:='{}';
    IF jsonb_typeof(choices) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '項目選択の形式が不正です'; END IF;
    allowed:=CASE scope_name WHEN 'project' THEN ARRAY[
      'summary_notes','meti_notes','power_company_notes','panel_notes','pcs_notes','monitoring_notes','notes',
      'sales_company','referrer','customer_referrer','project_referrer','power_change_date','handover_date',
      'sales_price','reference_price','land_cost','amuras_member_no']
      ELSE ARRAY['sale_contract_date','equipment_contract_date','land_contract_date','maintenance_contract_date',
        'maintenance_start_date','subcontract_start_date','sales_to_neosys','neosys_to_referrer',
        'notes','equipment_contract_notes','land_contract_notes','maintenance_contract_notes',
        'maintenance_content_notes','subcontract_notes','has_issuance_fee','has_transfer_fee',
        'billing_amount_overrides','billing_item_flags','billing_method','billing_due_day','billing_count','billing_schedule_days',
        'contractor_name','subcontractor','subcontract_billing_day','maintenance_contractor','plan_inspection','plan_weeding','plan_emergency',
        'has_meti_setup_report','has_meti_periodic_report','meti_setup_report_date','meti_setup_report_status']||money_keys END;
    FOR entry IN SELECT * FROM jsonb_each(choices) LOOP
      IF NOT(base ? entry.key) OR entry.key IN('id','project_id','customer_id','old_owner','created_at','updated_at','ownership_transfer_date') THEN
        RAISE EXCEPTION '選択できない項目です: %',entry.key;
      END IF;
      IF jsonb_typeof(entry.value) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '選択内容が不正です'; END IF;
      mode:=entry.value->>'mode';
      IF mode IS NULL OR mode NOT IN('keep','clear','change') OR
        EXISTS(SELECT 1 FROM jsonb_object_keys(entry.value) k WHERE k NOT IN('mode','value')) OR
        ((mode='change') IS DISTINCT FROM (entry.value ? 'value')) THEN RAISE EXCEPTION '選択内容が不正です'; END IF;
      IF mode='keep' THEN CONTINUE; END IF;
      IF NOT(entry.key=ANY(allowed)) THEN RAISE EXCEPTION 'この項目の変更は追加検証後に対応します: %',entry.key; END IF;
      val:=CASE mode WHEN 'clear' THEN 'null'::jsonb ELSE entry.value->'value' END;
      IF val<>'null'::jsonb THEN
        IF entry.key IN('sales_price','reference_price','land_cost','billing_count') OR entry.key=ANY(money_keys) THEN
          IF jsonb_typeof(val) IS DISTINCT FROM 'number' OR val::text !~ '^[0-9]+$'
            OR (val::text)::numeric>9007199254740991 THEN RAISE EXCEPTION '金額の形式が不正です: %',entry.key; END IF;
        ELSIF entry.key IN('has_issuance_fee','has_transfer_fee','has_meti_setup_report','has_meti_periodic_report') THEN
          IF jsonb_typeof(val) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION '手数料の有無を確認してください'; END IF;
        ELSIF entry.key='billing_schedule_days' THEN
          IF jsonb_typeof(val) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '請求予定日の形式が不正です'; END IF;
        ELSIF entry.key IN('billing_amount_overrides','billing_item_flags') THEN
          IF jsonb_typeof(val) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '請求設定の形式が不正です'; END IF;
        ELSIF right(entry.key,5)='_date' THEN
          IF jsonb_typeof(val) IS DISTINCT FROM 'string' OR (val#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            RAISE EXCEPTION '日付の形式が不正です: %',entry.key;
          END IF;
          PERFORM (val#>>'{}')::date;
        ELSIF jsonb_typeof(val) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION '文字列を指定してください: %',entry.key;
        END IF;
        IF entry.key IN('plan_inspection','plan_weeding','plan_emergency') AND val#>>'{}' NOT IN('なし','年1回','年2回','年3回','年4回','無制限') THEN
          RAISE EXCEPTION '保守プランの選択肢が不正です'; END IF;
        IF entry.key='meti_setup_report_status' AND val#>>'{}' NOT IN('未','申請中','受理','不備') THEN
          RAISE EXCEPTION '設置報告の状態が不正です'; END IF;
      END IF;
      patch:=patch||jsonb_build_object(entry.key,val);
      IF scope_name='contract' AND (entry.key=ANY(money_keys) OR entry.key IN(
        'has_issuance_fee','has_transfer_fee','billing_amount_overrides','billing_item_flags','billing_method','billing_count','billing_schedule_days')) THEN billing_changed:=true; END IF;
    END LOOP;
    result:=result||jsonb_build_object(scope_name,patch);
  END LOOP;
  IF result->'contract' ? 'equipment_contract_date'
    AND result->'contract'->'equipment_contract_date'='null'::jsonb
    AND (p_contract||(result->'contract'))->>'sale_contract_date' IS NOT NULL THEN
    RAISE EXCEPTION '旧売買契約日も引き継がない指定が必要です';
  END IF;
  IF billing_changed THEN
    candidate:=p_contract||(result->'contract');
    IF coalesce(candidate->>'billing_method','') NOT IN('請求書','口座振替')
      OR jsonb_typeof(candidate->'billing_schedule_days') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION '請求方法・請求予定日を先に確認してください';
    END IF;
    debit:=candidate->>'billing_method'='口座振替';
    rounds:=CASE WHEN debit THEN 12 ELSE jsonb_array_length(candidate->'billing_schedule_days') END;
    IF debit AND jsonb_array_length(candidate->'billing_schedule_days')<>1 THEN RAISE EXCEPTION '口座振替の予定日は1つです'; END IF;
    IF rounds=0 OR (candidate->>'billing_count' IS NOT NULL AND
      (jsonb_typeof(candidate->'billing_count') IS DISTINCT FROM 'number'
       OR candidate->>'billing_count' !~ '^[1-9][0-9]*$' OR (candidate->>'billing_count')::numeric<>rounds)) THEN
      RAISE EXCEPTION '請求回数と予定日の数が一致しません';
    END IF;
    FOR val IN SELECT value FROM jsonb_array_elements(candidate->'billing_schedule_days') LOOP
      IF jsonb_typeof(val) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION '請求予定日の形式が不正です'; END IF;
      date_parts:=regexp_match(val#>>'{}',CASE WHEN debit THEN '^([0-9]{1,2})日$' ELSE '^([0-9]{1,2})月([0-9]{1,2})日$' END);
      IF date_parts IS NULL THEN RAISE EXCEPTION '請求予定日の形式が不正です'; END IF;
      IF debit THEN PERFORM make_date(2000,1,date_parts[1]::integer);
      ELSE PERFORM make_date(2000,date_parts[1]::integer,date_parts[2]::integer); END IF;
    END LOOP;
    IF (candidate->'has_issuance_fee' IS NOT NULL AND candidate->'has_issuance_fee'<>'null'::jsonb
      AND jsonb_typeof(candidate->'has_issuance_fee') IS DISTINCT FROM 'boolean') THEN
      RAISE EXCEPTION '発行手数料の有無を確認してください';
    END IF;
    FOR item IN SELECT key,value FROM jsonb_each(coalesce(nullif(candidate->'billing_item_flags','null'::jsonb),'{}'::jsonb)) LOOP
      IF item.key NOT IN('annual_maintenance','land_cost','insurance','local_association','communication','other')
        OR jsonb_typeof(item.value) IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION '請求対象フラグが不正です'; END IF;
    END LOOP;
    -- Preserve existing floor division and null/missing = included semantics; no tax inference.
    FOR item IN SELECT * FROM (VALUES
      ('annual_maintenance','annual_maintenance_inc'),('land_cost','land_cost_monthly'),('insurance','insurance_fee'),
      ('local_association','local_association_fee'),('communication','communication_fee'),('other','other_fee')) AS x(flag,field) LOOP
      val:=candidate->item.field;
      IF val IS NOT NULL AND val<>'null'::jsonb THEN
        IF jsonb_typeof(val) IS DISTINCT FROM 'number' OR val::text !~ '^[0-9]+$' THEN RAISE EXCEPTION '既存の請求金額も確認してください'; END IF;
        IF (candidate->'billing_item_flags'->item.flag) IS DISTINCT FROM 'false'::jsonb THEN total:=total+(val::text)::numeric; END IF;
      END IF;
    END LOOP;
    IF candidate->(CASE WHEN debit THEN 'has_transfer_fee' ELSE 'has_issuance_fee' END)='true'::jsonb THEN
      val:=candidate->(CASE WHEN debit THEN 'transfer_fee_inc' ELSE 'issuance_fee_inc' END);
      IF jsonb_typeof(val) IS DISTINCT FROM 'number' OR val::text !~ '^[0-9]+$' THEN RAISE EXCEPTION '発行手数料の金額を確認してください'; END IF;
      fee:=(val::text)::numeric;
    END IF;
    IF total>9007199254740991 OR floor(total/rounds)+fee>9007199254740991 THEN RAISE EXCEPTION '請求金額が計算可能な範囲を超えています'; END IF;
    FOR item IN SELECT key,value FROM jsonb_each(coalesce(nullif(candidate->'billing_amount_overrides','null'::jsonb),'{}'::jsonb)) LOOP
      IF item.key !~ '^[1-9][0-9]*$' OR length(item.key)>10 THEN RAISE EXCEPTION '個別金額の対象回が不正です'; END IF;
      IF item.key::numeric>rounds OR jsonb_typeof(item.value) IS DISTINCT FROM 'number'
        OR item.value::text !~ '^[0-9]+$' OR (item.value::text)::numeric+fee>9007199254740991 THEN
        RAISE EXCEPTION '個別金額と対象回を確認してください';
      END IF;
    END LOOP;
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.prepare_transfer_detail_choices(jsonb,jsonb,jsonb) FROM PUBLIC;
