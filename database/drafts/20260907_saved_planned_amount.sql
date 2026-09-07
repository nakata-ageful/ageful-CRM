-- Isolated draft only. Nullable: never infer/backfill historical plans from today's contract.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF;
END $$;
ALTER TABLE public.billing_units ADD COLUMN IF NOT EXISTS planned_amount bigint;
ALTER TABLE public.billing_units ADD CONSTRAINT saved_planned_amount_safe
  CHECK(planned_amount IS NULL OR planned_amount BETWEEN 0 AND 9007199254740991);
COMMENT ON COLUMN public.billing_units.planned_amount IS 'D-027 saved editable estimate, not a frozen actual; null means not recorded. No current-contract fallback.';
