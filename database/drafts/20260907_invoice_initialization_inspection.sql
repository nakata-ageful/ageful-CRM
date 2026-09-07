-- Isolated rehearsal only; never authorizes application cutover.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF;
END $$;
CREATE FUNCTION public.inspect_invoice_initialization(p_project_id bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=p_project_id) THEN RAISE EXCEPTION '発電所がありません'; END IF;
  WITH checkpoint AS (SELECT * FROM public.invoice_recipient_initializations WHERE project_id=p_project_id),
  evidence AS (SELECT * FROM public.invoice_import_evidence WHERE project_id=p_project_id),
  expected AS (
    SELECT e.source_annual_record_id,created.billing_unit_id,created.after_value original,
      CASE WHEN created.after_value->>'lifecycle'='planned' THEN linked.after_value ELSE created.after_value END final_value,
      CASE WHEN created.after_value->>'lifecycle'='planned' THEN
        linked.before_value IS NOT DISTINCT FROM created.after_value
        AND linked.actor_user_id=i.actor_user_id
        AND (linked.after_value - ARRAY['recipient_plan_id','recipient_source','revision','updated_at'])
          IS NOT DISTINCT FROM (created.after_value - ARRAY['recipient_plan_id','recipient_source','revision','updated_at'])
        AND linked.after_value->>'recipient_plan_id'=i.recipient_plan_id::text
        AND (linked.after_value->>'revision')::bigint=(created.after_value->>'revision')::bigint+1
      ELSE true END valid_transition
    FROM evidence e CROSS JOIN checkpoint i
    CROSS JOIN LATERAL jsonb_array_elements_text(e.receipt->'unit_ids') ids(id)
    LEFT JOIN public.billing_unit_events created ON created.billing_unit_id=ids.id::bigint
      AND created.operation_key=e.operation_key AND created.event_type='created'
    LEFT JOIN public.billing_unit_events linked ON linked.billing_unit_id=created.billing_unit_id
      AND linked.operation_key=i.operation_key AND linked.event_type='plan_changed'
  ), checks AS (SELECT
    (SELECT count(*) FROM checkpoint) checkpoint_count,
    (SELECT count(*) FROM evidence) source_count,
    (SELECT count(*) FROM public.annual_records a JOIN public.contracts c ON c.id=a.contract_id
      WHERE c.project_id=p_project_id AND NOT EXISTS(SELECT 1 FROM evidence e WHERE e.source_annual_record_id=a.id)) unimported_sources,
    (SELECT count(*) FROM evidence e LEFT JOIN public.annual_records a ON a.id=e.source_annual_record_id
      LEFT JOIN public.projects p ON p.id=e.project_id LEFT JOIN public.contracts c ON c.id=(e.contract_snapshot->>'id')::bigint
      WHERE to_jsonb(a) IS DISTINCT FROM e.source_record OR to_jsonb(p) IS DISTINCT FROM e.project_snapshot
        OR to_jsonb(c) IS DISTINCT FROM e.contract_snapshot) changed_sources_or_parents,
    (SELECT count(*) FROM checkpoint i LEFT JOIN public.billing_recipient_plans p ON p.id=i.recipient_plan_id
      LEFT JOIN public.billing_operations o ON o.operation_key=i.operation_key
      WHERE to_jsonb(p) IS DISTINCT FROM i.plan_snapshot OR o.completed_at IS NULL OR o.actor_user_id IS DISTINCT FROM i.actor_user_id
        OR i.source_manifest IS DISTINCT FROM (SELECT coalesce(jsonb_object_agg(source_annual_record_id::text,source_snapshot_hash),'{}') FROM evidence)
        OR i.report_before->'source_checks_passed' IS DISTINCT FROM 'true'::jsonb) changed_checkpoint_or_plan,
    (SELECT count(*) FROM evidence e LEFT JOIN public.billing_operations o ON o.operation_key=e.operation_key
      WHERE o.completed_at IS NULL OR o.actor_user_id IS DISTINCT FROM e.actor_user_id) incomplete_imports,
    (SELECT count(*) FROM expected e FULL JOIN (SELECT * FROM public.billing_units WHERE project_id=p_project_id) u ON u.id=e.billing_unit_id
      WHERE e.valid_transition IS DISTINCT FROM true OR e.final_value IS DISTINCT FROM to_jsonb(u)) changed_missing_or_extra_units,
    (SELECT count(*) FROM public.billing_recipient_plans p WHERE p.project_id=p_project_id
      AND NOT EXISTS(SELECT 1 FROM checkpoint i WHERE i.recipient_plan_id=p.id)) extra_plans,
    (SELECT count(*) FROM public.billing_units u CROSS JOIN checkpoint i
      LEFT JOIN public.billing_recipient_plans p ON p.id=i.recipient_plan_id
      LEFT JOIN public.billing_recipient_plan_overrides x ON x.recipient_plan_id=i.recipient_plan_id AND x.billing_unit_id=u.id
      WHERE u.project_id=p_project_id AND u.lifecycle='planned' AND
        (u.recipient_plan_id IS DISTINCT FROM i.recipient_plan_id OR
          CASE WHEN u.recipient_customer_id=p.default_recipient_customer_id THEN u.recipient_source<>'default' OR x.billing_unit_id IS NOT NULL
          ELSE u.recipient_source<>'override' OR x.recipient_customer_id IS DISTINCT FROM u.recipient_customer_id END)) invalid_recipient_links,
    (SELECT count(*) FROM public.billing_recipient_plan_overrides x LEFT JOIN public.billing_units u ON u.id=x.billing_unit_id
      WHERE x.project_id=p_project_id AND (u.lifecycle IS DISTINCT FROM 'planned' OR u.recipient_plan_id IS DISTINCT FROM x.recipient_plan_id)) extra_overrides
  ) SELECT to_jsonb(checks)||jsonb_build_object('project_id',p_project_id,'cutover_ready',false,
    'initialization_checks_passed',checkpoint_count=1 AND source_count>0 AND unimported_sources=0 AND changed_sources_or_parents=0
      AND changed_checkpoint_or_plan=0 AND incomplete_imports=0 AND changed_missing_or_extra_units=0 AND extra_plans=0
      AND invalid_recipient_links=0 AND extra_overrides=0) INTO result FROM checks;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.inspect_invoice_initialization(bigint) FROM PUBLIC;
