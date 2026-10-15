-- NEW DB ONLY. Additive archive support; no existing record is archived here.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';
DO $$ BEGIN IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS
 (SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN RAISE EXCEPTION 'Wrong project'; END IF; END $$;
ALTER TABLE public.projects ADD COLUMN archived_at timestamptz,ADD COLUMN archive_reason text,
 ADD COLUMN canonical_project_id bigint REFERENCES public.projects(id) ON DELETE RESTRICT;
ALTER TABLE public.contracts ADD COLUMN archived_at timestamptz,ADD COLUMN archive_reason text,
 ADD COLUMN canonical_contract_id bigint REFERENCES public.contracts(id) ON DELETE RESTRICT;
ALTER TABLE public.projects ADD CONSTRAINT project_archive_consistent CHECK(
 (archived_at IS NULL AND archive_reason IS NULL AND canonical_project_id IS NULL) OR
 (archived_at IS NOT NULL AND archive_reason IS NOT NULL AND length(trim(archive_reason))>0 AND canonical_project_id IS NOT NULL AND canonical_project_id<>id));
ALTER TABLE public.contracts ADD CONSTRAINT contract_archive_consistent CHECK(
 (archived_at IS NULL AND archive_reason IS NULL AND canonical_contract_id IS NULL) OR
 (archived_at IS NOT NULL AND archive_reason IS NOT NULL AND length(trim(archive_reason))>0 AND canonical_contract_id IS NOT NULL AND canonical_contract_id<>id));
CREATE INDEX active_contract_project_idx ON public.contracts(project_id) WHERE archived_at IS NULL;
CREATE VIEW public.active_contracts WITH(security_invoker=true) AS SELECT * FROM public.contracts WHERE archived_at IS NULL;
REVOKE ALL ON public.active_contracts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.active_contracts TO authenticated;
CREATE TABLE public.duplicate_archive_events(
 operation_key uuid PRIMARY KEY,actor_user_id uuid NOT NULL,reason text NOT NULL,
 before_snapshot jsonb NOT NULL,after_snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.duplicate_archive_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.duplicate_archive_events FROM PUBLIC,anon,authenticated;
CREATE TRIGGER duplicate_archive_events_immutable BEFORE UPDATE OR DELETE ON public.duplicate_archive_events FOR EACH ROW EXECUTE FUNCTION public.reject_audit_row_mutation();

-- Only operational readers/writers change their contract relation. Backups,
-- inspection evidence and audit snapshots retain the physical archived rows.
-- Persist exact before/after function definitions as migration audit evidence.
CREATE TABLE public.archive_function_patches(signature text PRIMARY KEY,before_definition text NOT NULL,after_definition text NOT NULL);
ALTER TABLE public.archive_function_patches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.archive_function_patches FROM PUBLIC,anon,authenticated;
DO $$ DECLARE f record;body text;patched text;allowed text[]:=ARRAY[
 'transfer_ownership_manual','transfer_ownership_inherit','create_future_schedule','set_billing_service_period',
 'write_billing_cycle_rule','ownership_workflow_write','billing_runtime_write','billing_runtime_write_before_ownership',
 'billing_runtime_write_before_removal','billing_runtime_write_before_cycles','new_prospect_write','accept_billing_migration',
 'write_manual_billing_plan','write_invoice_unit','write_invoice_schedule','create_invoice_plan','create_manual_debit_plan',
 'write_invoice_recipient_plan','record_manual_debit_result','initialize_invoice_recipients','import_invoice_source',
 'confirm_imported_round','preserve_maintenance_source','guard_legacy_invoice_creation'];
BEGIN
 FOR f IN SELECT p.oid,p.proname,p.oid::regprocedure::text signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prokind='f' AND p.proname=ANY(allowed) LOOP
  body:=pg_get_functiondef(f.oid);
  patched:=regexp_replace(body,'(FROM|JOIN|UPDATE)([[:space:]]+)public\.contracts([[:space:]])','\1\2public.active_contracts\3','gi');
  IF patched<>body THEN
   INSERT INTO public.archive_function_patches VALUES(f.signature,body,patched);
   EXECUTE patched;
   IF pg_get_functiondef(f.oid) ~* '(FROM|JOIN|UPDATE)[[:space:]]+public\.contracts[[:space:]]' THEN
    RAISE EXCEPTION 'An operational contract reference was not updated: %',f.signature;END IF;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM public.archive_function_patches WHERE signature LIKE '%transfer_ownership_manual(%') OR
 NOT EXISTS(SELECT 1 FROM public.archive_function_patches WHERE signature LIKE '%ownership_workflow_write(%') OR
 NOT EXISTS(SELECT 1 FROM public.archive_function_patches WHERE signature LIKE '%write_billing_cycle_rule(%') THEN
 RAISE EXCEPTION 'Inspect deployed writer function sources before applying archive support'; END IF;
END $$;
CREATE TRIGGER archive_function_patches_immutable BEFORE UPDATE OR DELETE ON public.archive_function_patches FOR EACH ROW EXECUTE FUNCTION public.reject_audit_row_mutation();

-- Archive metadata is never an editable ownership-transfer field, including a
-- misleading "keep" choice supplied by an outdated/custom client.
DO $$ DECLARE body text;patched text;fragment text:='''ownership_transfer_date'') THEN';BEGIN
 body:=pg_get_functiondef('public.prepare_transfer_detail_choices(jsonb,jsonb,jsonb)'::regprocedure);
 IF (length(body)-length(replace(body,fragment,'')))/length(fragment)<>1 THEN RAISE EXCEPTION 'Inspect transfer field validator before archive migration';END IF;
 patched:=replace(body,fragment,'''ownership_transfer_date'',''archived_at'',''archive_reason'',''canonical_project_id'',''canonical_contract_id'') THEN');
 INSERT INTO public.archive_function_patches VALUES('prepare_transfer_detail_choices(jsonb,jsonb,jsonb)',body,patched);
 EXECUTE patched;
END $$;

CREATE FUNCTION public.guard_duplicate_archive_parent() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION '保管済みデータも削除せず残してください'; END IF;
 IF TG_OP='UPDATE' AND OLD.archived_at IS NOT NULL THEN RAISE EXCEPTION '保管済みの記録は変更できません'; END IF;
 IF TG_OP='INSERT' AND NEW.archived_at IS NOT NULL THEN RAISE EXCEPTION '保管済みの状態では作成できません'; END IF;
 IF TG_OP='UPDATE' AND (NEW.archived_at IS DISTINCT FROM OLD.archived_at OR NEW.archive_reason IS DISTINCT FROM OLD.archive_reason OR
  (to_jsonb(NEW)->'canonical_project_id') IS DISTINCT FROM (to_jsonb(OLD)->'canonical_project_id') OR
  (to_jsonb(NEW)->'canonical_contract_id') IS DISTINCT FROM (to_jsonb(OLD)->'canonical_contract_id')) THEN
  IF current_setting('ageful.archive_unused_write',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION '保管設定は専用の確認手順で行ってください'; END IF;
  IF TG_TABLE_NAME='contracts' THEN
   IF EXISTS(SELECT 1 FROM public.annual_records WHERE contract_id=OLD.id) OR EXISTS(SELECT 1 FROM public.billing_units WHERE contract_id=OLD.id)
    OR EXISTS(SELECT 1 FROM public.invoice_import_evidence WHERE (contract_snapshot->>'id')::bigint=OLD.id) THEN
    RAISE EXCEPTION '請求記録に使用された契約は保管できません'; END IF;
   PERFORM id FROM public.contracts WHERE id=NEW.canonical_contract_id AND archived_at IS NULL FOR KEY SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION '引継ぎ先の契約が無効です'; END IF;
  ELSE
   IF EXISTS(SELECT 1 FROM public.contracts WHERE project_id=OLD.id AND archived_at IS NULL) OR
    EXISTS(SELECT 1 FROM public.prospects WHERE ownership_project_id=OLD.id OR new_project_id=OLD.id) OR
    EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=OLD.id) OR
    EXISTS(SELECT 1 FROM public.billing_recipient_plans WHERE project_id=OLD.id) OR
    EXISTS(SELECT 1 FROM public.invoice_import_evidence WHERE project_id=OLD.id) OR
    EXISTS(SELECT 1 FROM public.invoice_recipient_initializations WHERE project_id=OLD.id) OR
    EXISTS(SELECT 1 FROM public.project_management_events WHERE project_id=OLD.id) OR
    EXISTS(SELECT 1 FROM public.maintenance_responses WHERE project_id=OLD.id) OR
    EXISTS(SELECT 1 FROM public.periodic_maintenance WHERE project_id=OLD.id) OR
    EXISTS(SELECT 1 FROM public.ownership_transfers WHERE project_id=OLD.id) OR
    EXISTS(SELECT 1 FROM public.billing_cycle_rules WHERE project_id=OLD.id) THEN RAISE EXCEPTION '運用記録のある発電所は保管できません'; END IF;
   PERFORM id FROM public.projects WHERE id=NEW.canonical_project_id AND archived_at IS NULL FOR KEY SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION '引継ぎ先の発電所が無効です'; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='contracts' THEN
  PERFORM id FROM public.projects WHERE id=NEW.project_id AND archived_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '保管済みの発電所には契約を作成・変更できません'; END IF;
 IF TG_OP='INSERT' OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
  IF EXISTS(SELECT 1 FROM public.contracts WHERE project_id=NEW.project_id AND archived_at IS NULL AND id<>NEW.id) THEN
   RAISE EXCEPTION '発電所の契約は登録済みです。契約を追加せず既存契約を編集してください'; END IF;
 END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER archive_parent_guard BEFORE INSERT OR UPDATE OR DELETE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.guard_duplicate_archive_parent();
CREATE TRIGGER archive_parent_guard BEFORE INSERT OR UPDATE OR DELETE ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.guard_duplicate_archive_parent();
REVOKE ALL ON FUNCTION public.guard_duplicate_archive_parent() FROM PUBLIC,anon,authenticated;

-- Reject new operations against archived parents, including callers of older
-- private RPCs. Reading their preserved rows for an audit is still permitted.
CREATE FUNCTION public.guard_archived_parent_reference() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v jsonb;pid bigint;cid bigint;BEGIN
 IF TG_OP='UPDATE' THEN
  v:=to_jsonb(OLD);pid:=(v->>'project_id')::bigint;cid:=(v->>'contract_id')::bigint;
  IF TG_TABLE_NAME='prospects' THEN pid:=coalesce((v->>'ownership_project_id')::bigint,(v->>'new_project_id')::bigint);END IF;
  IF pid IS NULL AND cid IS NOT NULL THEN SELECT project_id INTO pid FROM public.contracts WHERE id=cid;END IF;
  PERFORM id FROM public.projects WHERE id=pid FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.projects WHERE id=pid AND archived_at IS NOT NULL) OR
   EXISTS(SELECT 1 FROM public.contracts WHERE id=cid AND archived_at IS NOT NULL) THEN RAISE EXCEPTION '保管済みの記録は変更できません'; END IF;
 END IF;
 v:=to_jsonb(NEW);pid:=(v->>'project_id')::bigint;cid:=(v->>'contract_id')::bigint;
 IF TG_TABLE_NAME='prospects' THEN pid:=coalesce((v->>'ownership_project_id')::bigint,(v->>'new_project_id')::bigint);END IF;
 IF pid IS NULL AND cid IS NOT NULL THEN SELECT project_id INTO pid FROM public.contracts WHERE id=cid;END IF;
 PERFORM id FROM public.projects WHERE id=pid FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.projects WHERE id=pid AND archived_at IS NOT NULL) OR
  EXISTS(SELECT 1 FROM public.contracts WHERE id=cid AND archived_at IS NOT NULL) THEN RAISE EXCEPTION '保管済みの発電所・契約には登録できません'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_archived_parent_reference() FROM PUBLIC,anon,authenticated;
DO $$ DECLARE t record;BEGIN
 FOR t IN SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables tb ON tb.table_schema=c.table_schema AND tb.table_name=c.table_name
  WHERE c.table_schema='public' AND tb.table_type='BASE TABLE' AND (c.column_name='project_id' OR c.table_name='prospects' AND c.column_name='ownership_project_id')
  AND c.table_name NOT IN('contracts','ownership_workflow_events','new_prospect_events') GROUP BY c.table_name LOOP
  EXECUTE format('CREATE TRIGGER archive_reference_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_archived_parent_reference()',t.table_name);
 END LOOP;
 CREATE TRIGGER archive_reference_guard BEFORE INSERT OR UPDATE ON public.annual_records FOR EACH ROW EXECUTE FUNCTION public.guard_archived_parent_reference();
END $$;

ALTER FUNCTION public.billing_runtime_snapshot() RENAME TO billing_runtime_snapshot_before_archive;
REVOKE ALL ON FUNCTION public.billing_runtime_snapshot_before_archive() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.billing_runtime_snapshot() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 PERFORM public.assert_billing_runtime_access();RETURN public.billing_runtime_snapshot_before_archive()||jsonb_build_object('duplicate_archive_ready',true);
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_snapshot() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_runtime_snapshot() TO authenticated;
ALTER FUNCTION public.billing_runtime_backup() RENAME TO billing_runtime_backup_before_archive;
REVOKE ALL ON FUNCTION public.billing_runtime_backup_before_archive() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.billing_runtime_backup() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 PERFORM public.assert_billing_runtime_access();RETURN public.billing_runtime_backup_before_archive()||jsonb_build_object('duplicate_archive_ready',true,
 'duplicate_archive_events',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY created_at,operation_key) FROM public.duplicate_archive_events e),'[]'::jsonb),
 'archive_function_patches',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY signature) FROM public.archive_function_patches e),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_backup() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_runtime_backup() TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
