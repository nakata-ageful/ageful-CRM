-- NEW DB ONLY. User confirmed classification on 2026-10-15.
-- Run only after 20261015052352_new_prospect_pending_customer.sql.
-- Does not delete placeholder customer records, alter any contract or merge 出水's two contracts.
-- 出水: existing placeholder owner is deliberately retained until a real transfer is confirmed;
-- neither its previous owner's identity nor ownership-ended date is invented.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS
 (SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN RAISE EXCEPTION 'Wrong project'; END IF;
END $$;
-- Freeze baseline business tables while comparing hashes; no lost concurrent edits.
LOCK TABLE public.customers,public.projects,public.contracts,public.prospects,public.annual_records,
 public.billing_units,public.billing_recipient_plans,public.ownership_transfers,
 public.ownership_workflow_events,public.maintenance_responses,public.periodic_maintenance IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE classify_undecided_baseline(table_name text PRIMARY KEY,hash text) ON COMMIT DROP;
ALTER TABLE classify_undecided_baseline ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON classify_undecided_baseline FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text;h text;BEGIN
 FOREACH t IN ARRAY ARRAY['customers','contracts','annual_records','billing_units','billing_recipient_plans','ownership_transfers',
  'ownership_workflow_events','maintenance_responses','periodic_maintenance'] LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb)::text) FROM public.%I r',t) INTO h;
  INSERT INTO classify_undecided_baseline VALUES(t,h);
 END LOOP;
 -- Non-target projects/prospects must remain byte-for-byte unchanged.
 INSERT INTO classify_undecided_baseline VALUES('other_projects',(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb)::text) FROM public.projects p WHERE id NOT IN(90,95,125))),
 ('other_prospects',(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb)::text) FROM public.prospects p WHERE id NOT IN(25,27,52)));
END $$;
DO $$ DECLARE target record;proj public.projects%ROWTYPE;pr public.prospects%ROWTYPE;before_p jsonb;before_pr jsonb;
 old_event public.new_prospect_events%ROWTYPE;actor uuid;fingerprint text;
BEGIN
 SELECT owner_user_id INTO STRICT actor FROM public.billing_runtime_control WHERE enabled;
 FOR target IN SELECT * FROM (VALUES
 (90::bigint,25::bigint,282::bigint,'東広島市黒瀬（上地）','new','2026-07-11T07:46:06.253271Z'::timestamptz,'13151515-1515-4515-8515-000000000090'::uuid),
 (95::bigint,27::bigint,286::bigint,'三次市高杉（佐脇）','new','2026-07-11T07:44:38.037707Z'::timestamptz,'13151515-1515-4515-8515-000000000095'::uuid),
 (125::bigint,52::bigint,307::bigint,'出水（フィネスコ）','transfer','2026-09-08T04:00:13.301509Z'::timestamptz,'13151515-1515-4515-8515-000000000125'::uuid)
 ) AS x(project_id,prospect_id,placeholder_id,plant_name,kind,expected_updated_at,operation_key) LOOP
  SELECT * INTO STRICT proj FROM public.projects WHERE id=target.project_id FOR UPDATE;
  SELECT * INTO STRICT pr FROM public.prospects WHERE id=target.prospect_id FOR UPDATE;
  fingerprint:=md5(jsonb_build_object('project',target.project_id,'prospect',target.prospect_id,'kind',target.kind,'classification','user-confirmed-20261015')::text);
  SELECT * INTO old_event FROM public.new_prospect_events WHERE operation_key=target.operation_key;
  IF FOUND THEN
   IF old_event.request_hash IS DISTINCT FROM fingerprint OR
    (target.kind='new' AND (pr.new_project_id IS DISTINCT FROM proj.id OR NOT proj.customer_pending OR proj.customer_id IS NOT NULL)) OR
    (target.kind='transfer' AND (pr.ownership_project_id IS DISTINCT FROM proj.id OR pr.ownership_state IS DISTINCT FROM 'open')) THEN
    RAISE EXCEPTION '分類後の案件が変更されています: %',target.project_id; END IF;
   CONTINUE;
  END IF;
  IF coalesce(proj.plant_name,proj.project_name) IS DISTINCT FROM target.plant_name OR proj.customer_id IS DISTINCT FROM target.placeholder_id
   OR pr.converted_customer_id IS DISTINCT FROM target.placeholder_id OR pr.updated_at IS DISTINCT FROM target.expected_updated_at
   OR pr.ownership_project_id IS NOT NULL OR pr.new_project_id IS NOT NULL OR proj.customer_pending
   OR proj.previous_owner_customer_id IS NOT NULL OR proj.owner_unconfirmed_on IS NOT NULL
   OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=target.placeholder_id AND trim(name)='未定') THEN
   RAISE EXCEPTION '対象案件の状態が事前確認と異なります: %',target.project_id; END IF;
  IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=proj.id)
   OR EXISTS(SELECT 1 FROM public.billing_recipient_plans WHERE project_id=proj.id)
   OR EXISTS(SELECT 1 FROM public.annual_records r JOIN public.contracts c ON c.id=r.contract_id WHERE c.project_id=proj.id)
   OR EXISTS(SELECT 1 FROM public.contracts WHERE project_id=proj.id AND (billing_method IS NOT NULL OR maintenance_start_date IS NOT NULL)) THEN
   RAISE EXCEPTION '請求・保守条件が追加されています。再確認が必要です: %',proj.id; END IF;
  IF (SELECT array_agg(id ORDER BY id) FROM public.contracts WHERE project_id=proj.id) IS DISTINCT FROM
   (CASE proj.id WHEN 90 THEN ARRAY[80::bigint] WHEN 95 THEN ARRAY[75::bigint] ELSE ARRAY[100::bigint,101::bigint] END) THEN
   RAISE EXCEPTION '契約の構成が事前確認と異なります: %',proj.id; END IF;
  before_p:=to_jsonb(proj);before_pr:=to_jsonb(pr);
  PERFORM set_config('ageful.new_prospect_write','yes',true);
  PERFORM set_config('ageful.ownership_workflow_write','yes',true);
  PERFORM set_config('ageful.billing_runtime_write','yes',true);
  IF target.kind='new' THEN
   UPDATE public.projects SET customer_id=NULL,customer_pending=true WHERE id=proj.id RETURNING * INTO proj;
   UPDATE public.prospects SET new_project_id=proj.id,converted_customer_id=NULL,converted_at=NULL,
    customer_name='顧客未定',customer_name_kana=NULL WHERE id=pr.id RETURNING * INTO pr;
  ELSE
   UPDATE public.prospects SET ownership_project_id=proj.id,ownership_state='open',candidate_customer_id=NULL,
    converted_customer_id=NULL,converted_at=NULL,customer_name='引継ぎ先未定',customer_name_kana=NULL WHERE id=pr.id RETURNING * INTO pr;
  END IF;
  -- Target metadata must be preserved apart from the explicit identity changes.
  IF (to_jsonb(proj)-ARRAY['customer_id','customer_pending','updated_at']) IS DISTINCT FROM (before_p-ARRAY['customer_id','customer_pending','updated_at']) OR
   (to_jsonb(pr)-ARRAY['new_project_id','ownership_project_id','ownership_state','candidate_customer_id','converted_customer_id','converted_at','customer_name','customer_name_kana','updated_at']) IS DISTINCT FROM
   (before_pr-ARRAY['new_project_id','ownership_project_id','ownership_state','candidate_customer_id','converted_customer_id','converted_at','customer_name','customer_name_kana','updated_at']) THEN
   RAISE EXCEPTION '対象案件の許可していない項目が変わりました'; END IF;
  INSERT INTO public.new_prospect_events(operation_key,request_hash,actor_user_id,action,project_id,prospect_id,before_snapshot,after_snapshot)
   VALUES(target.operation_key,fingerprint,actor,'legacy_classify',proj.id,pr.id,jsonb_build_object('project',before_p,'prospect',before_pr),
    jsonb_build_object('project',to_jsonb(proj),'prospect',to_jsonb(pr),'classification',target.kind,'placeholderOwnerRetained',target.kind='transfer'));
 END LOOP;
 PERFORM set_config('ageful.new_prospect_write','no',true);PERFORM set_config('ageful.ownership_workflow_write','no',true);PERFORM set_config('ageful.billing_runtime_write','no',true);
END $$;
DO $$ DECLARE r record;h text;BEGIN
 FOR r IN SELECT * FROM classify_undecided_baseline LOOP
  IF r.table_name='other_projects' THEN SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb)::text) INTO h FROM public.projects p WHERE id NOT IN(90,95,125);
  ELSIF r.table_name='other_prospects' THEN SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.id),'[]'::jsonb)::text) INTO h FROM public.prospects p WHERE id NOT IN(25,27,52);
  ELSE EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb)::text) FROM public.%I t',r.table_name) INTO h; END IF;
  IF h IS DISTINCT FROM r.hash THEN RAISE EXCEPTION '保護対象データが変わりました: %',r.table_name; END IF;
 END LOOP;
END $$;
COMMIT;
