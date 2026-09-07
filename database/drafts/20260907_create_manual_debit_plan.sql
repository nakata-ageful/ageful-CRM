DO $$ BEGIN IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF; END $$;
-- Explicit single occurrence. No recurring generation or bank arrangement.
CREATE FUNCTION public.create_manual_debit_plan(p_key uuid,p_project bigint,p_contract bigint,p_recipient bigint,
 p_year integer,p_month integer,p_date date,p_amount bigint,p_note text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); fingerprint text; op public.billing_operations%ROWTYPE; u public.billing_units%ROWTYPE; result jsonb; active_plan public.billing_recipient_plans%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
 IF p_key IS NULL OR p_project IS NULL OR p_contract IS NULL OR p_recipient IS NULL
  OR p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2200 OR p_month IS NULL OR p_month NOT BETWEEN 1 AND 12 OR p_date IS NULL
  OR p_amount<0 OR p_amount>9007199254740991 OR p_note IS NULL OR p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION '振替予定の入力を確認してください'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','create_manual_debit','project',p_project,'contract',p_contract,
  'recipient',p_recipient,'year',p_year,'month',p_month,'date',p_date,'amount',p_amount,'note',p_note,'reason',p_reason,'actor',actor)::text,'UTF8')),'hex');
 INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id) VALUES(p_key,'plan',p_project,fingerprint,actor) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_key FOR UPDATE;
 IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION '同じ操作IDで別の内容は保存できません'; END IF;
 IF op.completed_at IS NOT NULL THEN SELECT after_value INTO STRICT result FROM public.billing_unit_events WHERE operation_key=p_key; RETURN result; END IF;
 PERFORM id FROM public.projects WHERE id=p_project FOR UPDATE;
 PERFORM id FROM public.billing_recipient_plans WHERE project_id=p_project ORDER BY id FOR UPDATE;
 SELECT * INTO active_plan FROM public.billing_recipient_plans WHERE project_id=p_project AND retired_at IS NULL;
 PERFORM id FROM public.contracts WHERE id=p_contract AND project_id=p_project FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '対象契約を確認してください'; END IF;
 -- The same service month is not added twice, even if its method was later changed.
 IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=p_project AND service_year=p_year AND service_month=p_month AND lifecycle<>'cancelled') THEN RAISE EXCEPTION 'この月の予定はすでにあります'; END IF;
 INSERT INTO public.billing_units(project_id,contract_id,recipient_plan_id,recipient_customer_id,recipient_source,occurrence_key,service_year,service_month,
  scheduled_date,original_method,collection_method,planned_amount,plan_note)
 VALUES(p_project,p_contract,active_plan.id,p_recipient,CASE WHEN active_plan.id IS NULL THEN 'confirmed' WHEN active_plan.default_recipient_customer_id=p_recipient THEN 'default' ELSE 'override' END,
  'manual-debit:'||p_key::text,p_year,p_month,p_date,'direct_debit','direct_debit',p_amount,p_note) RETURNING * INTO u;
 IF active_plan.id IS NOT NULL THEN
  IF u.recipient_source='override' THEN INSERT INTO public.billing_recipient_plan_overrides(recipient_plan_id,billing_unit_id,project_id,recipient_customer_id) VALUES(active_plan.id,u.id,p_project,p_recipient); END IF;
  UPDATE public.billing_recipient_plans SET revision=revision+1 WHERE id=active_plan.id;
 END IF;
 INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,before_value,after_value,actor_user_id,reason)
 VALUES(p_project,u.id,p_key,'created',NULL,to_jsonb(u),actor,p_reason);
 UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_key;
 RETURN to_jsonb(u);
END $$;
REVOKE ALL ON FUNCTION public.create_manual_debit_plan(uuid,bigint,bigint,bigint,integer,integer,date,bigint,text,text) FROM PUBLIC;
