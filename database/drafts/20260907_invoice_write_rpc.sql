-- ISOLATED TEST DRAFT ONLY. Apply after the foundation within the same transaction.
-- No application connection, EXECUTE grant, RLS policy or SECURITY DEFINER is added.
-- auth.uid() must come from trusted authentication. Tests supply a synthetic fixture.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Draft migration blocked';
  END IF;
END $$;

CREATE FUNCTION public.write_invoice_unit(
  p_operation_key uuid, p_unit_id bigint, p_expected_revision integer,
  p_kind text, p_value jsonb, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE
  actor uuid := auth.uid();
  old_unit public.billing_units%ROWTYPE;
  new_unit public.billing_units%ROWTYPE;
  op public.billing_operations%ROWTYPE;
  fingerprint text;
  target_project bigint;
  result jsonb;
  k text;
  editable_keys text[];
  active_plan public.billing_recipient_plans%ROWTYPE;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_operation_key IS NULL OR p_unit_id IS NULL OR p_expected_revision IS NULL
     OR p_expected_revision < 0 OR p_kind IS NULL OR p_kind NOT IN ('plan', 'issue', 'collection', 'correction', 'cancel') THEN
    RAISE EXCEPTION '操作・対象・版を確認してください';
  END IF;
  IF p_kind IN ('correction','cancel') AND (p_reason IS NULL OR length(trim(p_reason)) = 0) THEN
    IF p_kind='cancel' THEN RAISE EXCEPTION '取りやめの理由を入力してください'; END IF;
    RAISE EXCEPTION '訂正理由を入力してください';
  END IF;
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION '変更内容が不正です'; END IF;
  editable_keys := CASE p_kind
    WHEN 'cancel' THEN ARRAY[]::text[]
    WHEN 'plan' THEN ARRAY['recipient_customer_id','scheduled_date']
    WHEN 'collection' THEN ARRAY['received_on']
    ELSE ARRAY['recipient_customer_id','frozen_amount','frozen_line_items',
      'scheduled_date','issued_on','received_on','payment_due_on'] END;
  -- Each operation accepts only the fields it owns; omission cannot clear other data.
  IF NOT (p_value ?& editable_keys) THEN
    RAISE EXCEPTION '変更項目が不足しています';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_value) LOOP
    IF NOT (k = ANY(editable_keys)) THEN
      RAISE EXCEPTION '変更できない項目です: %', k;
    END IF;
  END LOOP;
  IF p_kind IN ('issue','correction') AND (jsonb_typeof(p_value->'recipient_customer_id') IS DISTINCT FROM 'number'
     OR (p_value->>'recipient_customer_id') !~ '^[1-9][0-9]*$'
     OR jsonb_typeof(p_value->'frozen_amount') IS DISTINCT FROM 'number'
     OR (p_value->>'frozen_amount') !~ '^[0-9]+$') THEN
    RAISE EXCEPTION '請求先・確定金額を確認してください';
  END IF;
  IF p_kind = 'plan' AND p_value->'recipient_customer_id' <> 'null'::jsonb AND
    (jsonb_typeof(p_value->'recipient_customer_id') <> 'number' OR (p_value->>'recipient_customer_id') !~ '^[1-9][0-9]*$') THEN
    RAISE EXCEPTION '請求先を確認してください';
  END IF;
  FOR k IN SELECT unnest(ARRAY['scheduled_date','issued_on','received_on','payment_due_on']) LOOP
    IF p_value->k <> 'null'::jsonb AND
       (jsonb_typeof(p_value->k) <> 'string' OR (p_value->>k) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') THEN
      RAISE EXCEPTION '日付が不正です: %', k;
    END IF;
  END LOOP;
  SELECT project_id INTO STRICT target_project FROM public.billing_units WHERE id = p_unit_id;
  fingerprint := encode(sha256(convert_to(jsonb_build_object('unit',p_unit_id,'revision',p_expected_revision,
    'kind',p_kind,'value',p_value,'reason',p_reason,'actor',actor)::text, 'UTF8')), 'hex');
  INSERT INTO public.billing_operations(operation_key, operation_kind, project_id, request_hash, actor_user_id)
    VALUES (p_operation_key, p_kind, target_project, fingerprint, actor) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key = p_operation_key FOR UPDATE;
  IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION '同じ操作IDで違う変更は保存できません';
  END IF;
  IF op.completed_at IS NOT NULL THEN
    SELECT after_value INTO STRICT result FROM public.billing_unit_events
      WHERE operation_key = p_operation_key AND billing_unit_id = p_unit_id;
    RETURN result; -- Prior operation result. Caller must reload current state after success.
  END IF;
  -- Same lock order as bulk recipient changes and future plan generation.
  PERFORM 1 FROM public.projects WHERE id = target_project FOR UPDATE;
  SELECT * INTO active_plan FROM public.billing_recipient_plans
    WHERE project_id = target_project AND retired_at IS NULL FOR UPDATE;
  SELECT * INTO STRICT old_unit FROM public.billing_units WHERE id = p_unit_id FOR UPDATE;
  IF old_unit.revision <> p_expected_revision THEN RAISE EXCEPTION '情報が更新されています。確認し直してください'; END IF;
  IF old_unit.original_method <> 'invoice' OR old_unit.collection_method <> 'invoice' THEN
    RAISE EXCEPTION '今回は請求書のみ対象です';
  END IF;
  IF (p_kind IN ('plan','issue','cancel') AND old_unit.lifecycle <> 'planned') OR
     (p_kind = 'collection' AND (old_unit.lifecycle <> 'issued' OR old_unit.received_on IS NOT NULL)) OR
     (p_kind = 'correction' AND old_unit.lifecycle NOT IN ('issued','received')) THEN
    RAISE EXCEPTION 'この状態では実行できません';
  END IF;
  IF p_kind = 'issue' AND (p_value->>'issued_on' IS NULL OR p_value->>'received_on' IS NOT NULL) THEN
    RAISE EXCEPTION '発行日を入力してください。入金は別途記録してください';
  END IF;
  IF p_kind IN ('issue','correction') AND p_value->>'issued_on' IS NULL AND p_value->>'received_on' IS NULL THEN
    RAISE EXCEPTION '発行・入金実績を空にする操作は取消で行ってください';
  END IF;
  IF p_kind = 'cancel' THEN
    UPDATE public.billing_units SET lifecycle='cancelled',collection_state='not_applicable',revision=revision+1
      WHERE id=p_unit_id RETURNING * INTO new_unit;
    IF active_plan.id IS NOT NULL THEN
      UPDATE public.billing_recipient_plans SET revision=revision+1 WHERE id=active_plan.id;
    END IF;
  ELSIF p_kind = 'collection' THEN
    IF p_value->>'received_on' IS NULL THEN RAISE EXCEPTION '入金日を入力してください'; END IF;
    UPDATE public.billing_units SET received_on = (p_value->>'received_on')::date,
      lifecycle = 'received', collection_state = 'succeeded', revision = revision + 1
      WHERE id = p_unit_id RETURNING * INTO new_unit;
  ELSIF p_kind = 'plan' THEN
    IF active_plan.id IS NOT NULL THEN
      -- Only the active plan's exception is mutable; retired plans remain historical.
      DELETE FROM public.billing_recipient_plan_overrides
        WHERE recipient_plan_id = active_plan.id AND billing_unit_id = p_unit_id;
      IF p_value->>'recipient_customer_id' IS NOT NULL
        AND (p_value->>'recipient_customer_id')::bigint <> active_plan.default_recipient_customer_id THEN
        INSERT INTO public.billing_recipient_plan_overrides
          (project_id,recipient_plan_id,billing_unit_id,recipient_customer_id)
          VALUES(target_project,active_plan.id,p_unit_id,(p_value->>'recipient_customer_id')::bigint);
      END IF;
      UPDATE public.billing_recipient_plans SET revision = revision + 1 WHERE id = active_plan.id;
    END IF;
    UPDATE public.billing_units SET recipient_customer_id = (p_value->>'recipient_customer_id')::bigint,
      recipient_plan_id = CASE WHEN p_value->>'recipient_customer_id' IS NULL THEN NULL ELSE active_plan.id END,
      recipient_source = CASE WHEN p_value->>'recipient_customer_id' IS NULL THEN 'unconfirmed'
        WHEN active_plan.id IS NULL THEN 'confirmed'
        WHEN (p_value->>'recipient_customer_id')::bigint = active_plan.default_recipient_customer_id THEN 'default'
        ELSE 'override' END,
      scheduled_date = (p_value->>'scheduled_date')::date, revision = revision + 1
      WHERE id = p_unit_id RETURNING * INTO new_unit;
  ELSE
    UPDATE public.billing_units SET
    recipient_customer_id = (p_value->>'recipient_customer_id')::bigint,
    recipient_source = 'confirmed', frozen_amount = (p_value->>'frozen_amount')::bigint,
    frozen_line_items = p_value->'frozen_line_items', frozen_at = clock_timestamp(),
    amount_basis = 'operator_confirmed', scheduled_date = (p_value->>'scheduled_date')::date,
    issued_on = (p_value->>'issued_on')::date, received_on = (p_value->>'received_on')::date,
    payment_due_on = (p_value->>'payment_due_on')::date,
    lifecycle = CASE WHEN p_value->>'received_on' IS NOT NULL THEN 'received' ELSE 'issued' END,
    collection_state = CASE WHEN p_value->>'received_on' IS NOT NULL THEN 'succeeded' ELSE 'pending' END,
    revision = revision + 1
    WHERE id = p_unit_id RETURNING * INTO new_unit;
  END IF;
  INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,reason,
      before_value,after_value,actor_user_id)
    VALUES (new_unit.project_id,new_unit.id,p_operation_key,
      CASE p_kind WHEN 'cancel' THEN 'cancelled' WHEN 'plan' THEN 'plan_changed' WHEN 'issue' THEN 'issued'
        WHEN 'collection' THEN 'collection_recorded' ELSE 'corrected' END,
      p_reason,to_jsonb(old_unit),to_jsonb(new_unit),actor);
  UPDATE public.billing_operations SET completed_at = clock_timestamp() WHERE operation_key = p_operation_key;
  RETURN to_jsonb(new_unit);
END $$;

-- A changed unit must have a matching completed audit event at transaction commit.
-- This is not an authorization substitute: no application roles are granted write access here.
CREATE FUNCTION public.require_invoice_update_event() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.id <> OLD.id OR NEW.project_id <> OLD.project_id OR NEW.contract_id <> OLD.contract_id
     OR NEW.occurrence_key <> OLD.occurrence_key OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION '請求回の識別・版が不正です';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_unit_events e
    JOIN public.billing_operations o ON o.operation_key = e.operation_key
    WHERE e.billing_unit_id = NEW.id AND e.before_value = to_jsonb(OLD) AND e.after_value = to_jsonb(NEW)
      AND e.actor_user_id IS NOT NULL AND e.actor_user_id = o.actor_user_id
      AND o.completed_at IS NOT NULL) THEN
    RAISE EXCEPTION '請求の更新と履歴を一緒に保存してください';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER billing_unit_update_requires_event
AFTER UPDATE ON public.billing_units DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.require_invoice_update_event();
CREATE TRIGGER billing_units_reject_delete BEFORE DELETE ON public.billing_units
FOR EACH ROW EXECUTE FUNCTION public.reject_audit_row_mutation();
CREATE TRIGGER billing_units_reject_truncate BEFORE TRUNCATE ON public.billing_units
FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_row_mutation();
REVOKE ALL ON FUNCTION public.write_invoice_unit(uuid,bigint,integer,text,jsonb,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.require_invoice_update_event() FROM PUBLIC;
