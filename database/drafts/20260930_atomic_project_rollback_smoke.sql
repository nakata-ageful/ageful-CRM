-- New DB only. All synthetic business writes and trigger changes roll back.
-- PostgreSQL sequence numbers may advance; existing rows are never rewritten.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL request.headers='{"x-ageful-client":"ledger-v1"}';
DO $$ BEGIN
 IF (SELECT count(*) FROM ageful_migration_target)<>1
 OR NOT EXISTS(SELECT 1 FROM ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn')
 THEN RAISE EXCEPTION 'Wrong test target'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub',(SELECT owner_user_id::text FROM public.billing_runtime_control WHERE enabled),true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE k uuid:=gen_random_uuid(); c bigint; p jsonb; repeated jsonb;
BEGIN
 SELECT min(id) INTO c FROM public.customers;
 p:=public.create_project_with_contract(k,c,jsonb_build_object('project_name','架空・一括保存試験','has_4g',false,'panel_kw',49.5));
 repeated:=public.create_project_with_contract(k,c,jsonb_build_object('project_name','架空・一括保存試験','has_4g',false,'panel_kw',49.5));
 IF p->>'id' IS DISTINCT FROM repeated->>'id'
 OR (SELECT count(*) FROM public.contracts WHERE project_id=(p->>'id')::bigint)<>1
 THEN RAISE EXCEPTION 'Atomic save/retry verification failed'; END IF;
 BEGIN
  PERFORM public.create_project_with_contract(k,c,jsonb_build_object('project_name','変更した架空案件'));
  RAISE EXCEPTION 'Changed request was accepted';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%別の内容%' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
CREATE FUNCTION pg_temp.fail_atomic_contract() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'synthetic contract failure'; END $$;
CREATE TRIGGER ageful_atomic_smoke_failure BEFORE INSERT ON public.contracts
FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_atomic_contract();
SELECT set_config('ageful.atomic_smoke_counts',jsonb_build_object(
 'p',(SELECT count(*) FROM projects),'c',(SELECT count(*) FROM contracts),
 'o',(SELECT count(*) FROM billing_operations),'a',(SELECT count(*) FROM billing_migration_acceptances))::text,true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE c bigint; BEGIN
 SELECT min(id) INTO c FROM public.customers;
 BEGIN
  PERFORM public.create_project_with_contract(gen_random_uuid(),c,jsonb_build_object('project_name','架空・失敗試験'));
  RAISE EXCEPTION 'Contract failure did not propagate';
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'synthetic contract failure' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF current_setting('ageful.atomic_smoke_counts')::jsonb IS DISTINCT FROM jsonb_build_object(
 'p',(SELECT count(*) FROM projects),'c',(SELECT count(*) FROM contracts),
 'o',(SELECT count(*) FROM billing_operations),'a',(SELECT count(*) FROM billing_migration_acceptances))
 THEN RAISE EXCEPTION 'Failed save left partial rows'; END IF;
 IF has_function_privilege('anon','public.create_project_with_contract(uuid,bigint,jsonb)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.create_project_with_contract(uuid,bigint,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'RPC grant mismatch'; END IF;
END $$;
ROLLBACK;
SELECT jsonb_build_object('atomic_save_and_retry','passed','changed_request_rejected','passed',
 'contract_failure_rollback','passed','test_rows_committed',false,
 'project_count',(SELECT count(*) FROM projects),'contract_count',(SELECT count(*) FROM contracts),
 'rpc_present',to_regprocedure('public.create_project_with_contract(uuid,bigint,jsonb)') IS NOT NULL) AS result;
