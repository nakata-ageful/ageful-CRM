-- Isolated only. Requires invoice_recipient_initialization and imported source guard.
-- Initialization closes legacy billing creation; it does NOT enable the new UI.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF;
END $$;
CREATE FUNCTION public.legacy_record_has_billing(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM jsonb_each(value) e WHERE e.key=ANY(ARRAY[
    'billing_scheduled_date','billing_date','payment_due_date','received_date','line_items','payments'])
    AND e.value NOT IN ('null'::jsonb,'""'::jsonb,'[]'::jsonb))
    OR coalesce(value->>'transfer_failed','false')<>'false'
    OR coalesce(value->>'status','') NOT IN ('','未入金')
$$;
REVOKE ALL ON FUNCTION public.legacy_record_has_billing(jsonb) FROM PUBLIC;
CREATE FUNCTION public.guard_legacy_invoice_creation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE project_key bigint; old_project_key bigint; new_value jsonb:=to_jsonb(NEW);
BEGIN
  SELECT project_id INTO STRICT project_key FROM public.contracts WHERE id=NEW.contract_id;
  IF TG_OP='UPDATE' THEN SELECT project_id INTO STRICT old_project_key FROM public.contracts WHERE id=OLD.contract_id; END IF;
  -- Serialize against initialization. A conflicting legacy UPDATE can deadlock with
  -- an annual-row lock; PostgreSQL aborts one transaction, never silently accepts both.
  PERFORM 1 FROM public.projects WHERE id IN (project_key,old_project_key) ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.invoice_recipient_initializations WHERE project_id IN (project_key,old_project_key)) THEN
    IF TG_OP='INSERT' THEN
      IF public.legacy_record_has_billing(new_value) THEN RAISE EXCEPTION '請求先の初期設定後は新しい請求画面で登録してください'; END IF;
    ELSE
      IF OLD.contract_id IS DISTINCT FROM NEW.contract_id THEN RAISE EXCEPTION '初期設定済みの年度記録は別契約へ移せません'; END IF;
      -- Imported rows have a stricter immutable billing guard already. Allow their
      -- notes to change; unimported maintenance-only rows must remain billing-free.
      IF NOT EXISTS(SELECT 1 FROM public.invoice_import_evidence WHERE source_annual_record_id=OLD.id)
        AND public.legacy_record_has_billing(new_value) THEN RAISE EXCEPTION '請求先の初期設定後は新しい請求画面で登録してください'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_legacy_invoice_creation() FROM PUBLIC;
CREATE TRIGGER legacy_invoice_creation_guard BEFORE INSERT OR UPDATE ON public.annual_records
FOR EACH ROW EXECUTE FUNCTION public.guard_legacy_invoice_creation();
