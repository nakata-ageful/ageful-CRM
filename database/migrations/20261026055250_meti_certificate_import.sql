-- NEW app only. Adds one scoped writer; no existing row or schema column changes.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS(SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN RAISE EXCEPTION 'Wrong project: new app only';END IF;
END $$;
CREATE FUNCTION public.meti_certificate_apply(p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
 p public.projects%ROWTYPE;c public.customers%ROWTYPE;
 patch jsonb:=p_request->'patch';baseline jsonb:=p_request->'before';k text;v jsonb;typed public.projects%ROWTYPE;
 change_customer boolean:=coalesce((p_request->>'updateCustomer')::boolean,false);desired_address text:=p_request->>'customerAddress';
BEGIN
 IF public.billing_runtime_is_owner() IS NOT TRUE THEN RAISE EXCEPTION 'ログイン・利用権限を確認してください' USING ERRCODE='42501';END IF;
 IF jsonb_typeof(patch) IS DISTINCT FROM 'object' OR jsonb_typeof(baseline) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '反映内容を確認してください';END IF;
 IF (patch='{}'::jsonb AND NOT change_customer) OR pg_column_size(p_request)>100000 THEN RAISE EXCEPTION '反映する項目を確認してください';END IF;
 SELECT * INTO STRICT p FROM public.projects WHERE id=(p_request->>'projectId')::bigint FOR UPDATE;
 IF p.archived_at IS NOT NULL OR p.customer_id IS DISTINCT FROM (p_request->>'customerId')::bigint THEN RAISE EXCEPTION '所有者・発電所が更新されています。開き直してください';END IF;
 FOR k,v IN SELECT * FROM jsonb_each(patch) LOOP
  IF k NOT IN('grid_id','grid_certified_at','panel_maker','panel_model','panel_count','panel_kw','meti_notes') OR NOT (baseline ? k) OR v='null'::jsonb OR jsonb_typeof(v) NOT IN('string','number') OR length(trim(v#>>'{}'))=0 THEN RAISE EXCEPTION '反映できない項目があります';END IF;
  IF to_jsonb(p)->k IS DISTINCT FROM baseline->k AND to_jsonb(p)->k IS DISTINCT FROM v THEN RAISE EXCEPTION '登録内容が更新されています。開き直して比較してください';END IF;
 END LOOP;
 IF patch ? 'grid_id' AND (patch->>'grid_id') !~ '^[A-Z0-9]{6,30}$' THEN RAISE EXCEPTION '設備IDを確認してください';END IF;
 IF patch ? 'grid_certified_at' AND ((patch->>'grid_certified_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (patch->>'grid_certified_at')::date<'1900-01-01'::date) THEN RAISE EXCEPTION '認定日を確認してください';END IF;
 IF patch ? 'panel_count' AND ((patch->>'panel_count') !~ '^[0-9]+$' OR (patch->>'panel_count')::numeric NOT BETWEEN 1 AND 1000000) THEN RAISE EXCEPTION 'パネル枚数を確認してください';END IF;
 IF patch ? 'panel_kw' AND ((patch->>'panel_kw') !~ '^[0-9]+(\.[0-9]+)?$' OR (patch->>'panel_kw')::numeric NOT BETWEEN 0.001 AND 1000000) THEN RAISE EXCEPTION 'パネル合計出力を確認してください';END IF;
 IF length(patch->>'panel_maker')>300 OR length(patch->>'panel_model')>300 OR length(patch->>'meti_notes')>20000 THEN RAISE EXCEPTION '反映内容が長すぎます';END IF;
 IF change_customer THEN
  IF p.customer_id IS NULL OR desired_address IS NULL OR length(trim(desired_address)) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION '顧客の住所を確認してください';END IF;
  SELECT * INTO STRICT c FROM public.customers WHERE id=p.customer_id FOR UPDATE;
  IF c.address IS DISTINCT FROM (p_request->>'customerBefore') AND c.address IS DISTINCT FROM desired_address THEN RAISE EXCEPTION '顧客の住所が更新されています。開き直してください';END IF;
 END IF;
 typed:=jsonb_populate_record(p,patch);
 -- Only certificate fields can be written. Contracts, owners and billing are not touched.
 IF patch<>'{}'::jsonb AND EXISTS(SELECT 1 FROM jsonb_each(patch) e WHERE to_jsonb(p)->e.key IS DISTINCT FROM e.value) THEN
 UPDATE public.projects SET grid_id=typed.grid_id,grid_certified_at=typed.grid_certified_at,panel_maker=typed.panel_maker,
  panel_model=typed.panel_model,panel_count=typed.panel_count,panel_kw=typed.panel_kw,meti_notes=typed.meti_notes WHERE id=p.id;
 END IF;
 IF change_customer AND c.address IS DISTINCT FROM desired_address THEN UPDATE public.customers SET address=desired_address WHERE id=c.id;END IF;
 RETURN jsonb_build_object('applied',true);
END $$;
REVOKE ALL ON FUNCTION public.meti_certificate_apply(jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.meti_certificate_apply(jsonb) TO authenticated;
COMMENT ON FUNCTION public.meti_certificate_apply(jsonb) IS 'Explicit certificate field selection, row locks and compare-before-write. No billing, owner or contract updates. SECURITY INVOKER.';
COMMIT;
