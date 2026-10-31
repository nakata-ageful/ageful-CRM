-- New app only. No data migration, new columns, billing, ownership or contract writes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS(SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN RAISE EXCEPTION 'Wrong project: new app only';END IF;
END $$;
CREATE OR REPLACE FUNCTION public.power_contract_apply(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
 p public.projects%ROWTYPE;typed public.projects%ROWTYPE;
 patch jsonb:=p_request->'patch';baseline jsonb:=p_request->'before';k text;v jsonb;
BEGIN
 IF public.billing_runtime_is_owner() IS NOT TRUE THEN RAISE EXCEPTION 'ログイン・利用権限を確認してください' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(patch) IS DISTINCT FROM 'object' OR jsonb_typeof(baseline) IS DISTINCT FROM 'object' OR patch='{}'::jsonb OR pg_column_size(p_request)>100000 THEN RAISE EXCEPTION '反映する項目を確認してください';END IF;
 SELECT * INTO STRICT p FROM public.projects WHERE id=(p_request->>'projectId')::bigint FOR UPDATE;
 IF p.archived_at IS NOT NULL OR p.customer_id IS DISTINCT FROM (p_request->>'customerId')::bigint THEN RAISE EXCEPTION '所有者・発電所が更新されています。開き直してください';END IF;
 FOR k,v IN SELECT * FROM jsonb_each(patch) LOOP
  IF k NOT IN('grid_id','grid_certified_at','generation_point_id','power_supply_start_date','power_change_date','fit_period','fit_end_date','power_company_notes') OR NOT (baseline ? k) OR v='null'::jsonb OR length(trim(v#>>'{}'))=0 THEN RAISE EXCEPTION '反映できない項目があります';END IF;
  IF (k='fit_period' AND jsonb_typeof(v)<>'number') OR (k<>'fit_period' AND jsonb_typeof(v)<>'string') THEN RAISE EXCEPTION '反映内容の形式を確認してください';END IF;
  IF to_jsonb(p)->k IS DISTINCT FROM baseline->k AND to_jsonb(p)->k IS DISTINCT FROM v THEN RAISE EXCEPTION '登録内容が更新されています。開き直して比較してください';END IF;
  IF k IN('grid_certified_at','power_supply_start_date','power_change_date','fit_end_date') THEN
   IF (v#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (v#>>'{}')::date<'1900-01-01'::date THEN RAISE EXCEPTION '日付を確認してください';END IF;
   IF k='fit_end_date' AND extract(day from (v#>>'{}')::date)<>1 THEN RAISE EXCEPTION 'FIT期間の年月を確認してください';END IF;
  END IF;
 END LOOP;
 IF patch ? 'grid_id' AND (patch->>'grid_id') !~ '^[A-Z0-9]{6,30}$' THEN RAISE EXCEPTION '設備IDを確認してください';END IF;
 IF patch ? 'generation_point_id' AND (patch->>'generation_point_id') !~ '^[0-9]{2}(-[0-9]{4}){5}$' THEN RAISE EXCEPTION '受給地点番号を確認してください';END IF;
 IF patch ? 'fit_period' AND ((patch->>'fit_period') !~ '^[0-9]+$' OR (patch->>'fit_period')::numeric NOT BETWEEN 1 AND 1000) THEN RAISE EXCEPTION 'FITは整数の円単位です。小数を丸めず内容を確認してください';END IF;
 IF length(patch->>'power_company_notes')>20000 THEN RAISE EXCEPTION '備考が長すぎます';END IF;
 typed:=jsonb_populate_record(p,patch);
 IF EXISTS(SELECT 1 FROM jsonb_each(patch) e WHERE to_jsonb(p)->e.key IS DISTINCT FROM e.value) THEN
  UPDATE public.projects SET grid_id=typed.grid_id,grid_certified_at=typed.grid_certified_at,
   generation_point_id=typed.generation_point_id,power_supply_start_date=typed.power_supply_start_date,
   power_change_date=typed.power_change_date,fit_period=typed.fit_period,fit_end_date=typed.fit_end_date,
   power_company_notes=typed.power_company_notes WHERE id=p.id;
 END IF;
 RETURN jsonb_build_object('applied',true);
END $$;
REVOKE ALL ON FUNCTION public.power_contract_apply(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.power_contract_apply(jsonb) TO authenticated;
COMMENT ON FUNCTION public.power_contract_apply(jsonb) IS 'Explicit utility contract field selection, compare-before-write and row lock. No owner, customer, billing, maintenance or contract-table writes. SECURITY INVOKER.';
COMMIT;
