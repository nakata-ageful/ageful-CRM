-- NEW DB ONLY. Synthetic RPC smoke test. All created rows roll back.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS(SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN RAISE EXCEPTION 'Wrong project'; END IF;
 PERFORM set_config('request.jwt.claims',(SELECT jsonb_build_object('sub',owner_user_id,'role','authenticated')::text FROM public.billing_runtime_control WHERE enabled),true);
END $$;
SET LOCAL request.headers='{"x-ageful-client":"ledger-v1"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE result jsonb;first_result jsonb;proj jsonb;pr jsonb;test_customer bigint;
 k uuid:=gen_random_uuid();request jsonb:=jsonb_build_object('action','create','value',jsonb_build_object('customer_undecided',true,'customer_name','','project_name','検証専用・保存しない架空案件'));
 billing_before text;billing_after text;
BEGIN
 SELECT md5((public.billing_runtime_snapshot()->'units')::text) INTO billing_before;
 result:=public.new_prospect_write(k,request);first_result:=result;
 IF public.new_prospect_write(k,request) IS DISTINCT FROM result THEN RAISE EXCEPTION 'Replay mismatch'; END IF;
 SELECT to_jsonb(p) INTO STRICT proj FROM public.projects p WHERE id=(result->>'projectId')::bigint;
 SELECT to_jsonb(p) INTO STRICT pr FROM public.prospects p WHERE id=(result->>'prospectId')::bigint;
 IF proj->'customer_id'<>'null'::jsonb OR proj->>'customer_pending'<>'true' OR pr->'converted_customer_id'<>'null'::jsonb THEN RAISE EXCEPTION 'Pending identity mismatch'; END IF;
 INSERT INTO public.customers(name) VALUES('検証専用・保存しない架空顧客') RETURNING id INTO test_customer;
 result:=public.new_prospect_write(gen_random_uuid(),jsonb_build_object('action','assign','value',jsonb_build_object('project',proj,'prospect',pr,'customerId',test_customer)));
 IF result->>'projectId' IS DISTINCT FROM first_result->>'projectId' OR result->>'prospectId' IS DISTINCT FROM first_result->>'prospectId'
 OR NOT EXISTS(SELECT 1 FROM public.projects WHERE id=(result->>'projectId')::bigint AND customer_id=test_customer AND NOT customer_pending)
 OR (SELECT count(*) FROM public.contracts WHERE project_id=(result->>'projectId')::bigint)<>1 THEN RAISE EXCEPTION 'Assignment mismatch'; END IF;
 SELECT md5((public.billing_runtime_snapshot()->'units')::text) INTO billing_after;
 IF billing_before IS DISTINCT FROM billing_after THEN RAISE EXCEPTION 'Billing changed'; END IF;
END $$;
SELECT 'PASS: authenticated create, same-key replay, initial assignment, single contract and unchanged billing; all test rows rolled back next' AS validation;
ROLLBACK;
