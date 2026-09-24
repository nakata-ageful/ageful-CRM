-- NEW DB ONLY. Inspection is read-only and never marks future coverage verified.
-- Run all statements inside one explicit transaction after verifying the target,
-- owner Auth UUID, backups, and this draft. Set the local guard in that transaction.
DO $$ BEGIN
  IF current_setting('ageful.allow_inspection_draft', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Inspection draft blocked';
  END IF;
  IF (SELECT project_ref FROM public.ageful_migration_target) IS DISTINCT FROM 'ufawaiddntqqbjhycbxn' THEN
    RAISE EXCEPTION 'Wrong database target';
  END IF;
  IF EXISTS (SELECT 1 FROM public.billing_runtime_control WHERE enabled) THEN
    RAISE EXCEPTION 'Full runtime already enabled; inspection draft is not needed';
  END IF;
END $$;

CREATE FUNCTION public.billing_runtime_inspection_snapshot() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM '9a4b877c-d73d-4c37-a902-40c521240d06'::uuid THEN
    RAISE EXCEPTION 'Inspection is not authorized' USING ERRCODE='42501';
  END IF;
  IF (SELECT project_ref FROM public.ageful_migration_target) IS DISTINCT FROM 'ufawaiddntqqbjhycbxn'
     OR EXISTS (SELECT 1 FROM public.billing_runtime_control WHERE enabled)
     OR (SELECT count(*) FROM public.billing_migration_acceptances) <> (SELECT count(*) FROM public.projects) THEN
    RAISE EXCEPTION 'Inspection preconditions changed';
  END IF;
  RETURN jsonb_build_object(
    'version',1,
    'mode','read_only_inspection',
    'future_schedule_coverage_verified',false,
    'customers',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'company_name',c.company_name) ORDER BY c.id),'[]'::jsonb) FROM public.customers c),
    'projects',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'customer_id',p.customer_id,'project_name',p.project_name) ORDER BY p.id),'[]'::jsonb) FROM public.projects p),
    'contracts',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,'project_id',c.project_id,'billing_method',c.billing_method,
      'billing_count',c.billing_count,'billing_schedule_days',c.billing_schedule_days,
      'billing_item_flags',c.billing_item_flags,'billing_amount_overrides',c.billing_amount_overrides,
      'annual_maintenance_inc',c.annual_maintenance_inc,'land_cost_monthly',c.land_cost_monthly,
      'insurance_fee',c.insurance_fee,'local_association_fee',c.local_association_fee,
      'communication_fee',c.communication_fee,'other_fee',c.other_fee,
      'has_issuance_fee',c.has_issuance_fee,'issuance_fee_inc',c.issuance_fee_inc,
      'has_transfer_fee',c.has_transfer_fee,'transfer_fee_inc',c.transfer_fee_inc,
      'maintenance_start_date',c.maintenance_start_date) ORDER BY c.id),'[]'::jsonb) FROM public.contracts c),
    'annual_records',(SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'contract_id',a.contract_id,'year',a.year,
      'billing_scheduled_date',a.billing_scheduled_date,'billing_date',a.billing_date,
      'received_date',a.received_date,'transfer_failed',a.transfer_failed,'payments',a.payments)
      ORDER BY a.id),'[]'::jsonb) FROM public.annual_records a),
    'units',(SELECT coalesce(jsonb_agg(to_jsonb(u) ORDER BY u.id),'[]'::jsonb) FROM public.billing_units u),
    'management_events',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.id),'[]'::jsonb) FROM public.project_management_events m)
  );
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_inspection_snapshot() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.billing_runtime_inspection_snapshot() FROM anon;
GRANT EXECUTE ON FUNCTION public.billing_runtime_inspection_snapshot() TO authenticated;
