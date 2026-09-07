-- DRAFT ONLY: billing/ownership persistence foundation.
-- Not approved for production. It deliberately creates no public policies or callable RPCs.
-- To rehearse in an isolated database only:
--   begin;
--   set local ageful.allow_draft_migration = 'yes';
--   \i this-file.sql
--   -- inspect, test, then rollback;

DO $$
BEGIN
  IF current_setting('ageful.allow_draft_migration', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Draft migration blocked. Use only in an isolated review database.';
  END IF;
END $$;

-- Allows the database to prove that a billing unit's contract belongs to its project.
CREATE UNIQUE INDEX IF NOT EXISTS contracts_id_project_id_uidx
  ON public.contracts (id, project_id);

CREATE TABLE public.billing_operations (
  operation_key              uuid PRIMARY KEY,
  operation_kind             text NOT NULL
                               CHECK (operation_kind IN ('plan', 'issue', 'collection', 'correction', 'cancel', 'ownership_transfer')),
  project_id                 bigint NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  request_hash               text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  actor_user_id              uuid,
  requested_at               timestamptz NOT NULL DEFAULT now(),
  completed_at               timestamptz,
  UNIQUE (operation_key, project_id),
  CHECK (completed_at IS NULL OR completed_at >= requested_at)
);

CREATE TABLE public.billing_recipient_plans (
  id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id                 bigint NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  default_recipient_customer_id bigint NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  effective_from             date NOT NULL,
  revision                   integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  retired_at                 timestamptz,
  CHECK (retired_at IS NULL OR retired_at >= created_at)
);

CREATE UNIQUE INDEX billing_recipient_plans_one_active_per_project
  ON public.billing_recipient_plans (project_id)
  WHERE retired_at IS NULL;
CREATE UNIQUE INDEX billing_recipient_plans_id_project_id_uidx
  ON public.billing_recipient_plans (id, project_id);

CREATE TABLE public.billing_units (
  id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id                 bigint NOT NULL,
  contract_id                bigint NOT NULL,
  recipient_plan_id          bigint,
  recipient_customer_id      bigint REFERENCES public.customers(id) ON DELETE RESTRICT,
  recipient_source           text NOT NULL DEFAULT 'unconfirmed'
                               CHECK (recipient_source IN ('default', 'override', 'confirmed', 'unconfirmed')),
  occurrence_key             text NOT NULL CHECK (length(trim(occurrence_key)) > 0),
  service_year               integer NOT NULL CHECK (service_year BETWEEN 2000 AND 2200),
  service_month              smallint CHECK (service_month BETWEEN 1 AND 12),
  round_number               integer CHECK (round_number > 0),
  schedule_slot_id           text CHECK (schedule_slot_id IS NULL OR length(trim(schedule_slot_id)) > 0),
  scheduled_date             date,
  original_method            text NOT NULL CHECK (original_method IN ('invoice', 'direct_debit')),
  collection_method          text NOT NULL CHECK (collection_method IN ('invoice', 'direct_debit')),
  lifecycle                  text NOT NULL DEFAULT 'planned'
                               CHECK (lifecycle IN ('planned', 'fixed', 'issued', 'received', 'cancelled', 'review_required')),
  collection_state           text NOT NULL DEFAULT 'pending'
                               CHECK (collection_state IN ('pending', 'succeeded', 'failed', 'not_applicable')),
  issued_on                  date,
  payment_due_on             date,
  received_on                date,
  frozen_amount              bigint CHECK (frozen_amount >= 0),
  frozen_line_items          jsonb,
  amount_basis               text NOT NULL DEFAULT 'unconfirmed'
                               CHECK (amount_basis IN ('contract_calculation', 'operator_confirmed', 'source_record', 'unconfirmed')),
  frozen_at                  timestamptz,
  revision                   integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  source_annual_record_id    bigint REFERENCES public.annual_records(id) ON DELETE RESTRICT,
  source_payment_index       integer CHECK (source_payment_index >= 0),
  source_snapshot_hash       text CHECK (source_snapshot_hash IS NULL OR source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (contract_id, project_id)
    REFERENCES public.contracts(id, project_id) ON DELETE RESTRICT,
  FOREIGN KEY (recipient_plan_id, project_id)
    REFERENCES public.billing_recipient_plans(id, project_id) MATCH SIMPLE ON DELETE RESTRICT,
  CHECK ((frozen_amount IS NULL) = (frozen_line_items IS NULL)),
  CHECK ((frozen_amount IS NULL) = (frozen_at IS NULL)),
  CHECK (lifecycle <> 'planned' OR (issued_on IS NULL AND received_on IS NULL AND frozen_amount IS NULL)),
  CHECK (lifecycle NOT IN ('fixed', 'issued', 'received')
         OR (recipient_customer_id IS NOT NULL AND frozen_amount IS NOT NULL AND frozen_at IS NOT NULL)),
  CHECK (lifecycle <> 'issued' OR (issued_on IS NOT NULL AND received_on IS NULL)),
  CHECK (lifecycle <> 'fixed' OR original_method = 'direct_debit'),
  CHECK (lifecycle <> 'received' OR (received_on IS NOT NULL AND collection_state = 'succeeded')),
  CHECK (issued_on IS NULL OR (collection_method = 'invoice' AND lifecycle IN ('issued', 'received', 'review_required'))),
  CHECK (collection_state <> 'succeeded' OR received_on IS NOT NULL),
  CHECK (received_on IS NULL OR collection_state = 'succeeded'),
  CHECK (received_on IS NULL OR lifecycle IN ('received', 'review_required')),
  CHECK (collection_state <> 'failed' OR (original_method = 'direct_debit' AND received_on IS NULL)),
  CHECK (collection_state <> 'not_applicable' OR lifecycle IN ('cancelled', 'review_required')),
  CHECK (lifecycle <> 'cancelled' OR (issued_on IS NULL AND received_on IS NULL AND frozen_amount IS NULL AND collection_state = 'not_applicable')),
  CHECK (lifecycle <> 'review_required' OR (recipient_source = 'unconfirmed' OR amount_basis = 'unconfirmed')),
  CHECK (recipient_source = 'unconfirmed' OR recipient_customer_id IS NOT NULL),
  CHECK ((source_annual_record_id IS NULL) = (source_payment_index IS NULL))
);

CREATE UNIQUE INDEX billing_units_project_occurrence_uidx
  ON public.billing_units (project_id, occurrence_key);
CREATE UNIQUE INDEX billing_units_id_project_id_uidx
  ON public.billing_units (id, project_id);
CREATE UNIQUE INDEX billing_units_source_occurrence_uidx
  ON public.billing_units (source_annual_record_id, source_payment_index)
  WHERE source_annual_record_id IS NOT NULL;
CREATE INDEX billing_units_recipient_schedule_idx
  ON public.billing_units (recipient_customer_id, scheduled_date, id);
CREATE INDEX billing_units_project_schedule_idx
  ON public.billing_units (project_id, scheduled_date, id);
CREATE INDEX billing_units_lifecycle_schedule_idx
  ON public.billing_units (lifecycle, scheduled_date, id);

CREATE OR REPLACE FUNCTION public.validate_billing_unit_frozen_line_items()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  item jsonb;
  item_sum bigint := 0;
BEGIN
  IF NEW.frozen_line_items IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.frozen_line_items) <> 'array' OR jsonb_array_length(NEW.frozen_line_items) = 0 THEN
    RAISE EXCEPTION 'Frozen line items must be a non-empty array';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.frozen_line_items)
  LOOP
    IF jsonb_typeof(item) IS DISTINCT FROM 'object'
       OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string'
       OR length(trim(item->>'name')) = 0
       OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'number'
       OR (item->>'amount') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Invalid frozen line item';
    END IF;
    item_sum := item_sum + (item->>'amount')::bigint;
  END LOOP;
  IF item_sum <> NEW.frozen_amount THEN
    RAISE EXCEPTION 'Frozen amount and line item total do not match';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER billing_units_validate_frozen_line_items
BEFORE INSERT OR UPDATE OF frozen_amount, frozen_line_items ON public.billing_units
FOR EACH ROW EXECUTE FUNCTION public.validate_billing_unit_frozen_line_items();

CREATE OR REPLACE FUNCTION public.set_billing_unit_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER billing_units_set_updated_at
BEFORE UPDATE ON public.billing_units
FOR EACH ROW EXECUTE FUNCTION public.set_billing_unit_updated_at();

CREATE TABLE public.billing_recipient_plan_overrides (
  id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id                 bigint NOT NULL,
  recipient_plan_id          bigint NOT NULL,
  billing_unit_id            bigint NOT NULL,
  recipient_customer_id      bigint NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (recipient_plan_id, project_id)
    REFERENCES public.billing_recipient_plans(id, project_id) MATCH FULL ON DELETE RESTRICT,
  FOREIGN KEY (billing_unit_id, project_id)
    REFERENCES public.billing_units(id, project_id) MATCH FULL ON DELETE RESTRICT,
  UNIQUE (recipient_plan_id, billing_unit_id)
);

CREATE TABLE public.billing_unit_events (
  id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id                 bigint NOT NULL,
  billing_unit_id            bigint NOT NULL,
  operation_key              uuid NOT NULL,
  event_type                 text NOT NULL
                               CHECK (event_type IN ('created', 'plan_changed', 'fixed', 'issued', 'collection_recorded', 'corrected', 'cancelled')),
  reason                     text,
  before_value               jsonb,
  after_value                jsonb NOT NULL,
  actor_user_id              uuid,
  recorded_at                timestamptz NOT NULL DEFAULT now(),
  schema_version             integer NOT NULL DEFAULT 1 CHECK (schema_version > 0),
  FOREIGN KEY (billing_unit_id, project_id)
    REFERENCES public.billing_units(id, project_id) MATCH FULL ON DELETE RESTRICT,
  FOREIGN KEY (operation_key, project_id)
    REFERENCES public.billing_operations(operation_key, project_id) MATCH FULL ON DELETE RESTRICT,
  UNIQUE (operation_key, billing_unit_id, event_type),
  CHECK (event_type <> 'corrected' OR (reason IS NOT NULL AND length(trim(reason)) > 0))
);

CREATE TABLE public.ownership_transfers (
  id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  operation_key              uuid NOT NULL UNIQUE,
  project_id                 bigint NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
  from_customer_id           bigint NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  to_customer_id             bigint NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  transfer_date              date NOT NULL,
  event_type                 text NOT NULL DEFAULT 'transfer' CHECK (event_type IN ('transfer', 'correction')),
  corrects_transfer_id       bigint REFERENCES public.ownership_transfers(id) ON DELETE RESTRICT,
  contract_before            jsonb NOT NULL,
  contract_after             jsonb NOT NULL,
  project_fields_before      jsonb NOT NULL DEFAULT '{}'::jsonb,
  project_fields_after       jsonb NOT NULL DEFAULT '{}'::jsonb,
  field_decisions            jsonb NOT NULL,
  validation_result          jsonb NOT NULL,
  snapshot_schema_version    integer NOT NULL DEFAULT 1 CHECK (snapshot_schema_version > 0),
  actor_user_id              uuid,
  recorded_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id),
  FOREIGN KEY (operation_key, project_id)
    REFERENCES public.billing_operations(operation_key, project_id) MATCH FULL ON DELETE RESTRICT,
  FOREIGN KEY (project_id, corrects_transfer_id)
    REFERENCES public.ownership_transfers(project_id, id) MATCH SIMPLE ON DELETE RESTRICT,
  CHECK (from_customer_id <> to_customer_id),
  CHECK ((event_type = 'correction') = (corrects_transfer_id IS NOT NULL)),
  CHECK (jsonb_typeof(contract_before) = 'object' AND jsonb_typeof(contract_after) = 'object'),
  CHECK (jsonb_typeof(project_fields_before) = 'object' AND jsonb_typeof(project_fields_after) = 'object'),
  CHECK (jsonb_typeof(field_decisions) = 'object' AND jsonb_typeof(validation_result) = 'object')
);

CREATE INDEX ownership_transfers_project_date_idx
  ON public.ownership_transfers (project_id, transfer_date, id);

CREATE OR REPLACE FUNCTION public.reject_audit_row_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are append-only';
END $$;

CREATE TRIGGER billing_unit_events_append_only
BEFORE UPDATE OR DELETE ON public.billing_unit_events
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_row_mutation();
CREATE TRIGGER ownership_transfers_append_only
BEFORE UPDATE OR DELETE ON public.ownership_transfers
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_row_mutation();
CREATE TRIGGER billing_unit_events_reject_truncate
BEFORE TRUNCATE ON public.billing_unit_events
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_row_mutation();
CREATE TRIGGER ownership_transfers_reject_truncate
BEFORE TRUNCATE ON public.ownership_transfers
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_row_mutation();

REVOKE ALL ON FUNCTION public.validate_billing_unit_frozen_line_items() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_billing_unit_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_audit_row_mutation() FROM PUBLIC;

ALTER TABLE public.billing_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_recipient_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_recipient_plan_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_unit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ownership_transfers ENABLE ROW LEVEL SECURITY;

-- Intentionally omitted until authentication/authorization is approved:
-- * permissive RLS policies or grants
-- * SECURITY DEFINER functions
-- * transfer_ownership / issue / collection / correction RPCs
-- * legacy-data backfill and cutover gates
