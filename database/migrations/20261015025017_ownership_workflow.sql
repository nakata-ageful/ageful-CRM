-- Generated with Supabase CLI migration new ownership_workflow.
-- NEW DB ONLY. Deploy the version-2/3/4-compatible client before applying.
-- Additive workflow: no legacy customer named "未定" is created or migrated.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS(SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN
    RAISE EXCEPTION 'Wrong project: ownership workflow is for the new application only'; END IF;
END $$;
CREATE TEMP TABLE ownership_migration_baseline(table_name text PRIMARY KEY,hash text) ON COMMIT DROP;
ALTER TABLE ownership_migration_baseline ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ownership_migration_baseline FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t text; h text; BEGIN
  FOREACH t IN ARRAY ARRAY['customers','projects','contracts','annual_records','prospects','billing_units','billing_recipient_plans','ownership_transfers'] LOOP
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(r) ORDER BY to_jsonb(r)::text),''[]''::jsonb)::text) FROM public.%I r',t) INTO h;
    INSERT INTO ownership_migration_baseline VALUES(t,h);
  END LOOP;
END $$;
ALTER TABLE public.projects ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.projects ADD COLUMN previous_owner_customer_id bigint REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE public.projects ADD COLUMN owner_unconfirmed_on date;
ALTER TABLE public.projects ADD CONSTRAINT owner_unconfirmed_consistent CHECK
  ((owner_unconfirmed_on IS NULL AND customer_id IS NOT NULL) OR
   (owner_unconfirmed_on IS NOT NULL AND customer_id IS NULL AND previous_owner_customer_id IS NOT NULL));
ALTER TABLE public.prospects ADD COLUMN ownership_project_id bigint REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.prospects ADD COLUMN candidate_customer_id bigint REFERENCES public.customers(id) ON DELETE RESTRICT;
ALTER TABLE public.prospects ADD COLUMN ownership_state text CHECK(ownership_state IN('open','completed','cancelled'));
ALTER TABLE public.prospects ADD CONSTRAINT ownership_prospect_consistent CHECK
  ((ownership_project_id IS NULL AND ownership_state IS NULL AND candidate_customer_id IS NULL) OR
   (ownership_project_id IS NOT NULL AND ownership_state IS NOT NULL AND converted_customer_id IS NULL));
CREATE INDEX prospects_ownership_project_idx ON public.prospects(ownership_project_id) WHERE ownership_project_id IS NOT NULL;
-- An undecided listing and several named candidates may coexist; the selected
-- buyer is finalized explicitly. A failed candidate never changes current owner.
CREATE TABLE public.ownership_workflow_events(
  operation_key uuid PRIMARY KEY,
  request_hash text NOT NULL,
  project_id bigint NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  prospect_id bigint REFERENCES public.prospects(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN('start','candidate','unknown','complete','cancel')),
  effective_on date,
  reason text NOT NULL,
  before_snapshot jsonb NOT NULL,
  after_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  schema_version smallint NOT NULL DEFAULT 1 CHECK(schema_version=1)
);
ALTER TABLE public.ownership_workflow_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ownership_workflow_events FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.ownership_workflow_write(p_key uuid,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v jsonb:=p_request->'value'; a text:=p_request->>'action'; p bigint:=(v->>'projectId')::bigint;
  customer_id_value bigint:=(v->>'customerId')::bigint; pr_id bigint:=(v->>'prospectId')::bigint;
  proj public.projects%ROWTYPE; pr public.prospects%ROWTYPE; cust public.customers%ROWTYPE;
  previous public.ownership_workflow_events%ROWTYPE; fingerprint text; before_value jsonb; after_value jsonb;
  effective date:=(v->>'date')::date; reason_value text:=trim(v->>'reason'); result jsonb;
BEGIN
  PERFORM public.assert_billing_runtime_access();
  IF p_key IS NULL OR p IS NULL OR a NOT IN('start','candidate','unknown','complete','cancel')
    OR reason_value IS NULL OR reason_value='' THEN RAISE EXCEPTION '手続きの内容と理由を確認してください'; END IF;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('request',p_request,'actor',auth.uid())::text,'UTF8')),'hex');
  -- Project lock also serializes retries of a start request before an event exists.
  SELECT * INTO STRICT proj FROM public.projects WHERE id=p FOR UPDATE;
  SELECT * INTO previous FROM public.ownership_workflow_events WHERE operation_key=p_key;
  IF FOUND THEN
    IF previous.request_hash IS DISTINCT FROM fingerprint OR previous.actor_user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION '同じ操作IDで別の内容は保存できません'; END IF;
    RETURN jsonb_build_object('completed',true,'prospectId',previous.prospect_id);
  END IF;
  IF to_jsonb(proj) IS DISTINCT FROM v->'project' THEN RAISE EXCEPTION '発電所が更新されています。開き直してください'; END IF;
  IF pr_id IS NOT NULL THEN
    SELECT * INTO STRICT pr FROM public.prospects WHERE id=pr_id FOR UPDATE;
    IF pr.ownership_project_id IS DISTINCT FROM p OR pr.ownership_state IS DISTINCT FROM 'open'
      OR to_jsonb(pr) IS DISTINCT FROM v->'prospect' THEN RAISE EXCEPTION '見込みが更新されています。開き直してください'; END IF;
  END IF;
  IF customer_id_value IS NOT NULL THEN
    SELECT * INTO STRICT cust FROM public.customers WHERE id=customer_id_value FOR KEY SHARE;
    IF customer_id_value=proj.customer_id THEN RAISE EXCEPTION '現在と別の顧客を選択してください'; END IF;
  END IF;
  IF a='unknown' THEN
    PERFORM id FROM public.contracts WHERE project_id=p ORDER BY id FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.annual_records r JOIN public.contracts c ON c.id=r.contract_id WHERE c.project_id=p)
      AND NOT EXISTS(SELECT 1 FROM public.billing_migration_acceptances WHERE project_id=p) THEN
      RAISE EXCEPTION '過去の請求記録の移行・照合が必要です'; END IF;
  END IF;
  before_value:=jsonb_build_object('project',to_jsonb(proj),'prospect',CASE WHEN pr_id IS NULL THEN NULL ELSE to_jsonb(pr) END,
    'contract',(SELECT jsonb_agg(to_jsonb(c)) FROM public.contracts c WHERE c.project_id=p));
  PERFORM set_config('ageful.ownership_workflow_write','yes',true);
  PERFORM set_config('ageful.billing_runtime_write','yes',true);
  IF a='start' THEN
    IF pr_id IS NOT NULL THEN RAISE EXCEPTION '新しい見込みの指定が不正です'; END IF;
    IF EXISTS(SELECT 1 FROM public.prospects WHERE ownership_project_id=p AND ownership_state='open'
      AND candidate_customer_id IS NOT DISTINCT FROM customer_id_value) THEN RAISE EXCEPTION '同じ引継ぎ先の見込みが登録済みです。見込み管理から開いてください'; END IF;
    INSERT INTO public.prospects(customer_name,customer_name_kana,project_name,ownership_project_id,candidate_customer_id,ownership_state,
      apply_status,contract_status,apply_tasks,contract_tasks,apply_sub_tasks,contract_sub_tasks,converted_customer_id)
      VALUES(CASE WHEN customer_id_value IS NULL THEN '引継ぎ先未定' ELSE coalesce(nullif(cust.company_name,''),cust.name) END,
        cust.name_kana,coalesce(proj.plant_name,proj.project_name),p,customer_id_value,'open','未','未','{}','{}','{}','{}',NULL) RETURNING * INTO pr;
    pr_id:=pr.id;
  ELSIF a='candidate' THEN
    IF pr_id IS NULL THEN RAISE EXCEPTION '見込みを指定してください'; END IF;
    IF pr.candidate_customer_id IS NOT NULL AND pr.candidate_customer_id IS DISTINCT FROM customer_id_value THEN
      RAISE EXCEPTION '別の候補者は、新しい引継ぎの見込みとして登録してください'; END IF;
    IF EXISTS(SELECT 1 FROM public.prospects WHERE ownership_project_id=p AND ownership_state='open' AND id<>pr_id
      AND candidate_customer_id IS NOT DISTINCT FROM customer_id_value) THEN RAISE EXCEPTION '同じ引継ぎ先の見込みが登録済みです'; END IF;
    UPDATE public.prospects SET candidate_customer_id=customer_id_value,
      customer_name=CASE WHEN customer_id_value IS NULL THEN '引継ぎ先未定' ELSE coalesce(nullif(cust.company_name,''),cust.name) END,
      customer_name_kana=cust.name_kana WHERE id=pr_id RETURNING * INTO pr;
  ELSIF a='cancel' THEN
    IF pr_id IS NULL THEN RAISE EXCEPTION '見込みを指定してください'; END IF;
    UPDATE public.prospects SET ownership_state='cancelled' WHERE id=pr_id RETURNING * INTO pr;
  ELSIF a='unknown' THEN
    IF effective IS NULL OR effective<'2000-01-01'::date OR effective>current_date OR proj.customer_id IS NULL THEN
      RAISE EXCEPTION 'Aさんの所有が終了した日を入力してください。未来の変更は見込みで管理してください'; END IF;
    IF effective<(SELECT max(transfer_date) FROM public.ownership_transfers WHERE project_id=p) THEN
      RAISE EXCEPTION '前の所有者変更より前の日付です'; END IF;
    PERFORM id FROM public.contracts WHERE project_id=p ORDER BY id FOR UPDATE;
    IF (SELECT count(*) FROM public.contracts WHERE project_id=p)<>1 THEN RAISE EXCEPTION '契約が1件ではありません'; END IF;
    PERFORM set_config('ageful.billing_runtime_write','yes',true);
    UPDATE public.projects SET previous_owner_customer_id=customer_id,customer_id=NULL,owner_unconfirmed_on=effective,
      old_owner=(SELECT name FROM public.customers WHERE id=proj.customer_id) WHERE id=p;
    -- Existing invoices and recipient choices are never reassigned. Retire only
    -- the default for future creation so A cannot be silently reused.
    UPDATE public.billing_recipient_plans SET retired_at=clock_timestamp(),revision=revision+1 WHERE project_id=p AND retired_at IS NULL;
  ELSIF a='complete' THEN
    IF v->'transfer'->'procedureConfirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION '引継ぎに必要な手続きの確認が必要です'; END IF;
    IF pr_id IS NULL OR pr.candidate_customer_id IS NULL OR pr.candidate_customer_id IS DISTINCT FROM (v->'transfer'->>'newOwner')::bigint
      OR (v->'transfer'->'project') IS DISTINCT FROM to_jsonb(proj) THEN RAISE EXCEPTION '引継ぎ先と発電所を確認してください'; END IF;
    IF pr.apply_status IN('不通','不可') OR pr.contract_status='不可' THEN RAISE EXCEPTION '進められない見込みです。申込・契約の状態を確認してください'; END IF;
    -- Explicit operator final confirmation, not a loan-status auto conversion.
    result:=public.billing_runtime_write_before_ownership(p_key,jsonb_build_object('action','transfer','value',v->'transfer'));
    PERFORM set_config('ageful.billing_runtime_write','yes',true);
    UPDATE public.prospects SET ownership_state='completed' WHERE id=pr_id RETURNING * INTO pr;
    UPDATE public.prospects SET ownership_state='cancelled' WHERE ownership_project_id=p AND ownership_state='open';
  END IF;
  SELECT jsonb_build_object('project',to_jsonb(t),'prospect',CASE WHEN pr_id IS NULL THEN NULL ELSE to_jsonb(pr) END)
    INTO after_value FROM public.projects t WHERE id=p;
  INSERT INTO public.ownership_workflow_events(operation_key,request_hash,project_id,prospect_id,actor_user_id,action,effective_on,reason,before_snapshot,after_snapshot)
    VALUES(p_key,fingerprint,p,pr_id,auth.uid(),a,effective,reason_value,before_value,after_value);
  PERFORM set_config('ageful.ownership_workflow_write','no',true);
  PERFORM set_config('ageful.billing_runtime_write','no',true);
  RETURN jsonb_build_object('completed',true,'prospectId',pr_id);
END $$;
REVOKE ALL ON FUNCTION public.ownership_workflow_write(uuid,jsonb) FROM PUBLIC,anon,authenticated;

-- Reuse the existing durable operation journal and its uncertain-save recovery.
ALTER FUNCTION public.billing_runtime_write(uuid,jsonb) RENAME TO billing_runtime_write_before_ownership;
REVOKE ALL ON FUNCTION public.billing_runtime_write_before_ownership(uuid,jsonb) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.billing_runtime_write(p_key uuid,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v jsonb; a text:=p_request->>'action'; BEGIN
  PERFORM public.assert_billing_runtime_access();
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR NOT(p_request ?& ARRAY['action','value'])
    OR (SELECT count(*) FROM jsonb_object_keys(p_request))<>2 OR jsonb_typeof(p_request->'value') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '保存要求の形式が不正です'; END IF;
  IF a='ownership_workflow' THEN RETURN public.ownership_workflow_write(p_key,p_request->'value'); END IF;
  IF a='transfer' THEN
    PERFORM id FROM public.projects WHERE id=(p_request->'value'->'project'->>'id')::bigint FOR UPDATE;
    IF EXISTS(SELECT 1 FROM public.prospects WHERE ownership_project_id=(p_request->'value'->'project'->>'id')::bigint AND ownership_state='open') THEN
      RAISE EXCEPTION '引継ぎ手続き中です。見込み管理から引継ぎを完了してください'; END IF;
  END IF;
  RETURN public.billing_runtime_write_before_ownership(p_key,p_request);
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_write(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_runtime_write(uuid,jsonb) TO authenticated;

-- NULL is a real unconfirmed owner, never a dummy customer. Preserve the prior
-- owner only as history when the existing final transfer RPC is used.
DO $$ DECLARE body text; fragment text; BEGIN
  body:=pg_get_functiondef('public.transfer_ownership_manual(uuid,bigint,bigint,date,jsonb,jsonb,jsonb,jsonb,text,bigint)'::regprocedure);
  FOREACH fragment IN ARRAY ARRAY['old_project.customer_id IS NULL','''customer_id'',p_owner,''old_owner'',old_name','IF p_date<old_contract.ownership_transfer_date'] LOOP
    IF (length(body)-length(replace(body,fragment,'')))/length(fragment)<>1 THEN RAISE EXCEPTION 'Inspect deployed transfer function before applying: %',fragment; END IF;
  END LOOP;
  body:=replace(body,'old_project.customer_id','coalesce(old_project.customer_id,old_project.previous_owner_customer_id)');
  body:=replace(body,'''customer_id'',p_owner,''old_owner'',old_name','''customer_id'',p_owner,''old_owner'',old_name,''previous_owner_customer_id'',coalesce(old_project.customer_id,old_project.previous_owner_customer_id),''owner_unconfirmed_on'',NULL');
  body:=replace(body,'IF p_date<old_contract.ownership_transfer_date','IF p_date<old_project.owner_unconfirmed_on OR p_date<old_contract.ownership_transfer_date');
  EXECUTE body;
END $$;

-- Advertise readiness only after every schema/helper change succeeds. No
-- additional public read endpoint or broader table grants are introduced.
ALTER FUNCTION public.billing_runtime_snapshot() RENAME TO billing_runtime_snapshot_before_ownership;
REVOKE ALL ON FUNCTION public.billing_runtime_snapshot_before_ownership() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.billing_runtime_snapshot() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
  PERFORM public.assert_billing_runtime_access();
  RETURN public.billing_runtime_snapshot_before_ownership()||jsonb_build_object('version',4,'ownership_workflow_ready',true,
    'ownership_workflow_events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at,operation_key) FROM public.ownership_workflow_events e),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_runtime_snapshot() TO authenticated;

-- Prevent accidental legacy CRUD from changing the identity/link or deleting
-- workflow history. Normal loan tasks, notes and dates remain editable.
CREATE FUNCTION public.guard_ownership_prospect() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
  IF current_setting('ageful.ownership_workflow_write',true)='yes' THEN RETURN coalesce(NEW,OLD); END IF;
  IF TG_OP='DELETE' AND OLD.ownership_project_id IS NOT NULL THEN RAISE EXCEPTION '引継ぎ見込みは取消操作で残してください'; END IF;
  IF TG_OP='UPDATE' AND OLD.ownership_project_id IS NOT NULL AND OLD.ownership_state<>'open' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION '完了・取下げ済みの手続きは変更できません'; END IF;
  IF TG_OP='UPDATE' AND (OLD.ownership_project_id IS NOT NULL OR NEW.ownership_project_id IS NOT NULL) AND
    (NEW.ownership_project_id IS DISTINCT FROM OLD.ownership_project_id OR NEW.candidate_customer_id IS DISTINCT FROM OLD.candidate_customer_id
      OR NEW.ownership_state IS DISTINCT FROM OLD.ownership_state OR NEW.converted_customer_id IS NOT NULL
      OR NEW.customer_name IS DISTINCT FROM OLD.customer_name OR NEW.project_name IS DISTINCT FROM OLD.project_name) THEN
    RAISE EXCEPTION '顧客の変更は「引継ぎ先を設定」から行ってください'; END IF;
  IF TG_OP='INSERT' AND NEW.ownership_project_id IS NOT NULL THEN RAISE EXCEPTION '引継ぎ見込みは専用操作で登録してください'; END IF;
  RETURN coalesce(NEW,OLD);
END $$;
CREATE TRIGGER guard_ownership_prospect BEFORE INSERT OR UPDATE OR DELETE ON public.prospects FOR EACH ROW EXECUTE FUNCTION public.guard_ownership_prospect();

CREATE FUNCTION public.guard_ownership_project_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$ BEGIN
  IF current_setting('ageful.billing_runtime_write',true)='yes' THEN RETURN NEW; END IF;
  IF NEW.previous_owner_customer_id IS DISTINCT FROM OLD.previous_owner_customer_id OR NEW.owner_unconfirmed_on IS DISTINCT FROM OLD.owner_unconfirmed_on THEN
    RAISE EXCEPTION '前の所有者と所有終了日は専用の手続きから変更してください'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_ownership_project_identity BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.guard_ownership_project_identity();

ALTER FUNCTION public.billing_runtime_backup() RENAME TO billing_runtime_backup_before_ownership;
REVOKE ALL ON FUNCTION public.billing_runtime_backup_before_ownership() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.billing_runtime_backup() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
  PERFORM public.assert_billing_runtime_access();
  RETURN public.billing_runtime_backup_before_ownership()||jsonb_build_object('ownership_workflow_ready',true,
    'ownership_workflow_events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at,operation_key) FROM public.ownership_workflow_events e),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_backup() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_runtime_backup() TO authenticated;
DO $$ DECLARE r record; h text; ignored text[]; BEGIN
  FOR r IN SELECT * FROM ownership_migration_baseline LOOP
    ignored:=CASE r.table_name WHEN 'projects' THEN ARRAY['previous_owner_customer_id','owner_unconfirmed_on']
      WHEN 'prospects' THEN ARRAY['ownership_project_id','candidate_customer_id','ownership_state'] ELSE ARRAY[]::text[] END;
    EXECUTE format('SELECT md5(coalesce(jsonb_agg(to_jsonb(t)-$1 ORDER BY (to_jsonb(t)-$1)::text),''[]''::jsonb)::text) FROM public.%I t',r.table_name) INTO h USING ignored;
    IF h IS DISTINCT FROM r.hash THEN RAISE EXCEPTION 'Business data changed during migration: %',r.table_name; END IF;
  END LOOP;
END $$;
COMMIT;
