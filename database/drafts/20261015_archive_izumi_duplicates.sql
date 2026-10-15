-- User-authorized repair, NEW DB ONLY, no deletes. Run after relink + archive schema.
-- HUGエナジー is maintenance_contractor (受託会社), NOT subcontractor (委託先).
BEGIN;
SET LOCAL request.headers='{"x-ageful-client":"ledger-v1"}';
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';
DO $$ BEGIN IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS
 (SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN RAISE EXCEPTION 'Wrong project'; END IF; END $$;
LOCK TABLE public.customers,public.projects,public.contracts,public.prospects,public.annual_records,public.billing_units,
 public.billing_recipient_plans,public.billing_unit_events,public.ownership_transfers,public.ownership_workflow_events,
 public.new_prospect_events,public.maintenance_responses,public.periodic_maintenance,public.duplicate_archive_events IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE izumi_archive_baseline(table_name text PRIMARY KEY,hash text) ON COMMIT DROP;
ALTER TABLE izumi_archive_baseline ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON izumi_archive_baseline FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text;h text;BEGIN
 FOREACH t IN ARRAY ARRAY['customers','prospects','annual_records','billing_units','billing_recipient_plans','billing_unit_events',
 'ownership_transfers','ownership_workflow_events','new_prospect_events','maintenance_responses','periodic_maintenance'] LOOP
  EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb)::text) FROM public.%I r',t) INTO h;
  INSERT INTO izumi_archive_baseline VALUES(t,h);
 END LOOP;
 INSERT INTO izumi_archive_baseline VALUES('projects_normalized',(SELECT md5(coalesce(jsonb_agg(
  CASE WHEN id=125 THEN to_jsonb(p)-ARRAY['archived_at','archive_reason','canonical_project_id','updated_at'] ELSE to_jsonb(p) END ORDER BY id),'[]'::jsonb)::text) FROM public.projects p)),
 ('contracts_normalized',(SELECT md5(coalesce(jsonb_agg(CASE WHEN id=98 THEN to_jsonb(c)-ARRAY['maintenance_contractor','updated_at']
  WHEN id IN(99,100,101) THEN to_jsonb(c)-ARRAY['archived_at','archive_reason','canonical_contract_id','updated_at'] ELSE to_jsonb(c) END ORDER BY id),'[]'::jsonb)::text) FROM public.contracts c));
END $$;
DO $$ DECLARE p public.projects%ROWTYPE;c public.contracts%ROWTYPE;kept public.contracts%ROWTYPE;actor uuid;
 prior public.duplicate_archive_events%ROWTYPE;before_value jsonb;
 op uuid:='35103510-1515-4515-8515-000000000124';
 reason_value text:='利用者確認：元の出水に受託会社HUGエナジーを引き継ぎ、未使用の重複発電所・契約は削除せず保管';
BEGIN
 PERFORM id FROM public.projects WHERE id IN(124,125) ORDER BY id FOR UPDATE;
 PERFORM id FROM public.contracts WHERE id IN(98,99,100,101) ORDER BY id FOR UPDATE;
 SELECT * INTO prior FROM public.duplicate_archive_events WHERE operation_key=op;
 IF FOUND THEN
  IF prior.reason IS DISTINCT FROM reason_value OR
   NOT EXISTS(SELECT 1 FROM public.projects WHERE id=125 AND archived_at IS NOT NULL AND canonical_project_id=124) OR
   (SELECT count(*) FROM public.contracts WHERE id IN(99,100,101) AND archived_at IS NOT NULL AND canonical_contract_id=98)<>3 OR
   NOT EXISTS(SELECT 1 FROM public.contracts WHERE id=98 AND archived_at IS NULL AND maintenance_contractor='HUGエナジー') THEN
   RAISE EXCEPTION '保管後の状態が変更されています'; END IF;
  RETURN;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=124 AND project_name='出水' AND customer_id=306 AND archived_at IS NULL) OR
  NOT EXISTS(SELECT 1 FROM public.projects WHERE id=125 AND project_name='出水（フィネスコ）' AND customer_id=307 AND archived_at IS NULL) OR
  NOT EXISTS(SELECT 1 FROM public.customers WHERE id=306 AND company_name='フィネスコ㈱') OR
  NOT EXISTS(SELECT 1 FROM public.customers WHERE id=307 AND name='未定') OR
  NOT EXISTS(SELECT 1 FROM public.prospects WHERE id=52 AND ownership_project_id=124 AND ownership_state='open' AND candidate_customer_id IS NULL) OR
  (SELECT array_agg(id ORDER BY id) FROM public.contracts WHERE project_id=124) IS DISTINCT FROM ARRAY[98::bigint,99::bigint] OR
  (SELECT array_agg(id ORDER BY id) FROM public.contracts WHERE project_id=125) IS DISTINCT FROM ARRAY[100::bigint,101::bigint] THEN
  RAISE EXCEPTION '出水・見込み・契約の状態を再確認してください'; END IF;
 SELECT * INTO STRICT kept FROM public.contracts WHERE id=98;
 IF kept.maintenance_contractor IS NOT NULL OR NOT EXISTS(SELECT 1 FROM public.contracts WHERE id=100 AND maintenance_contractor='HUGエナジー') THEN
  RAISE EXCEPTION '受託会社の引継ぎ元・引継ぎ先が事前確認と異なります'; END IF;
 FOR c IN SELECT * FROM public.contracts WHERE id IN(99,100,101) LOOP
  IF (to_jsonb(c)-ARRAY['id','project_id','created_at','updated_at','maintenance_contractor']) IS DISTINCT FROM
   (to_jsonb(kept)-ARRAY['id','project_id','created_at','updated_at','maintenance_contractor']) OR c.archived_at IS NOT NULL THEN
   RAISE EXCEPTION '契約に受託会社以外の差異があります: %',c.id; END IF;
  IF c.id IN(99,101) AND c.maintenance_contractor IS NOT NULL THEN RAISE EXCEPTION '別の受託会社が入力されています'; END IF;
 END LOOP;
 before_value:=jsonb_build_object('projects',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.projects x WHERE id IN(124,125)),
  'contracts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.contracts x WHERE id IN(98,99,100,101)),
  'prospect',(SELECT to_jsonb(x) FROM public.prospects x WHERE id=52));
 SELECT owner_user_id INTO STRICT actor FROM public.billing_runtime_control WHERE enabled;
 PERFORM set_config('ageful.archive_unused_write','yes',true);
 UPDATE public.contracts SET maintenance_contractor='HUGエナジー' WHERE id=98;
 UPDATE public.contracts SET archived_at=clock_timestamp(),archive_reason=reason_value,canonical_contract_id=98 WHERE id IN(99,100,101);
 UPDATE public.projects SET archived_at=clock_timestamp(),archive_reason=reason_value,canonical_project_id=124 WHERE id=125;
 PERFORM set_config('ageful.archive_unused_write','no',true);
 INSERT INTO public.duplicate_archive_events(operation_key,actor_user_id,reason,before_snapshot,after_snapshot)
 VALUES(op,actor,reason_value,before_value,jsonb_build_object('projects',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.projects x WHERE id IN(124,125)),
  'contracts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.contracts x WHERE id IN(98,99,100,101)),
  'prospect',(SELECT to_jsonb(x) FROM public.prospects x WHERE id=52),
  'protected_hashes',(SELECT jsonb_object_agg(table_name,hash) FROM izumi_archive_baseline)));
END $$;
DO $$ DECLARE r record;h text;BEGIN
 FOR r IN SELECT * FROM izumi_archive_baseline LOOP
  IF r.table_name='projects_normalized' THEN SELECT md5(coalesce(jsonb_agg(CASE WHEN id=125 THEN to_jsonb(p)-ARRAY['archived_at','archive_reason','canonical_project_id','updated_at'] ELSE to_jsonb(p) END ORDER BY id),'[]'::jsonb)::text) INTO h FROM public.projects p;
  ELSIF r.table_name='contracts_normalized' THEN SELECT md5(coalesce(jsonb_agg(CASE WHEN id=98 THEN to_jsonb(c)-ARRAY['maintenance_contractor','updated_at'] WHEN id IN(99,100,101) THEN to_jsonb(c)-ARRAY['archived_at','archive_reason','canonical_contract_id','updated_at'] ELSE to_jsonb(c) END ORDER BY id),'[]'::jsonb)::text) INTO h FROM public.contracts c;
  ELSE EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb)::text) FROM public.%I t',r.table_name) INTO h;END IF;
  IF h IS DISTINCT FROM r.hash THEN RAISE EXCEPTION '保護対象が変わりました: %',r.table_name;END IF;
 END LOOP;
END $$;
COMMIT;
