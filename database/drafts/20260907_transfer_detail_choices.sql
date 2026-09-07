-- ISOLATED DRAFT. Server validation for a limited, non-billing subset of D-026 choices.
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
        'maintenance_content_notes','subcontract_notes'] END;
    FOR entry IN SELECT * FROM jsonb_each(choices) LOOP
      IF NOT(base ? entry.key) OR entry.key IN('id','project_id','customer_id','old_owner','created_at','ownership_transfer_date') THEN
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
        IF entry.key IN('sales_price','reference_price','land_cost') THEN
          IF jsonb_typeof(val) IS DISTINCT FROM 'number' OR val::text !~ '^[0-9]+$'
            OR (val::text)::numeric>9007199254740991 THEN RAISE EXCEPTION '金額の形式が不正です: %',entry.key; END IF;
        ELSIF right(entry.key,5)='_date' THEN
          IF jsonb_typeof(val) IS DISTINCT FROM 'string' OR (val#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            RAISE EXCEPTION '日付の形式が不正です: %',entry.key;
          END IF;
          PERFORM (val#>>'{}')::date;
        ELSIF jsonb_typeof(val) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION '文字列を指定してください: %',entry.key;
        END IF;
      END IF;
      patch:=patch||jsonb_build_object(entry.key,val);
    END LOOP;
    result:=result||jsonb_build_object(scope_name,patch);
  END LOOP;
  IF result->'contract' ? 'equipment_contract_date'
    AND result->'contract'->'equipment_contract_date'='null'::jsonb
    AND (p_contract||(result->'contract'))->>'sale_contract_date' IS NOT NULL THEN
    RAISE EXCEPTION '旧売買契約日も引き継がない指定が必要です';
  END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.prepare_transfer_detail_choices(jsonb,jsonb,jsonb) FROM PUBLIC;
