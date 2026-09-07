-- Isolated draft. Partial legacy protection, NOT a cutover or new-source insert gate.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF;
END $$;
CREATE FUNCTION public.guard_imported_invoice_source() RETURNS trigger
-- Owner must be the trusted migration role: caller RLS must not hide import evidence.
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,pg_temp AS $$
DECLARE old_billing jsonb; new_billing jsonb;
BEGIN
  IF TG_OP='TRUNCATE' THEN
    IF EXISTS(SELECT 1 FROM public.invoice_import_evidence) THEN RAISE EXCEPTION '移行済み請求の元記録は削除できません'; END IF;
    RETURN NULL;
  END IF;
  IF EXISTS(SELECT 1 FROM public.invoice_import_evidence WHERE source_annual_record_id=OLD.id) THEN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION '移行済み請求の元記録は削除できません'; END IF;
    SELECT jsonb_object_agg(key,value) INTO old_billing FROM jsonb_each(to_jsonb(OLD))
      WHERE key=ANY(ARRAY['id','contract_id','year','billing_scheduled_date','billing_date','payment_due_date','received_date','line_items','payments','transfer_failed','status']);
    SELECT jsonb_object_agg(key,value) INTO new_billing FROM jsonb_each(to_jsonb(NEW))
      WHERE key=ANY(ARRAY['id','contract_id','year','billing_scheduled_date','billing_date','payment_due_date','received_date','line_items','payments','transfer_failed','status']);
    IF old_billing IS DISTINCT FROM new_billing THEN RAISE EXCEPTION '移行済みの請求は新しい請求記録で変更してください'; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_imported_invoice_source() FROM PUBLIC;
CREATE TRIGGER imported_invoice_source_guard BEFORE UPDATE OR DELETE ON public.annual_records
FOR EACH ROW EXECUTE FUNCTION public.guard_imported_invoice_source();
CREATE TRIGGER imported_invoice_source_truncate_guard BEFORE TRUNCATE ON public.annual_records
FOR EACH STATEMENT EXECUTE FUNCTION public.guard_imported_invoice_source();
