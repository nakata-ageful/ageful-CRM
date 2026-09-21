-- ISOLATED STAGING ONLY. Completes the legacy source shape used by the current app.
-- This file is not part of the production cutover manifest.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS panel_notes text,
  ADD COLUMN IF NOT EXISTS pcs_notes text,
  ADD COLUMN IF NOT EXISTS fit_term_years numeric,
  ADD COLUMN IF NOT EXISTS fit_end_date date,
  ADD COLUMN IF NOT EXISTS monitoring_model text,
  ADD COLUMN IF NOT EXISTS monitoring_notes text,
  ADD COLUMN IF NOT EXISTS customer_referrer text,
  ADD COLUMN IF NOT EXISTS project_referrer text;

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS ownership_transfer_date date,
  ADD COLUMN IF NOT EXISTS communication_fee bigint,
  ADD COLUMN IF NOT EXISTS local_association_fee bigint,
  ADD COLUMN IF NOT EXISTS maintenance_contractor text,
  ADD COLUMN IF NOT EXISTS equipment_contract_notes text,
  ADD COLUMN IF NOT EXISTS land_contract_notes text,
  ADD COLUMN IF NOT EXISTS maintenance_contract_notes text,
  ADD COLUMN IF NOT EXISTS maintenance_content_notes text,
  ADD COLUMN IF NOT EXISTS subcontract_notes text,
  ADD COLUMN IF NOT EXISTS has_meti_setup_report boolean,
  ADD COLUMN IF NOT EXISTS has_meti_periodic_report boolean,
  ADD COLUMN IF NOT EXISTS meti_setup_report_date date,
  ADD COLUMN IF NOT EXISTS meti_setup_report_status text,
  ADD COLUMN IF NOT EXISTS has_issuance_fee boolean,
  ADD COLUMN IF NOT EXISTS issuance_fee_ex bigint,
  ADD COLUMN IF NOT EXISTS issuance_fee_inc bigint,
  ADD COLUMN IF NOT EXISTS has_transfer_fee boolean,
  ADD COLUMN IF NOT EXISTS transfer_fee_ex bigint,
  ADD COLUMN IF NOT EXISTS transfer_fee_inc bigint,
  ADD COLUMN IF NOT EXISTS billing_schedule_days jsonb,
  ADD COLUMN IF NOT EXISTS billing_amount_overrides jsonb,
  ADD COLUMN IF NOT EXISTS billing_item_flags jsonb;

-- Legacy bootstrap was intentionally permissive. The runtime migration adds a
-- restrictive single-owner policy, and this staging setup removes anonymous access.
DROP POLICY IF EXISTS "Allow anon full access" ON public.customers;
DROP POLICY IF EXISTS "Allow anon full access" ON public.projects;
DROP POLICY IF EXISTS "Allow anon full access" ON public.contracts;
DROP POLICY IF EXISTS "Allow anon full access" ON public.annual_records;
DROP POLICY IF EXISTS "Allow anon full access" ON public.maintenance_responses;
DROP POLICY IF EXISTS "Allow anon full access" ON public.periodic_maintenance;
DROP POLICY IF EXISTS "Allow anon full access" ON public.attachments;
DROP POLICY IF EXISTS "Allow anon full access" ON public.prospects;
REVOKE ALL ON public.customers,public.projects,public.contracts,public.annual_records,
  public.maintenance_responses,public.periodic_maintenance,public.attachments,public.prospects FROM anon;
