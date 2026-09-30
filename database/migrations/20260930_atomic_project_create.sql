-- New application only. Install before deploying the client that calls this RPC.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.ageful_migration_target)<>1
    OR NOT EXISTS(SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN
    RAISE EXCEPTION 'Wrong project: atomic project creation is for the new application only';
  END IF;
END $$;

ALTER TABLE public.billing_operations DROP CONSTRAINT billing_operations_operation_kind_check;
ALTER TABLE public.billing_operations ADD CONSTRAINT billing_operations_operation_kind_check
  CHECK(operation_kind IN ('plan','issue','collection','correction','cancel','ownership_transfer','project_create'));

CREATE OR REPLACE FUNCTION public.create_project_with_contract(p_key uuid,p_customer_id bigint,p_project jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor uuid:=auth.uid(); fingerprint text; op public.billing_operations%ROWTYPE;
  created public.projects%ROWTYPE; columns_sql text; values_sql text;
  allowed text[]:=ARRAY['project_no','project_name','plant_name','summary_notes','meti_notes','power_company_notes',
    'site_postal_code','site_prefecture','site_address','latitude','longitude','google_coordinates',
    'panel_kw','panel_count','panel_maker','panel_model','panel_notes','pcs_kw','pcs_count','pcs_maker','pcs_model','pcs_notes',
    'grid_id','grid_certified_at','fit_period','fit_term_years','fit_end_date','power_supply_start_date',
    'customer_number','generation_point_id','meter_reading_day','monitoring_system','monitoring_model',
    'monitoring_id','monitoring_user','monitoring_pw','monitoring_notes','has_4g','key_number','local_association',
    'old_owner','sales_company','referrer','customer_referrer','project_referrer','power_change_date','handover_date',
    'sales_price','reference_price','land_cost','amuras_member_no','notes'];
BEGIN
  PERFORM public.assert_billing_runtime_access();
  IF p_key IS NULL OR p_customer_id IS NULL OR p_customer_id<=0
    OR jsonb_typeof(p_project) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '案件追加の内容を確認してください';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_project) k WHERE NOT(k=ANY(allowed)))
    OR jsonb_typeof(p_project->'project_name') IS DISTINCT FROM 'string'
    OR length(trim(p_project->>'project_name'))=0 THEN
    RAISE EXCEPTION '案件名・入力項目を確認してください';
  END IF;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','project_create',
    'customer',p_customer_id,'project',p_project,'actor',actor)::text,'UTF8')),'hex');
  -- Serialize the same operation before creating its parent project. Retries
  -- return the existing project rather than creating a second project/contract.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text,0));
  SELECT * INTO op FROM public.billing_operations WHERE operation_key=p_key FOR UPDATE;
  IF FOUND THEN
    IF op.operation_kind<>'project_create' OR op.actor_user_id IS DISTINCT FROM actor
      OR op.request_hash IS DISTINCT FROM fingerprint OR op.completed_at IS NULL THEN
      RAISE EXCEPTION '同じ案件追加の操作IDで別の内容は保存できません';
    END IF;
    SELECT * INTO STRICT created FROM public.projects WHERE id=op.project_id;
    RETURN to_jsonb(created);
  END IF;
  PERFORM id FROM public.customers WHERE id=p_customer_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION '顧客が見つかりません'; END IF;
  SELECT string_agg(format('%I',k),',' ORDER BY k),string_agg(format('r.%I',k),',' ORDER BY k)
    INTO columns_sql,values_sql FROM jsonb_object_keys(p_project) k;
  EXECUTE format('INSERT INTO public.projects(customer_id,%s) SELECT $2,%s FROM jsonb_populate_record(NULL::public.projects,$1) r RETURNING *',columns_sql,values_sql)
    INTO created USING p_project,p_customer_id;
  -- The new-project acceptance trigger and this contract insert share this
  -- transaction. Any error also rolls back the project and acceptance record.
  INSERT INTO public.contracts(project_id) VALUES(created.id);
  INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id,completed_at)
    VALUES(p_key,'project_create',created.id,fingerprint,actor,clock_timestamp());
  RETURN to_jsonb(created);
END $$;
REVOKE ALL ON FUNCTION public.create_project_with_contract(uuid,bigint,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_project_with_contract(uuid,bigint,jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_project_with_contract(uuid,bigint,jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
