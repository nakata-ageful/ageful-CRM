-- User authorized relinking only, 2026-10-15. NEW DB ONLY. No deletes/contract edits.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
SET LOCAL request.headers='{"x-ageful-client":"ledger-v1"}';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS
 (SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN RAISE EXCEPTION 'Wrong project'; END IF;
END $$;
LOCK TABLE public.customers,public.projects,public.contracts,public.prospects,public.annual_records,
 public.billing_units,public.billing_recipient_plans,public.ownership_transfers,public.ownership_workflow_events,
 public.new_prospect_events,public.maintenance_responses,public.periodic_maintenance IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE izumi_relink_baseline(table_name text PRIMARY KEY,hash text) ON COMMIT DROP;
ALTER TABLE izumi_relink_baseline ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON izumi_relink_baseline FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text;h text;BEGIN
 FOREACH t IN ARRAY ARRAY['customers','projects','contracts','annual_records','billing_units','billing_recipient_plans',
 'ownership_transfers','ownership_workflow_events','maintenance_responses','periodic_maintenance'] LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb)::text) FROM public.%I r',t) INTO h;
  INSERT INTO izumi_relink_baseline VALUES(t,h);
 END LOOP;
 INSERT INTO izumi_relink_baseline VALUES('other_prospects',(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb)::text) FROM public.prospects p WHERE id<>52)),
 ('old_audits',(SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY operation_key),'[]'::jsonb)::text) FROM public.new_prospect_events e WHERE operation_key<>'24102410-1515-4515-8515-000000000052'));
END $$;
DO $$ DECLARE source public.projects%ROWTYPE;target public.projects%ROWTYPE;pr public.prospects%ROWTYPE;
 prior public.new_prospect_events%ROWTYPE;actor uuid;before_pr jsonb;key uuid:='24102410-1515-4515-8515-000000000052';
 fingerprint text:=md5('user-authorized-20261015:prospect52:125-to-124:relink-only-no-delete');
BEGIN
 SELECT * INTO STRICT target FROM public.projects WHERE id=124 FOR UPDATE;
 SELECT * INTO STRICT source FROM public.projects WHERE id=125 FOR UPDATE;
 SELECT * INTO STRICT pr FROM public.prospects WHERE id=52 FOR UPDATE;
 SELECT * INTO prior FROM public.new_prospect_events WHERE operation_key=key;
 IF FOUND THEN
  IF prior.request_hash IS DISTINCT FROM fingerprint OR prior.project_id<>124 OR prior.prospect_id<>52
   OR pr.ownership_project_id IS DISTINCT FROM 124 THEN RAISE EXCEPTION '修正後の紐づけが変わっています'; END IF;
  RETURN;
 END IF;
 IF target.project_name IS DISTINCT FROM '出水' OR target.customer_id IS DISTINCT FROM 306 OR source.project_name IS DISTINCT FROM '出水（フィネスコ）'
  OR source.customer_id IS DISTINCT FROM 307 OR target.customer_pending OR source.customer_pending
  OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=306 AND company_name='フィネスコ㈱')
  OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=307 AND name='未定') THEN RAISE EXCEPTION '元の出水と追加側の状態を再確認してください'; END IF;
 IF pr.ownership_project_id IS DISTINCT FROM 125 OR pr.ownership_state IS DISTINCT FROM 'open'
  OR pr.candidate_customer_id IS NOT NULL OR pr.converted_customer_id IS NOT NULL OR pr.new_project_id IS NOT NULL
  OR pr.project_name IS DISTINCT FROM source.project_name OR pr.customer_name IS DISTINCT FROM '引継ぎ先未定' THEN
  RAISE EXCEPTION '見込みが変更されています。再確認してください'; END IF;
 IF EXISTS(SELECT 1 FROM public.prospects WHERE ownership_project_id=124 AND ownership_state='open' AND candidate_customer_id IS NULL AND id<>52) THEN
  RAISE EXCEPTION '元の出水に未定の引継ぎ見込みが既にあります'; END IF;
 IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=125 OR contract_id IN(100,101))
  OR EXISTS(SELECT 1 FROM public.annual_records WHERE contract_id IN(100,101))
  OR EXISTS(SELECT 1 FROM public.billing_recipient_plans WHERE project_id=125)
  OR EXISTS(SELECT 1 FROM public.maintenance_responses WHERE project_id=125)
  OR EXISTS(SELECT 1 FROM public.periodic_maintenance WHERE project_id=125) THEN RAISE EXCEPTION '追加側に運用記録があり、再確認が必要です'; END IF;
 IF (SELECT array_agg(id ORDER BY id) FROM public.contracts WHERE project_id=124) IS DISTINCT FROM ARRAY[98::bigint,99::bigint]
  OR (SELECT array_agg(id ORDER BY id) FROM public.contracts WHERE project_id=125) IS DISTINCT FROM ARRAY[100::bigint,101::bigint] THEN
  RAISE EXCEPTION '契約の構成が変わっています'; END IF;
 SELECT owner_user_id INTO STRICT actor FROM public.billing_runtime_control WHERE enabled;
 before_pr:=to_jsonb(pr);
 PERFORM set_config('ageful.ownership_workflow_write','yes',true);
 UPDATE public.prospects SET ownership_project_id=124,project_name=target.project_name WHERE id=52 RETURNING * INTO pr;
 PERFORM set_config('ageful.ownership_workflow_write','no',true);
 IF (to_jsonb(pr)-ARRAY['ownership_project_id','project_name','updated_at']) IS DISTINCT FROM
  (before_pr-ARRAY['ownership_project_id','project_name','updated_at']) THEN RAISE EXCEPTION '許可していない見込みの項目が変わりました'; END IF;
 INSERT INTO public.new_prospect_events(operation_key,request_hash,actor_user_id,action,project_id,prospect_id,before_snapshot,after_snapshot)
 VALUES(key,fingerprint,actor,'legacy_classify',124,52,
  jsonb_build_object('from_project',to_jsonb(source),'to_project',to_jsonb(target),'prospect',before_pr,
   'contracts',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.contracts c WHERE project_id IN(124,125))),
  jsonb_build_object('from_project',to_jsonb(source),'to_project',to_jsonb(target),'prospect',to_jsonb(pr),
   'correction','relink-duplicate-listing-to-existing-project','reason','利用者確認：既存出水を未定にできず新規登録したため。削除せず見込みの参照先だけ修正',
   'protected_hashes',(SELECT jsonb_object_agg(table_name,hash) FROM izumi_relink_baseline)));
END $$;
DO $$ DECLARE r record;h text;BEGIN
 FOR r IN SELECT * FROM izumi_relink_baseline LOOP
  IF r.table_name='other_prospects' THEN SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY id),'[]'::jsonb)::text) INTO h FROM public.prospects p WHERE id<>52;
  ELSIF r.table_name='old_audits' THEN SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY operation_key),'[]'::jsonb)::text) INTO h FROM public.new_prospect_events e WHERE operation_key<>'24102410-1515-4515-8515-000000000052';
  ELSE EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb)::text) FROM public.%I t',r.table_name) INTO h; END IF;
  IF h IS DISTINCT FROM r.hash THEN RAISE EXCEPTION '保護対象が変わりました: %',r.table_name; END IF;
 END LOOP;
END $$;
COMMIT;
