BEGIN;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.ageful_migration_target) <> 1
    OR NOT EXISTS (SELECT 1 FROM public.ageful_migration_target WHERE project_ref = 'ufawaiddntqqbjhycbxn')
  THEN RAISE EXCEPTION 'Wrong project: new app only'; END IF;
END $$;

-- Both existing writes run in the caller's transaction. Each keeps its own
-- validation and audit history, and a failure rolls back both writes.
CREATE FUNCTION public.record_automatic_debit_result(p_key uuid, p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  request_value jsonb := p_request->'value';
  candidate jsonb := request_value->'automaticDebit';
  item jsonb := candidate->'item';
  schedule_value jsonb;
  planned jsonb;
BEGIN
  IF p_key IS NULL OR p_request->>'action' IS DISTINCT FROM 'invoice'
    OR jsonb_typeof(candidate) IS DISTINCT FROM 'object'
    OR candidate->'contract'->>'billing_method' IS DISTINCT FROM '口座振替'
    OR item->>'method' IS DISTINCT FROM 'direct_debit'
    OR coalesce(request_value->>'mode','') NOT IN ('debit_received','debit_invoice_switch')
    OR coalesce(trim(request_value->>'reason'),'') = ''
  THEN RAISE EXCEPTION '振替予定と確認結果を確認してください'; END IF;

  schedule_value := jsonb_build_object(
    'projectId', candidate->'contract'->'project_id', 'contract', candidate->'contract',
    'versions', candidate->'versions', 'last', candidate->'last',
    'items', jsonb_build_array(item), 'reason', request_value->'reason'
  );
  IF candidate ? 'cycleRevision' THEN
    schedule_value := schedule_value || jsonb_build_object('cycleRevision', candidate->'cycleRevision');
  END IF;

  planned := public.billing_runtime_write(md5(p_key::text || ':debit-plan')::uuid,
    jsonb_build_object('action','future_schedule','value',schedule_value));
  IF jsonb_typeof(planned) IS DISTINCT FROM 'array' OR jsonb_array_length(planned) <> 1
    OR planned->0->>'collection_method' IS DISTINCT FROM 'direct_debit'
  THEN RAISE EXCEPTION '対象の振替予定を特定できません'; END IF;

  RETURN public.billing_runtime_write(md5(p_key::text || ':debit-result')::uuid,
    jsonb_build_object('action','invoice','value',jsonb_build_object(
      'unitId', planned->0->'id', 'revision', planned->0->'revision',
      'mode', request_value->'mode', 'value', request_value->'value', 'reason', request_value->'reason'
    )));
END $$;
REVOKE ALL ON FUNCTION public.record_automatic_debit_result(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_automatic_debit_result(uuid,jsonb) TO authenticated;
COMMIT;
