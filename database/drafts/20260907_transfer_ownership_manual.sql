-- Isolated only: combines explicit existing billing plans with ownership/detail snapshots.
DO $$ BEGIN IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF; END $$;
CREATE FUNCTION public.transfer_ownership_manual(p_key uuid,p_project bigint,p_owner bigint,p_date date,
  p_expected_project jsonb,p_expected_contract jsonb,p_fields jsonb,p_choices jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); op public.billing_operations%ROWTYPE; old_project public.projects%ROWTYPE;
  old_contract public.contracts%ROWTYPE; new_project public.projects%ROWTYPE; new_contract public.contracts%ROWTYPE;
  patches jsonb; project_patch jsonb; contract_patch jsonb; assignments text; fingerprint text; child uuid;
  old_name text; transfer_id bigint; c jsonb;
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
  IF p_key IS NULL OR p_project IS NULL OR p_owner IS NULL OR p_date IS NULL OR p_date>current_date
    OR jsonb_typeof(p_expected_project) IS DISTINCT FROM 'object' OR jsonb_typeof(p_expected_contract) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_choices) IS DISTINCT FROM 'array' OR p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION '移転の確認内容が不正です'; END IF;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','manual_transfer','project',p_project,'owner',p_owner,
    'date',p_date,'expected_project',p_expected_project,'expected_contract',p_expected_contract,'fields',p_fields,
    'choices',p_choices,'reason',p_reason,'actor',actor)::text,'UTF8')),'hex');
  INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
    VALUES(p_key,'ownership_transfer',p_project,fingerprint,actor) ON CONFLICT DO NOTHING;
  SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_key FOR UPDATE;
  IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION '同じ操作IDで別の内容は保存できません'; END IF;
  IF op.completed_at IS NOT NULL THEN RETURN jsonb_build_object('operation_key',p_key,'completed',true); END IF;
  SELECT * INTO STRICT old_project FROM public.projects WHERE id=p_project FOR UPDATE;
  PERFORM id FROM public.billing_recipient_plans WHERE project_id=p_project ORDER BY id FOR UPDATE;
  PERFORM id FROM public.contracts WHERE project_id=p_project ORDER BY id FOR UPDATE;
  IF (SELECT count(*) FROM public.contracts WHERE project_id=p_project)<>1 THEN RAISE EXCEPTION '契約が1件ではありません'; END IF;
  SELECT * INTO STRICT old_contract FROM public.contracts WHERE project_id=p_project;
  IF to_jsonb(old_project) IS DISTINCT FROM p_expected_project OR to_jsonb(old_contract) IS DISTINCT FROM p_expected_contract THEN RAISE EXCEPTION '発電所・契約が更新されています'; END IF;
  IF old_project.customer_id IS NULL OR old_project.customer_id=p_owner THEN RAISE EXCEPTION '変更前後の所有者を確認してください'; END IF;
  PERFORM id FROM public.customers WHERE id IN(old_project.customer_id,p_owner) ORDER BY id FOR KEY SHARE;
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id=p_owner) THEN RAISE EXCEPTION '新所有者が存在しません'; END IF;
  SELECT name INTO STRICT old_name FROM public.customers WHERE id=old_project.customer_id;
  IF p_date<old_contract.ownership_transfer_date OR p_date<(SELECT max(transfer_date) FROM public.ownership_transfers WHERE project_id=p_project) THEN RAISE EXCEPTION '前の移転より前の日付です'; END IF;
  PERFORM id FROM public.annual_records WHERE contract_id=old_contract.id ORDER BY id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM public.annual_records WHERE contract_id=old_contract.id) THEN RAISE EXCEPTION '旧年度記録の移行統合は未対応です'; END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(p_choices) LOOP
    IF (c->>'recipientId')::bigint NOT IN(old_project.customer_id,p_owner) THEN RAISE EXCEPTION '請求先は変更前後の所有者を指定してください'; END IF;
  END LOOP;
  patches:=public.prepare_transfer_detail_choices(to_jsonb(old_project),to_jsonb(old_contract),p_fields);
  -- Retain the prior default/overrides as history; future creations use the new owner.
  UPDATE public.billing_recipient_plans SET retired_at=clock_timestamp(),revision=revision+1 WHERE project_id=p_project AND retired_at IS NULL;
  INSERT INTO public.billing_recipient_plans(project_id,default_recipient_customer_id,effective_from)
    VALUES(p_project,p_owner,p_date);
  child:=substr(encode(sha256(convert_to(p_key::text||':manual-plan','UTF8')),'hex'),1,32)::uuid;
  PERFORM public.write_manual_billing_plan(child,p_project,p_choices,p_reason);
  project_patch:=(patches->'project')||jsonb_build_object('customer_id',p_owner,'old_owner',old_name);
  contract_patch:=(patches->'contract')||jsonb_build_object('ownership_transfer_date',p_date);
  SELECT string_agg(format('%I = r.%I',k,k),',') INTO assignments FROM jsonb_object_keys(project_patch) k;
  EXECUTE format('UPDATE public.projects t SET %s FROM jsonb_populate_record(NULL::public.projects,$1) r WHERE t.id=$2 RETURNING t.*',assignments) INTO new_project USING project_patch,p_project;
  SELECT string_agg(format('%I = r.%I',k,k),',') INTO assignments FROM jsonb_object_keys(contract_patch) k;
  EXECUTE format('UPDATE public.contracts t SET %s FROM jsonb_populate_record(NULL::public.contracts,$1) r WHERE t.id=$2 RETURNING t.*',assignments) INTO new_contract USING contract_patch,old_contract.id;
  INSERT INTO public.ownership_transfers(operation_key,project_id,from_customer_id,to_customer_id,transfer_date,
    contract_before,contract_after,project_fields_before,project_fields_after,field_decisions,validation_result,actor_user_id)
    VALUES(p_key,p_project,old_project.customer_id,p_owner,p_date,to_jsonb(old_contract),to_jsonb(new_contract),to_jsonb(old_project),to_jsonb(new_project),
      jsonb_build_object('default','keep','choices',p_fields,'billing_choices',p_choices,'reason',p_reason),
      jsonb_build_object('scope','isolated_manual_without_legacy_or_recipient_plan','billing_operation',child),actor) RETURNING id INTO transfer_id;
  UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_key;
  RETURN jsonb_build_object('operation_key',p_key,'completed',true);
END $$;
REVOKE ALL ON FUNCTION public.transfer_ownership_manual(uuid,bigint,bigint,date,jsonb,jsonb,jsonb,jsonb,text) FROM PUBLIC;
