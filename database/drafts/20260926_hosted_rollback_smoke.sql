-- USER-APPROVED new-DB-only smoke. No COMMIT; fixture rows are rolled back.
-- Identity sequences may consume numbers. Never execute against the old DB.
-- Tests real hosted PostgreSQL/Auth role semantics, NOT browser/HTTP saves.
BEGIN;
SET LOCAL statement_timeout='60s';
SET LOCAL lock_timeout='5s';
SET LOCAL timezone='UTC';
LOCK TABLE public.customers,public.projects,public.contracts,public.annual_records,
 public.maintenance_responses,public.periodic_maintenance,public.prospects,public.attachments,
 public.billing_units,public.billing_operations,public.billing_recipient_plans,public.billing_recipient_plan_overrides,
 public.billing_unit_events,public.ownership_transfers,public.invoice_import_evidence,public.invoice_recipient_initializations,
 public.billing_migration_acceptances,public.billing_runtime_control,public.project_management_events IN SHARE ROW EXCLUSIVE MODE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn')<>1
 OR EXISTS(SELECT 1 FROM public.billing_runtime_control) OR (SELECT count(*) FROM public.billing_units)<>32
 OR (SELECT sum(frozen_amount) FROM public.billing_units)<>4177465
 OR EXISTS(SELECT 1 FROM public.customers WHERE id IN(900000001,900000002))
 OR EXISTS(SELECT 1 FROM public.projects WHERE id BETWEEN 900000011 AND 900000014)
 THEN RAISE EXCEPTION 'Wrong target or changed baseline'; END IF;
END $$;
SET LOCAL request.jwt.claim.sub='9a4b877c-d73d-4c37-a902-40c521240d06';
SET LOCAL request.jwt.claims='{"sub":"9a4b877c-d73d-4c37-a902-40c521240d06","role":"authenticated"}';
SET LOCAL request.headers='{"x-ageful-client":"ledger-v1"}';
INSERT INTO public.customers(id,name) VALUES(900000001,'ROLLBACK TEST A'),(900000002,'ROLLBACK TEST B');
DO $$ DECLARE i integer; p bigint; m text; BEGIN
 FOR i IN 1..4 LOOP
  p:=900000010+i; m:=CASE WHEN i<=2 THEN '請求書' ELSE '口座振替' END;
  INSERT INTO public.projects(id,customer_id,project_name) VALUES(p,900000001,'ROLLBACK TEST '||i);
  INSERT INTO public.contracts(id,project_id,billing_method,billing_count,billing_schedule_days,annual_maintenance_inc,maintenance_start_date)
   VALUES(p,p,m,CASE WHEN m='請求書' THEN 1 ELSE 12 END,CASE WHEN m='請求書' THEN '["12月1日"]'::jsonb ELSE '["1日"]'::jsonb END,82500,'2026-01-01');
  INSERT INTO public.billing_migration_acceptances(project_id,report,actor_user_id) VALUES(p,'{"synthetic_smoke":true}',auth.uid());
  INSERT INTO public.billing_units(id,project_id,contract_id,recipient_customer_id,recipient_source,occurrence_key,service_year,round_number,
   scheduled_date,original_method,collection_method,lifecycle,collection_state,planned_amount,period_start,period_end)
   OVERRIDING SYSTEM VALUE VALUES(900000100+i,p,p,900000001,'confirmed','maintenance:2026:round:1',2026,1,'2026-12-01',
   CASE WHEN m='請求書' THEN 'invoice' ELSE 'direct_debit' END,CASE WHEN m='請求書' THEN 'invoice' ELSE 'direct_debit' END,
   'planned','pending',82500,'2026-01-01','2026-12-31');
 END LOOP;
END $$;
INSERT INTO public.billing_runtime_control(owner_user_id,enabled,future_schedule_coverage_verified,cutover_on)
 VALUES('9a4b877c-d73d-4c37-a902-40c521240d06',true,true,'2026-09-26');
SET LOCAL ROLE authenticated;
DO $$ DECLARE i integer; p bigint; u bigint; method text; request jsonb; k uuid; snap jsonb; before_reject jsonb; after_reject jsonb;
 project_json jsonb; contract_json jsonb; revision integer; unit_json jsonb; rejected boolean;
BEGIN
 IF auth.uid() IS DISTINCT FROM '9a4b877c-d73d-4c37-a902-40c521240d06'::uuid THEN RAISE EXCEPTION 'Auth context mismatch'; END IF;
 FOR i IN 1..4 LOOP
  p:=900000010+i;u:=900000100+i;method:=CASE WHEN i IN(1,3) THEN '請求書' ELSE '口座振替' END;
  SELECT to_jsonb(t) INTO project_json FROM public.projects t WHERE id=p;
  SELECT to_jsonb(t) INTO contract_json FROM public.contracts t WHERE id=p;
  k:=gen_random_uuid();request:=jsonb_build_object('action','transfer','value',jsonb_build_object('project',project_json,'contract',contract_json,
   'newOwner',900000002,'futureRecipient',900000002,'date','2026-09-26','fields','{"contract":{}}'::jsonb,
   'choices',jsonb_build_array(jsonb_build_object('unitId',u::text,'expectedRevision',0,'recipientId',900000002,'method',method,
   'scheduledDate','2026-12-01','plannedAmount',82500,'periodStart','2026-01-01','periodEnd','2026-12-31','note','rollback test')),'reason','rollback test'));
  before_reject:=public.billing_runtime_snapshot();rejected:=false;
  BEGIN
   PERFORM public.billing_runtime_write(gen_random_uuid(),jsonb_set(request,'{value,choices}',
    (request#>'{value,choices}')||jsonb_build_array(jsonb_build_object('newOccurrence',jsonb_build_object('recipientId',900000002,
    'year',2027,'round',1,'method','invoice','date','2027-12-01','amount',-1,'periodStart','2027-01-01','periodEnd','2027-12-31')))));
  EXCEPTION WHEN OTHERS THEN rejected:=true;END;
  IF NOT rejected OR public.billing_runtime_snapshot() IS DISTINCT FROM before_reject
   OR (SELECT to_jsonb(t) FROM public.projects t WHERE id=p) IS DISTINCT FROM project_json
   OR (SELECT to_jsonb(t) FROM public.contracts t WHERE id=p) IS DISTINCT FROM contract_json
   THEN RAISE EXCEPTION 'Partial transfer was not fully cancelled'; END IF;
  PERFORM public.billing_runtime_write(k,request);
  snap:=public.billing_runtime_snapshot();PERFORM public.billing_runtime_write(k,request);
  IF public.billing_runtime_snapshot() IS DISTINCT FROM snap THEN RAISE EXCEPTION 'Replay changed ledger'; END IF;
  IF (SELECT customer_id FROM public.projects WHERE id=p)<>900000002 THEN RAISE EXCEPTION 'Owner not transferred'; END IF;
  SELECT value INTO unit_json FROM jsonb_array_elements(snap->'units') WHERE (value->>'id')::bigint=u;
  IF (unit_json->>'recipient_customer_id')::bigint<>900000002 THEN RAISE EXCEPTION 'Recipient mismatch'; END IF;
  revision:=(unit_json->>'revision')::integer;
  before_reject:=snap;rejected:=false;
  BEGIN
   PERFORM public.billing_runtime_write(gen_random_uuid(),jsonb_build_object('action','invoice','value',jsonb_build_object('unitId',u,'revision',revision-1,
    'mode',CASE WHEN method='請求書' THEN 'collection' ELSE 'debit_received' END,
    'value',CASE WHEN method='請求書' THEN '{"received_on":"2026-12-15"}'::jsonb ELSE '{"received_on":"2026-12-15","amount":82500,"line_items":[{"name":"保守料","amount":82500}]}'::jsonb END,'reason','stale rollback test')));
  EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  after_reject:=public.billing_runtime_snapshot();
  IF NOT rejected OR before_reject IS DISTINCT FROM after_reject THEN RAISE EXCEPTION 'Stale write rollback failed'; END IF;
  IF method='請求書' THEN
   PERFORM public.billing_runtime_write(gen_random_uuid(),jsonb_build_object('action','invoice','value',jsonb_build_object('unitId',u,'revision',revision,'mode','issue',
    'value',jsonb_build_object('recipient_customer_id',900000002,'scheduled_date','2026-12-01','issued_on','2026-12-01','received_on',NULL,
    'payment_due_on',NULL,'frozen_amount',82500,'frozen_line_items','[{"name":"保守料","amount":82500}]'::jsonb),'reason',NULL)));
   PERFORM public.billing_runtime_write(gen_random_uuid(),jsonb_build_object('action','invoice','value',jsonb_build_object('unitId',u,'revision',revision+1,'mode','collection',
    'value','{"received_on":"2026-12-15"}'::jsonb,'reason',NULL)));
  ELSE
   PERFORM public.billing_runtime_write(gen_random_uuid(),jsonb_build_object('action','invoice','value',jsonb_build_object('unitId',u,'revision',revision,'mode','debit_received',
    'value','{"received_on":"2026-12-15","amount":82500,"line_items":[{"name":"保守料","amount":82500}]}'::jsonb,'reason','rollback test')));
   PERFORM public.billing_runtime_write(gen_random_uuid(),jsonb_build_object('action','invoice','value',jsonb_build_object('unitId',u,'revision',revision+1,'mode','debit_correction',
    'value','{"received_on":"2026-12-16","amount":82500,"line_items":[{"name":"保守料","amount":82500}]}'::jsonb,'reason','rollback correction test')));
  END IF;
  snap:=public.billing_runtime_snapshot();
  SELECT value INTO unit_json FROM jsonb_array_elements(snap->'units') WHERE (value->>'id')::bigint=u;
  IF unit_json->>'lifecycle'<>'received' OR (unit_json->>'frozen_amount')::bigint<>82500 THEN RAISE EXCEPTION 'Collection result mismatch'; END IF;
 END LOOP;
 -- A failed debit keeps the original recipient/amount while switching to invoice.
 request:=jsonb_build_object('action','debit_add','value',jsonb_build_object('projectId',900000014,'contractId',900000014,
  'recipient',900000002,'year',2027,'month',1,'date','2027-01-01','amount',82500,'note','rollback failed debit','reason','rollback test'));
 k:=gen_random_uuid();unit_json:=public.billing_runtime_write(k,request);u:=(unit_json->>'id')::bigint;
 PERFORM public.billing_runtime_write(gen_random_uuid(),jsonb_build_object('action','invoice','value',jsonb_build_object('unitId',u,'revision',0,
  'mode','debit_invoice_switch','value','{}'::jsonb,'reason','rollback failed debit')));
 snap:=public.billing_runtime_snapshot();SELECT value INTO unit_json FROM jsonb_array_elements(snap->'units') WHERE (value->>'id')::bigint=u;
 IF unit_json->>'collection_method'<>'invoice' OR unit_json->>'collection_state'<>'failed'
  OR (unit_json->>'recipient_customer_id')::bigint<>900000002 OR (unit_json->>'planned_amount')::bigint<>82500
  THEN RAISE EXCEPTION 'Failed debit switch lost recipient or amount';END IF;
 PERFORM public.billing_runtime_write(gen_random_uuid(),jsonb_build_object('action','invoice','value',jsonb_build_object('unitId',u,'revision',1,'mode','issue',
  'value',jsonb_build_object('recipient_customer_id',900000002,'scheduled_date','2027-01-01','issued_on','2027-01-02','received_on',NULL,
  'payment_due_on',NULL,'frozen_amount',82500,'frozen_line_items','[{"name":"保守料","amount":82500}]'::jsonb),'reason',NULL)));
 PERFORM public.billing_runtime_write(gen_random_uuid(),jsonb_build_object('action','invoice','value',jsonb_build_object('unitId',u,'revision',2,'mode','collection',
  'value','{"received_on":"2027-01-15"}'::jsonb,'reason',NULL)));
 snap:=public.billing_runtime_snapshot();SELECT value INTO unit_json FROM jsonb_array_elements(snap->'units') WHERE (value->>'id')::bigint=u;
 IF unit_json->>'lifecycle'<>'received' OR (unit_json->>'frozen_amount')::bigint<>82500 THEN RAISE EXCEPTION 'Failed debit invoice collection failed';END IF;
 -- Other authenticated users cannot use the facade even within this transaction.
 PERFORM set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
 PERFORM set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
 rejected:=false;BEGIN PERFORM public.billing_runtime_snapshot();EXCEPTION WHEN insufficient_privilege THEN rejected:=true;END;
 IF NOT rejected THEN RAISE EXCEPTION 'Other actor was not rejected';END IF;
END $$;
RESET ROLE;
ROLLBACK;
SELECT 'PASS: four method combinations, transfer/replay/partial-failure rollback, invoice/debit collection, debit correction, failed-debit invoice collection, other-user denial; all fixture rows rolled back' AS result;
