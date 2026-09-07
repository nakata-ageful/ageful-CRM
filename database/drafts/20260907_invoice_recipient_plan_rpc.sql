-- ISOLATED TEST ONLY. Requires foundation + invoice_write_rpc. No public access.
-- Changes future invoice recipients only, NOT project ownership or contract terms.
DO $$ BEGIN
  IF current_setting('ageful.allow_draft_migration', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Draft migration blocked';
  END IF;
END $$;

CREATE FUNCTION public.write_invoice_recipient_plan(
  p_operation_key uuid, p_project_id bigint, p_expected_plan_id bigint,
  p_expected_plan_revision integer, p_expected_units jsonb,
  p_default_recipient_id bigint, p_overrides jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  actor uuid := auth.uid();
  op public.billing_operations%ROWTYPE;
  prior_plan public.billing_recipient_plans%ROWTYPE;
  new_plan public.billing_recipient_plans%ROWTYPE;
  old_unit public.billing_units%ROWTYPE;
  new_unit public.billing_units%ROWTYPE;
  fingerprint text;
  actual_versions jsonb;
  first_date date;
  entry record;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_operation_key IS NULL OR p_project_id IS NULL OR p_default_recipient_id IS NULL
    OR p_default_recipient_id <= 0
    OR ((p_expected_plan_id IS NULL) <> (p_expected_plan_revision IS NULL))
    OR p_expected_plan_revision < 0
    OR jsonb_typeof(p_expected_units) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_overrides) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION '請求先指定・確認した版が不正です';
  END IF;
  fingerprint := encode(sha256(convert_to(jsonb_build_object('project',p_project_id,
    'plan',p_expected_plan_id,'revision',p_expected_plan_revision,'units',p_expected_units,
    'default',p_default_recipient_id,'overrides',p_overrides,'actor',actor)::text,'UTF8')),'hex');
  INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
    VALUES(p_operation_key,'plan',p_project_id,fingerprint,actor) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_operation_key FOR UPDATE;
  IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN
    RAISE EXCEPTION '同じ操作IDで違う変更は保存できません';
  END IF;
  IF op.completed_at IS NOT NULL THEN
    -- Stable operation receipt, never rewind a later plan. Caller reloads current state.
    RETURN jsonb_build_object('operation_key',p_operation_key,'project_id',p_project_id,'completed',true);
  END IF;
  -- All future plan creation/generation must follow this project lock protocol.
  PERFORM 1 FROM public.projects WHERE id=p_project_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '発電所がありません'; END IF;
  SELECT * INTO prior_plan FROM public.billing_recipient_plans
    WHERE project_id=p_project_id AND retired_at IS NULL FOR UPDATE;
  IF prior_plan.id IS DISTINCT FROM p_expected_plan_id
    OR prior_plan.revision IS DISTINCT FROM p_expected_plan_revision THEN
    RAISE EXCEPTION '請求先の指定が更新されています。確認し直してください';
  END IF;
  -- Lock all units, not only the subset supplied by the client.
  PERFORM id FROM public.billing_units WHERE project_id=p_project_id ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=p_project_id
      AND lifecycle IN ('planned','review_required')
      AND (lifecycle='review_required' OR original_method<>'invoice' OR collection_method<>'invoice'
        OR scheduled_date IS NULL)) THEN
    RAISE EXCEPTION '未確認の請求・予定日・口座振替の扱いを先に確認してください';
  END IF;
  SELECT coalesce(jsonb_object_agg(id::text,revision),'{}'::jsonb),min(scheduled_date)
    INTO actual_versions,first_date FROM public.billing_units
    WHERE project_id=p_project_id AND lifecycle='planned';
  IF actual_versions='{}'::jsonb THEN RAISE EXCEPTION '未発行の請求予定がありません'; END IF;
  IF actual_versions IS DISTINCT FROM p_expected_units THEN
    RAISE EXCEPTION '請求予定が更新されています。全ての回を確認し直してください';
  END IF;
  PERFORM 1 FROM public.customers WHERE id=p_default_recipient_id;
  IF NOT FOUND THEN RAISE EXCEPTION '請求先が存在しません'; END IF;
  FOR entry IN SELECT * FROM jsonb_each(p_overrides) LOOP
    IF NOT (actual_versions ? entry.key) OR jsonb_typeof(entry.value) IS DISTINCT FROM 'number'
      OR entry.value::text !~ '^[1-9][0-9]*$' THEN
      RAISE EXCEPTION '個別指定は確認した未発行の回だけに指定してください';
    END IF;
    PERFORM 1 FROM public.customers WHERE id=(entry.value::text)::bigint;
    IF NOT FOUND THEN RAISE EXCEPTION '個別指定の請求先が存在しません'; END IF;
  END LOOP;
  IF prior_plan.id IS NOT NULL THEN
    UPDATE public.billing_recipient_plans SET retired_at=clock_timestamp(),revision=revision+1
      WHERE id=prior_plan.id;
  END IF;
  INSERT INTO public.billing_recipient_plans(project_id,default_recipient_customer_id,effective_from)
    VALUES(p_project_id,p_default_recipient_id,first_date) RETURNING * INTO new_plan;
  FOR old_unit IN SELECT * FROM public.billing_units
    WHERE project_id=p_project_id AND lifecycle='planned' ORDER BY id LOOP
    UPDATE public.billing_units SET recipient_plan_id=new_plan.id,
      recipient_customer_id=coalesce((p_overrides->>old_unit.id::text)::bigint,p_default_recipient_id),
      recipient_source=CASE WHEN p_overrides ? old_unit.id::text THEN 'override' ELSE 'default' END,
      revision=revision+1 WHERE id=old_unit.id RETURNING * INTO new_unit;
    IF p_overrides ? old_unit.id::text THEN
      INSERT INTO public.billing_recipient_plan_overrides(recipient_plan_id,billing_unit_id,project_id,recipient_customer_id)
        VALUES(new_plan.id,new_unit.id,p_project_id,new_unit.recipient_customer_id);
    END IF;
    INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,
      before_value,after_value,actor_user_id)
      VALUES(p_project_id,new_unit.id,p_operation_key,'plan_changed',to_jsonb(old_unit),to_jsonb(new_unit),actor);
  END LOOP;
  UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_operation_key;
  RETURN jsonb_build_object('operation_key',p_operation_key,'project_id',p_project_id,'completed',true);
END $$;
REVOKE ALL ON FUNCTION public.write_invoice_recipient_plan(uuid,bigint,bigint,integer,jsonb,bigint,jsonb) FROM PUBLIC;
