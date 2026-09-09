-- LOCAL DRAFT. Apply only after import, initialization, inspection and legacy guards.
-- No owner is provisioned and nothing is enabled by this script.
DO $$ BEGIN IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF; END $$;
CREATE TABLE public.billing_runtime_control (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  owner_user_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  future_schedule_coverage_verified boolean NOT NULL DEFAULT false
);
ALTER TABLE public.billing_runtime_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_runtime_control FROM PUBLIC;

CREATE FUNCTION public.accept_billing_migration(p_project bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE report jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  PERFORM id FROM public.projects WHERE id=p_project FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '発電所がありません'; END IF;
  PERFORM id FROM public.contracts WHERE project_id=p_project ORDER BY id FOR UPDATE;
  PERFORM a.id FROM public.annual_records a JOIN public.contracts c ON c.id=a.contract_id
    WHERE c.project_id=p_project ORDER BY a.id FOR UPDATE OF a;
  IF EXISTS(SELECT 1 FROM public.billing_migration_acceptances WHERE project_id=p_project) THEN
    RAISE EXCEPTION '受入済みです。移行前点検として再承認できません'; END IF;
  IF EXISTS(SELECT 1 FROM public.annual_records a JOIN public.contracts c ON c.id=a.contract_id WHERE c.project_id=p_project) THEN
    report:=public.inspect_invoice_initialization(p_project);
    IF report->'initialization_checks_passed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION '移行後の照合に合格していません'; END IF;
  ELSE
    IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=p_project)
      OR EXISTS(SELECT 1 FROM public.ownership_transfers WHERE project_id=p_project) THEN
      RAISE EXCEPTION '元記録なしの対象に既存請求または移転履歴があります'; END IF;
    report:=jsonb_build_object('empty_source',true);
  END IF;
  INSERT INTO public.billing_migration_acceptances(project_id,report,actor_user_id) VALUES(p_project,report,auth.uid());
  RETURN report;
END $$;

-- Application-data backup in ONE SQL snapshot. Auth accounts, Storage objects and
-- deployment DDL are intentionally outside this JSON and need a separate backup.
CREATE FUNCTION public.billing_runtime_backup() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE expressions text[]:=ARRAY[]::text[]; t text; result jsonb;
BEGIN
  PERFORM public.assert_billing_runtime_access();
  FOREACH t IN ARRAY ARRAY['customers','projects','contracts','annual_records','maintenance_responses','periodic_maintenance','prospects','attachments',
    'billing_units','billing_operations','billing_recipient_plans','billing_recipient_plan_overrides','billing_unit_events','ownership_transfers',
    'invoice_import_evidence','invoice_recipient_initializations','billing_migration_acceptances','billing_runtime_control'] LOOP
    expressions:=array_append(expressions,format('%L,(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),''[]''::jsonb) FROM public.%I t)',t,t));
  END LOOP;
  EXECUTE 'SELECT jsonb_build_object(''version'',2,''exported_at'',transaction_timestamp(),''backup_scope'',''application_data_only'','||array_to_string(expressions,',')||')' INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_backup() FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN GRANT EXECUTE ON FUNCTION public.billing_runtime_backup() TO authenticated; END IF; END $$;
REVOKE ALL ON FUNCTION public.accept_billing_migration(bigint) FROM PUBLIC;

CREATE FUNCTION public.assert_billing_runtime_access() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.billing_runtime_control WHERE owner_user_id=auth.uid() AND enabled) THEN
    RAISE EXCEPTION 'ログイン・利用権限・切替設定を確認してください' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.billing_runtime_control WHERE future_schedule_coverage_verified) THEN
    RAISE EXCEPTION '通常画面に出ていた今後の請求予定との照合が完了していません'; END IF;
  IF EXISTS(SELECT 1 FROM public.projects p WHERE NOT EXISTS(SELECT 1 FROM public.billing_migration_acceptances a WHERE a.project_id=p.id)) THEN
    RAISE EXCEPTION '全発電所の移行確認が完了していません'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.assert_billing_runtime_access() FROM PUBLIC;

CREATE FUNCTION public.billing_runtime_snapshot() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  PERFORM public.assert_billing_runtime_access();
  SELECT jsonb_build_object('version',1,'ready',true,
    'units',(SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY id),'[]') FROM public.billing_units u),
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]') FROM public.billing_unit_events e),
    'transfers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.ownership_transfers t)) INTO result;
  RETURN result;
END $$;

CREATE FUNCTION public.billing_runtime_write(p_key uuid,p_request jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r jsonb:=p_request; v jsonb; action text:=p_request->>'action'; result jsonb;
BEGIN
  PERFORM public.assert_billing_runtime_access();
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR NOT(r ?& ARRAY['action','value'])
    OR (SELECT count(*) FROM jsonb_object_keys(r))<>2 OR jsonb_typeof(r->'value') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '保存要求の形式が不正です'; END IF;
  v:=r->'value';
  -- Only this entry point can temporarily allow protected legacy parent updates.
  PERFORM set_config('ageful.billing_runtime_write','yes',true);
  IF action='invoice' THEN
    IF v->>'mode' LIKE 'debit_%' THEN
      result:=public.record_manual_debit_result(p_key,(v->>'unitId')::bigint,(v->>'revision')::integer,
        CASE v->>'mode' WHEN 'debit_received' THEN 'received' WHEN 'debit_correction' THEN 'correction' WHEN 'debit_invoice_switch' THEN 'invoice_switch' ELSE '' END,v->'value',v->>'reason');
    ELSE
      result:=public.write_invoice_unit(p_key,(v->>'unitId')::bigint,(v->>'revision')::integer,v->>'mode',v->'value',v->>'reason');
    END IF;
  ELSIF action='transfer' THEN
    result:=public.transfer_ownership_manual(p_key,(v->'project'->>'id')::bigint,(v->>'newOwner')::bigint,(v->>'date')::date,
      v->'project',v->'contract',v->'fields',v->'choices',v->>'reason',(v->>'futureRecipient')::bigint);
  ELSIF action='plan' THEN
    result:=public.write_manual_billing_plan(p_key,(v->>'projectId')::bigint,v->'choices',v->>'reason');
  ELSIF action='debit_add' THEN
    result:=public.create_manual_debit_plan(p_key,(v->>'projectId')::bigint,(v->>'contractId')::bigint,(v->>'recipient')::bigint,
      (v->>'year')::integer,(v->>'month')::integer,(v->>'date')::date,(v->>'amount')::bigint,v->>'note',v->>'reason');
  ELSE RAISE EXCEPTION '未対応の保存操作です'; END IF;
  PERFORM set_config('ageful.billing_runtime_write','no',true);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_snapshot(),public.billing_runtime_write(uuid,jsonb) FROM PUBLIC;
-- Only authenticated transport may call the two narrow entry points. They still require the single configured owner.
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
  GRANT EXECUTE ON FUNCTION public.billing_runtime_snapshot(),public.billing_runtime_write(uuid,jsonb) TO authenticated;
END IF; END $$;

CREATE FUNCTION public.guard_billing_legacy_parents() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.billing_runtime_control WHERE enabled) THEN
    IF TG_OP='TRUNCATE' THEN RETURN NULL; END IF;
    RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION '切替後の一括削除はできません'; END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION '請求履歴保護のため削除できません'; END IF;
  IF current_setting('ageful.billing_runtime_write',true)='yes' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME='projects' AND to_jsonb(NEW)->'customer_id' IS DISTINCT FROM to_jsonb(OLD)->'customer_id' THEN
    RAISE EXCEPTION '所有者は所有者変更画面から変更してください'; END IF;
  IF TG_TABLE_NAME='contracts' AND (to_jsonb(NEW)->'project_id' IS DISTINCT FROM to_jsonb(OLD)->'project_id'
    OR to_jsonb(NEW)->'ownership_transfer_date' IS DISTINCT FROM to_jsonb(OLD)->'ownership_transfer_date') THEN
    RAISE EXCEPTION '契約の発電所・移転日を直接変更できません'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_billing_legacy_parents() FROM PUBLIC;
CREATE TRIGGER runtime_project_guard BEFORE UPDATE OR DELETE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.guard_billing_legacy_parents();
CREATE TRIGGER runtime_contract_guard BEFORE UPDATE OR DELETE ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.guard_billing_legacy_parents();
CREATE TRIGGER runtime_customer_guard BEFORE DELETE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.guard_billing_legacy_parents();
CREATE TRIGGER runtime_project_truncate BEFORE TRUNCATE ON public.projects FOR EACH STATEMENT EXECUTE FUNCTION public.guard_billing_legacy_parents();
CREATE TRIGGER runtime_contract_truncate BEFORE TRUNCATE ON public.contracts FOR EACH STATEMENT EXECUTE FUNCTION public.guard_billing_legacy_parents();
CREATE TRIGGER runtime_customer_truncate BEFORE TRUNCATE ON public.customers FOR EACH STATEMENT EXECUTE FUNCTION public.guard_billing_legacy_parents();

-- Do not inherit Supabase default table grants on newly created financial/audit tables.
DO $$ DECLARE role_name text; t text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      FOREACH t IN ARRAY ARRAY['billing_runtime_control','billing_migration_acceptances','billing_operations','billing_recipient_plans',
        'billing_recipient_plan_overrides','billing_units','billing_unit_events','ownership_transfers','invoice_import_evidence','invoice_recipient_initializations'] LOOP
        EXECUTE format('REVOKE ALL ON public.%I FROM %I',t,role_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.accept_new_runtime_project() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.billing_runtime_control WHERE enabled) THEN
    IF NOT EXISTS(SELECT 1 FROM public.billing_runtime_control WHERE enabled AND owner_user_id=auth.uid()) THEN
      RAISE EXCEPTION '利用権限がありません' USING ERRCODE='42501'; END IF;
    INSERT INTO public.billing_migration_acceptances(project_id,report,actor_user_id)
      VALUES(NEW.id,jsonb_build_object('new_project_without_legacy',true),auth.uid());
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.accept_new_runtime_project() FROM PUBLIC;
CREATE TRIGGER runtime_new_project AFTER INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION public.accept_new_runtime_project();

CREATE FUNCTION public.billing_runtime_is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS(SELECT 1 FROM public.billing_runtime_control WHERE enabled AND owner_user_id=auth.uid())
$$;
REVOKE ALL ON FUNCTION public.billing_runtime_is_owner() FROM PUBLIC;
-- A restrictive policy also constrains old permissive policies; an extra permissive
-- owner policy keeps authorized existing operations usable where no policy existed.
DO $$ DECLARE t text; BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.billing_runtime_is_owner() TO authenticated;
    FOREACH t IN ARRAY ARRAY['customers','projects','contracts','annual_records','maintenance_responses','periodic_maintenance','prospects','attachments'] LOOP
      IF to_regclass('public.'||t) IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
        EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO authenticated',t);
        EXECUTE format('CREATE POLICY billing_single_owner_limit ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(public.billing_runtime_is_owner()) WITH CHECK(public.billing_runtime_is_owner())',t);
        EXECUTE format('CREATE POLICY billing_single_owner_allow ON public.%I FOR ALL TO authenticated USING(public.billing_runtime_is_owner()) WITH CHECK(public.billing_runtime_is_owner())',t);
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN EXECUTE format('REVOKE ALL ON public.%I FROM anon',t); END IF;
      END IF;
    END LOOP;
  END IF;
END $$;

CREATE FUNCTION public.billing_runtime_has_transfer(p_customer bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM public.assert_billing_runtime_access();
  RETURN EXISTS(SELECT 1 FROM public.ownership_transfers WHERE from_customer_id=p_customer OR to_customer_id=p_customer);
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_has_transfer(bigint) FROM PUBLIC;
DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN GRANT EXECUTE ON FUNCTION public.billing_runtime_has_transfer(bigint) TO authenticated; END IF; END $$;

CREATE FUNCTION public.guard_billing_client_version() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public.billing_runtime_control WHERE enabled)
    AND current_setting('ageful.billing_runtime_write',true) IS DISTINCT FROM 'yes'
    AND coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-ageful-client','')<>'ledger-v1' THEN
    RAISE EXCEPTION '古い画面からの保存を停止しました。新しい画面を開き直してください'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.guard_billing_client_version() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['customers','projects','contracts','annual_records','prospects','maintenance_responses','periodic_maintenance','attachments'] LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('CREATE TRIGGER billing_client_version BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_billing_client_version()',t);
    END IF;
  END LOOP;
END $$;
