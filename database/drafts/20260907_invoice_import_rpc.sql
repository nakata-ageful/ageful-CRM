-- ISOLATED REHEARSAL ONLY. One complete source row at a time; NOT a cutover gate.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF;
END $$;
CREATE TABLE public.invoice_import_evidence(
  source_annual_record_id bigint PRIMARY KEY REFERENCES public.annual_records(id) ON DELETE RESTRICT,
  operation_key uuid NOT NULL UNIQUE,
  project_id bigint NOT NULL,
  source_record jsonb NOT NULL,
  project_snapshot jsonb NOT NULL CHECK(jsonb_typeof(project_snapshot)='object'),
  contract_snapshot jsonb NOT NULL CHECK(jsonb_typeof(contract_snapshot)='object'),
  source_signature text NOT NULL,
  source_snapshot_hash text NOT NULL CHECK(source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  confirmed_payloads jsonb NOT NULL CHECK(jsonb_typeof(confirmed_payloads)='array'),
  receipt jsonb NOT NULL,
  actor_user_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
  FOREIGN KEY(operation_key,project_id) REFERENCES public.billing_operations(operation_key,project_id) ON DELETE RESTRICT,
  CHECK(source_signature::jsonb=source_record),
  CHECK(encode(sha256(convert_to(source_signature,'UTF8')),'hex')=source_snapshot_hash)
);
CREATE TRIGGER invoice_import_evidence_append_only BEFORE UPDATE OR DELETE ON public.invoice_import_evidence
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_row_mutation();
CREATE TRIGGER invoice_import_evidence_reject_truncate BEFORE TRUNCATE ON public.invoice_import_evidence
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_row_mutation();
ALTER TABLE public.invoice_import_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_import_evidence FROM PUBLIC;

CREATE FUNCTION public.import_invoice_source(
  p_operation_key uuid,p_record_id bigint,p_expected_project jsonb,p_expected_contract jsonb,
  p_source_signature text,p_payloads jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  actor uuid:=auth.uid();
  source jsonb;
  project_value jsonb;
  contract_value jsonb;
  project_key bigint;
  contract_key bigint;
  fingerprint text;
  source_hash text;
  op public.billing_operations%ROWTYPE;
  payload jsonb;
  row_value jsonb;
  evidence jsonb;
  part jsonb;
  parts jsonb;
  expected_index integer;
  original_index integer;
  seen integer[]:=ARRAY[]::integer[];
  split boolean;
  active boolean;
  state text;
  unit public.billing_units%ROWTYPE;
  ids jsonb:='[]';
  receipt jsonb;
  dataset text;
  expected_keys text[]:=ARRAY['project_id','contract_id','recipient_plan_id','recipient_customer_id','recipient_source',
    'occurrence_key','service_year','service_month','round_number','schedule_slot_id','scheduled_date','original_method',
    'collection_method','lifecycle','collection_state','issued_on','received_on','payment_due_on','frozen_amount',
    'frozen_line_items','frozen_at','amount_basis','revision','source_annual_record_id','source_payment_index','source_snapshot_hash'];
  date_key text;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_operation_key IS NULL OR p_record_id IS NULL OR p_record_id<=0 OR p_source_signature IS NULL
    OR jsonb_typeof(p_expected_project) IS DISTINCT FROM 'object' OR jsonb_typeof(p_expected_contract) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_payloads) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '移行対象・確認内容の形式が不正です'; END IF;
  source:=p_source_signature::jsonb;
  IF jsonb_typeof(source) IS DISTINCT FROM 'object' OR source->>'id' IS DISTINCT FROM p_record_id::text THEN
    RAISE EXCEPTION '元記録の識別が一致しません';
  END IF;
  contract_key:=(source->>'contract_id')::bigint; project_key:=(p_expected_project->>'id')::bigint;
  IF project_key IS NULL OR project_key<=0 OR contract_key IS NULL OR
    p_expected_contract->>'id' IS DISTINCT FROM contract_key::text OR
    p_expected_contract->>'project_id' IS DISTINCT FROM project_key::text THEN RAISE EXCEPTION '契約と発電所の対応が不正です'; END IF;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','import_invoice_source','record',p_record_id,
    'project',p_expected_project,'contract',p_expected_contract,'source',p_source_signature,'payloads',p_payloads,'actor',actor)::text,'UTF8')),'hex');
  INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
    VALUES(p_operation_key,'plan',project_key,fingerprint,actor) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_operation_key FOR UPDATE;
  IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION '同じ操作IDで異なる移行はできません'; END IF;
  IF op.completed_at IS NOT NULL THEN
    SELECT e.receipt INTO STRICT receipt FROM public.invoice_import_evidence e WHERE operation_key=p_operation_key;
    RETURN receipt;
  END IF;
  SELECT to_jsonb(p) INTO STRICT project_value FROM public.projects p WHERE id=project_key FOR UPDATE;
  PERFORM 1 FROM public.billing_recipient_plans WHERE project_id=project_key ORDER BY id FOR UPDATE;
  SELECT to_jsonb(c) INTO STRICT contract_value FROM public.contracts c WHERE id=contract_key AND project_id=project_key FOR UPDATE;
  IF project_value IS DISTINCT FROM p_expected_project OR contract_value IS DISTINCT FROM p_expected_contract THEN
    RAISE EXCEPTION '確認後に発電所・契約が更新されています';
  END IF;
  PERFORM 1 FROM public.annual_records WHERE id=p_record_id FOR UPDATE;
  IF NOT FOUND OR (SELECT to_jsonb(a) FROM public.annual_records a WHERE id=p_record_id) IS DISTINCT FROM source THEN
    RAISE EXCEPTION '確認後に元記録が更新されています';
  END IF;
  PERFORM 1 FROM public.billing_units WHERE project_id=project_key ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.billing_recipient_plans WHERE project_id=project_key)
    OR EXISTS(SELECT 1 FROM public.ownership_transfers WHERE project_id=project_key)
    OR EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=project_key AND source_annual_record_id IS NULL) THEN
    RAISE EXCEPTION '新運用の開始前だけ移行できます。既存予定との対応を確認してください';
  END IF;
  IF EXISTS(SELECT 1 FROM public.invoice_import_evidence WHERE source_annual_record_id=p_record_id) THEN
    RAISE EXCEPTION 'この元記録は取込済みです';
  END IF;
  IF coalesce((source->>'transfer_failed')::boolean,false) THEN RAISE EXCEPTION '振替不能は別途対応が必要です'; END IF;
  parts:=coalesce(nullif(source->'payments','null'::jsonb),'[]');
  IF jsonb_typeof(parts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '各回の形式が不正です'; END IF;
  split:=jsonb_array_length(parts)>0;
  IF NOT split THEN parts:=jsonb_build_array(jsonb_build_object('seq',null,'scheduled_date',source->'billing_scheduled_date',
    'billing_date',source->'billing_date','received_date',source->'received_date')); END IF;
  IF jsonb_array_length(parts)<>jsonb_array_length(p_payloads) THEN RAISE EXCEPTION '元記録のすべての回を指定してください'; END IF;
  IF split AND ((source->>'payment_due_date') IS NOT NULL OR
    (source->>'billing_date' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parts) x WHERE x->>'billing_date'=source->>'billing_date')) OR
    (source->>'received_date' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(parts) x WHERE x->>'received_date'=source->>'received_date')) OR
    EXISTS(SELECT 1 FROM jsonb_array_elements(parts) x GROUP BY x->>'seq' HAVING count(*)>1)) THEN
    RAISE EXCEPTION '親記録と各回・回番号の対応を確認してください';
  END IF;
  IF source->>'status'='入金済' AND EXISTS(SELECT 1 FROM jsonb_array_elements(parts) x WHERE x->>'received_date' IS NULL) THEN
    RAISE EXCEPTION '入金済の状態と入金日の対応を確認してください';
  END IF;
  source_hash:=encode(sha256(convert_to(p_source_signature,'UTF8')),'hex');
  FOR payload IN SELECT value FROM jsonb_array_elements(p_payloads) LOOP
    row_value:=payload->'row'; evidence:=payload->'evidence';
    IF jsonb_typeof(row_value) IS DISTINCT FROM 'object' OR jsonb_typeof(evidence) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION '移行行・証跡が不足しています';
    END IF;
    IF NOT(row_value ?& expected_keys) OR EXISTS(SELECT 1 FROM jsonb_object_keys(row_value) k WHERE NOT(k=ANY(expected_keys))) THEN
      RAISE EXCEPTION '移行列が不足・余分です';
    END IF;
    IF jsonb_typeof(row_value->'source_payment_index') IS DISTINCT FROM 'number' OR row_value->>'source_payment_index' !~ '^[0-9]+$' THEN
      RAISE EXCEPTION '元の回位置が不正です';
    END IF;
    expected_index:=(row_value->>'source_payment_index')::integer;
    original_index:=CASE WHEN split THEN expected_index-1 ELSE 0 END;
    IF expected_index=ANY(seen) OR original_index<0 OR original_index>=jsonb_array_length(parts) OR (NOT split AND expected_index<>0) THEN
      RAISE EXCEPTION '元の回位置が重複・範囲外です';
    END IF;
    seen:=array_append(seen,expected_index);part:=parts->original_index;
    IF split AND (jsonb_typeof(part->'seq') IS DISTINCT FROM 'number' OR part->>'seq' !~ '^[1-9][0-9]*$') THEN
      RAISE EXCEPTION '元の回番号を確認してください';
    END IF;
    IF evidence->'schemaVersion' IS DISTINCT FROM '1'::jsonb OR evidence->'sourceRecord' IS DISTINCT FROM source
      OR evidence->>'sourceSignature' IS DISTINCT FROM p_source_signature
      OR evidence->'originalPaymentIndex' IS DISTINCT FROM (CASE WHEN split THEN to_jsonb(original_index) ELSE 'null'::jsonb END)
      OR evidence->'originalSeq' IS DISTINCT FROM part->'seq'
      OR jsonb_typeof(evidence->'datasetId') IS DISTINCT FROM 'string' OR length(trim(evidence->>'datasetId'))=0 THEN
      RAISE EXCEPTION '移行元の証跡が一致しません';
    END IF;
    IF dataset IS NOT NULL AND dataset<>evidence->>'datasetId' THEN RAISE EXCEPTION 'データセットが混在しています'; END IF;
    dataset:=evidence->>'datasetId';
    IF evidence->'methodConfirmation'->>'sourceSnapshotHash' IS DISTINCT FROM source_hash
      OR evidence->'methodConfirmation'->>'originalMethod' IS DISTINCT FROM 'invoice'
      OR evidence->'methodConfirmation'->>'collectionMethod' IS DISTINCT FROM 'invoice'
      OR jsonb_typeof(evidence->'methodConfirmation'->'basis') IS DISTINCT FROM 'string'
      OR length(trim(evidence->'methodConfirmation'->>'basis'))=0
      OR jsonb_typeof(evidence->'recipientBasis') IS DISTINCT FROM 'string' OR length(trim(evidence->>'recipientBasis'))=0 THEN
      RAISE EXCEPTION '請求方法・請求先の確認根拠を確認してください';
    END IF;
    active:=part->>'billing_date' IS NOT NULL OR part->>'received_date' IS NOT NULL;
    state:=CASE WHEN part->>'received_date' IS NOT NULL THEN 'received' WHEN part->>'billing_date' IS NOT NULL THEN 'issued' ELSE 'planned' END;
    IF row_value->'project_id' IS DISTINCT FROM to_jsonb(project_key) OR row_value->'contract_id' IS DISTINCT FROM to_jsonb(contract_key)
      OR row_value->'source_annual_record_id' IS DISTINCT FROM to_jsonb(p_record_id)
      OR row_value->>'source_snapshot_hash' IS DISTINCT FROM source_hash
      OR row_value->>'occurrence_key' IS DISTINCT FROM 'legacy:'||p_record_id::text||':'||expected_index::text
      OR row_value->'service_year' IS DISTINCT FROM source->'year' OR row_value->'round_number' IS DISTINCT FROM part->'seq'
      OR row_value->>'lifecycle' IS DISTINCT FROM state OR row_value->>'recipient_source' IS DISTINCT FROM 'confirmed'
      OR row_value->>'original_method' IS DISTINCT FROM 'invoice' OR row_value->>'collection_method' IS DISTINCT FROM 'invoice'
      OR row_value->>'collection_state' IS DISTINCT FROM (CASE WHEN state='received' THEN 'succeeded' ELSE 'pending' END)
      OR row_value->'revision' IS DISTINCT FROM '0'::jsonb OR row_value->'service_month'<>'null'::jsonb
      OR row_value->'recipient_plan_id'<>'null'::jsonb OR row_value->'schedule_slot_id'<>'null'::jsonb
      OR row_value->'issued_on' IS DISTINCT FROM part->'billing_date' OR row_value->'received_on' IS DISTINCT FROM part->'received_date'
      OR row_value->'scheduled_date' IS DISTINCT FROM part->'scheduled_date'
      OR row_value->'payment_due_on' IS DISTINCT FROM (CASE WHEN split THEN 'null'::jsonb ELSE coalesce(source->'payment_due_date','null'::jsonb) END) THEN
      RAISE EXCEPTION '移行行の識別・状態・日付が元記録と一致しません';
    END IF;
    IF jsonb_typeof(row_value->'recipient_customer_id') IS DISTINCT FROM 'number' OR row_value->>'recipient_customer_id' !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION '請求先を確認してください';
    END IF;
    FOREACH date_key IN ARRAY ARRAY['scheduled_date','issued_on','received_on','payment_due_on'] LOOP
      IF row_value->date_key<>'null'::jsonb THEN
        IF jsonb_typeof(row_value->date_key) IS DISTINCT FROM 'string' OR row_value->>date_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          RAISE EXCEPTION '日付の形式を確認してください';
        END IF;
        PERFORM (row_value->>date_key)::date;
      END IF;
    END LOOP;
    IF active THEN
      IF jsonb_typeof(evidence->'amountBasis') IS DISTINCT FROM 'string' OR length(trim(evidence->>'amountBasis'))=0
        OR row_value->>'amount_basis' IS NULL OR row_value->>'amount_basis' NOT IN('source_record','operator_confirmed')
        OR jsonb_typeof(row_value->'frozen_amount') IS DISTINCT FROM 'number' OR row_value->>'frozen_amount' !~ '^[0-9]+$'
        OR (row_value->>'frozen_amount')::numeric>9007199254740991 THEN RAISE EXCEPTION '確定金額と確認根拠を確認してください'; END IF;
      IF row_value->>'amount_basis'='source_record' AND (split OR row_value->'frozen_line_items' IS DISTINCT FROM source->'line_items') THEN
        RAISE EXCEPTION '保存明細を根拠にできません';
      END IF;
    ELSIF row_value->'frozen_amount'<>'null'::jsonb OR row_value->'frozen_line_items'<>'null'::jsonb
      OR row_value->'frozen_at'<>'null'::jsonb OR row_value->>'amount_basis' IS DISTINCT FROM 'unconfirmed' THEN
      RAISE EXCEPTION '予定の金額を固定しないでください';
    END IF;
    -- DB sets the migration freeze time; never trust a client-provided historical timestamp.
    row_value:=row_value||jsonb_build_object('frozen_at',CASE WHEN active THEN to_jsonb(transaction_timestamp()) ELSE 'null'::jsonb END);
    INSERT INTO public.billing_units(project_id,contract_id,recipient_plan_id,recipient_customer_id,recipient_source,
      occurrence_key,service_year,service_month,round_number,schedule_slot_id,scheduled_date,original_method,collection_method,
      lifecycle,collection_state,issued_on,received_on,payment_due_on,frozen_amount,frozen_line_items,frozen_at,amount_basis,revision,
      source_annual_record_id,source_payment_index,source_snapshot_hash)
    SELECT r.project_id,r.contract_id,r.recipient_plan_id,r.recipient_customer_id,r.recipient_source,
      r.occurrence_key,r.service_year,r.service_month,r.round_number,r.schedule_slot_id,r.scheduled_date,r.original_method,r.collection_method,
      r.lifecycle,r.collection_state,r.issued_on,r.received_on,r.payment_due_on,r.frozen_amount,r.frozen_line_items,r.frozen_at,r.amount_basis,r.revision,
      r.source_annual_record_id,r.source_payment_index,r.source_snapshot_hash
    FROM jsonb_populate_record(NULL::public.billing_units,row_value) r RETURNING * INTO unit;
    INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,after_value,actor_user_id,reason)
      VALUES(project_key,unit.id,p_operation_key,'created',to_jsonb(unit),actor,'元年度記録からの移行');
    ids:=ids||jsonb_build_array(unit.id);
  END LOOP;
  receipt:=jsonb_build_object('operation_key',p_operation_key,'record_id',p_record_id,'unit_ids',ids,'cutover_ready',false);
  INSERT INTO public.invoice_import_evidence(source_annual_record_id,operation_key,project_id,source_record,project_snapshot,contract_snapshot,source_signature,
    source_snapshot_hash,confirmed_payloads,receipt,actor_user_id)
    VALUES(p_record_id,p_operation_key,project_key,source,project_value,contract_value,p_source_signature,source_hash,p_payloads,receipt,actor);
  UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_operation_key;
  RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.import_invoice_source(uuid,bigint,jsonb,jsonb,text,jsonb) FROM PUBLIC;

-- Snapshot report only. Even a clean report never enables ownership transfer or cutover.
CREATE FUNCTION public.inspect_invoice_import(p_project_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=p_project_id) THEN RAISE EXCEPTION '発電所がありません'; END IF;
  WITH evidence AS (SELECT * FROM public.invoice_import_evidence WHERE project_id=p_project_id),
  checks AS (SELECT
    (SELECT count(*) FROM public.annual_records a JOIN public.contracts c ON c.id=a.contract_id WHERE c.project_id=p_project_id) source_count,
    (SELECT count(*) FROM public.annual_records a JOIN public.contracts c ON c.id=a.contract_id WHERE c.project_id=p_project_id
      AND NOT EXISTS(SELECT 1 FROM evidence e WHERE e.source_annual_record_id=a.id)) unimported_sources,
    (SELECT count(*) FROM evidence e LEFT JOIN public.annual_records a ON a.id=e.source_annual_record_id
      WHERE to_jsonb(a) IS DISTINCT FROM e.source_record) changed_sources,
    (SELECT count(*) FROM evidence e LEFT JOIN public.projects p ON p.id=e.project_id
      LEFT JOIN public.contracts c ON c.id=(e.contract_snapshot->>'id')::bigint
      WHERE to_jsonb(p) IS DISTINCT FROM e.project_snapshot OR to_jsonb(c) IS DISTINCT FROM e.contract_snapshot) changed_parents,
    (SELECT count(*) FROM evidence e CROSS JOIN LATERAL jsonb_array_elements_text(e.receipt->'unit_ids') expected(id)
      WHERE NOT EXISTS(SELECT 1 FROM public.billing_units u WHERE u.id=expected.id::bigint AND u.project_id=p_project_id
        AND u.source_annual_record_id=e.source_annual_record_id)) missing_units,
    (SELECT count(*) FROM public.billing_units u LEFT JOIN evidence e ON e.source_annual_record_id=u.source_annual_record_id
      LEFT JOIN public.billing_unit_events event ON event.billing_unit_id=u.id AND event.operation_key=e.operation_key AND event.event_type='created'
      WHERE u.project_id=p_project_id AND (e.source_annual_record_id IS NULL OR NOT(e.receipt->'unit_ids' @> jsonb_build_array(u.id))
        OR event.after_value IS DISTINCT FROM to_jsonb(u))) changed_or_untracked_units,
    (SELECT count(*) FROM evidence e LEFT JOIN public.billing_operations o ON o.operation_key=e.operation_key
      WHERE o.completed_at IS NULL OR o.actor_user_id IS DISTINCT FROM e.actor_user_id) incomplete_operations)
  SELECT to_jsonb(checks)||jsonb_build_object('project_id',p_project_id,'cutover_ready',false,
    'source_checks_passed',source_count>0 AND unimported_sources=0 AND changed_sources=0 AND changed_parents=0 AND missing_units=0
      AND changed_or_untracked_units=0 AND incomplete_operations=0)
    INTO result FROM checks;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.inspect_invoice_import(bigint) FROM PUBLIC;
