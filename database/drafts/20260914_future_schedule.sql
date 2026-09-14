DO $$ BEGIN IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF; END $$;
-- Explicitly reviewed, insert-only future occurrences. No bank instruction or automatic issue.
CREATE FUNCTION public.create_future_schedule(p_key uuid,p_project bigint,p_contract jsonb,p_versions jsonb,p_last bigint,p_items jsonb,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); fingerprint text; op public.billing_operations%ROWTYPE;
 c public.contracts%ROWTYPE; plan public.billing_recipient_plans%ROWTYPE; u public.billing_units%ROWTYPE;
 item jsonb; d date; y integer; n integer; method text; slot text; result jsonb:='[]'; current_versions jsonb;
 ps date; pe date; anchor_month integer; anchor_day integer;
BEGIN
 IF actor IS NULL OR p_key IS NULL OR p_project IS NULL OR p_reason IS NULL OR length(trim(p_reason))=0
 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 96 THEN RAISE EXCEPTION '追加する予定と確認内容を指定してください'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','future_schedule','project',p_project,'contract',p_contract,'versions',p_versions,'last',p_last,'items',p_items,'reason',p_reason,'actor',actor)::text,'UTF8')),'hex');
 INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id) VALUES(p_key,'plan',p_project,fingerprint,actor) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_key FOR UPDATE;
 IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION '同じ操作IDで内容は変更できません'; END IF;
 IF op.completed_at IS NOT NULL THEN RETURN (SELECT coalesce(jsonb_agg(after_value ORDER BY id),'[]') FROM public.billing_unit_events WHERE operation_key=p_key); END IF;
 PERFORM id FROM public.projects WHERE id=p_project FOR UPDATE;
 IF (SELECT count(*) FROM public.contracts WHERE project_id=p_project)<>1 THEN RAISE EXCEPTION '契約が複数または未設定です'; END IF;
 SELECT * INTO STRICT c FROM public.contracts WHERE project_id=p_project FOR UPDATE;
 IF to_jsonb(c) IS DISTINCT FROM p_contract THEN RAISE EXCEPTION '契約が更新されています。候補を再確認してください'; END IF;
 PERFORM id FROM public.billing_recipient_plans WHERE project_id=p_project ORDER BY id FOR UPDATE;
 SELECT * INTO plan FROM public.billing_recipient_plans WHERE project_id=p_project AND retired_at IS NULL;
 PERFORM id FROM public.billing_units WHERE project_id=p_project ORDER BY id FOR UPDATE;
 SELECT coalesce(jsonb_object_agg(id::text,revision),'{}') INTO current_versions FROM public.billing_units WHERE project_id=p_project;
 IF current_versions IS DISTINCT FROM p_versions OR (SELECT coalesce(max(id),0) FROM public.project_management_events WHERE project_id=p_project) IS DISTINCT FROM p_last THEN RAISE EXCEPTION '予定または管理履歴が更新されています'; END IF;
 IF c.maintenance_start_date IS NULL THEN RAISE EXCEPTION '保守開始日を確認してください'; END IF;
 anchor_month:=extract(month FROM c.maintenance_start_date); anchor_day:=extract(day FROM c.maintenance_start_date);
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' OR NOT(item ?& ARRAY['date','year','round','method','recipientId','amount','periodStart','periodEnd']) THEN RAISE EXCEPTION '対象保守期間と予定の入力形式を確認してください'; END IF;
  d:=(item->>'date')::date; y:=(item->>'year')::integer; n:=(item->>'round')::integer; method:=item->>'method';
  IF d IS NULL OR y IS NULL OR n IS NULL OR y NOT BETWEEN 2000 AND 2199 OR d NOT BETWEEN date '2000-01-01' AND date '2200-12-31'
   OR n<1 OR n>96 OR method IS NULL OR method NOT IN ('invoice','direct_debit')
   OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'number' OR (item->>'amount')::numeric NOT BETWEEN 0 AND 9007199254740991
   OR (item->>'amount')::numeric<>trunc((item->>'amount')::numeric)
   OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=(item->>'recipientId')::bigint) THEN RAISE EXCEPTION '予定日・回・請求先・金額を確認してください'; END IF;
  ps:=make_date(y,anchor_month,least(anchor_day,extract(day FROM (make_date(y,anchor_month,1)+interval '1 month -1 day'))::integer));
  pe:=make_date(y+1,anchor_month,least(anchor_day,extract(day FROM (make_date(y+1,anchor_month,1)+interval '1 month -1 day'))::integer))-1;
  IF (item->>'periodStart')::date IS DISTINCT FROM ps OR (item->>'periodEnd')::date IS DISTINCT FROM pe THEN RAISE EXCEPTION '対象保守期間が契約と一致しません'; END IF;
  IF NOT public.management_active_on(p_project,'all',ps) AND NOT EXISTS(SELECT 1 FROM public.project_management_events WHERE project_id=p_project AND scope='all' AND action='resume' AND effective_date BETWEEN ps AND pe) THEN RAISE EXCEPTION '全取引終了後の保守期間には予定を追加できません'; END IF;
  slot:='maintenance:'||y||':round:'||n;
  -- Include cancelled records and original identity: changing a date/method must not resurrect it.
  IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=p_project AND
   (occurrence_key=slot OR service_year=y AND
    (round_number=n OR service_month IS NOT NULL OR round_number IS NULL))) THEN RAISE EXCEPTION '保存済みの回との対応確認が必要です。二重作成は行いません'; END IF;
  INSERT INTO public.billing_units(project_id,contract_id,recipient_plan_id,recipient_customer_id,recipient_source,occurrence_key,service_year,service_month,round_number,scheduled_date,original_method,collection_method,planned_amount,amount_basis,plan_note,period_start,period_end)
  VALUES(p_project,c.id,plan.id,(item->>'recipientId')::bigint,CASE WHEN plan.id IS NULL THEN 'confirmed' WHEN plan.default_recipient_customer_id=(item->>'recipientId')::bigint THEN 'default' ELSE 'override' END,
   slot,y,NULL,n,d,method,method,(item->>'amount')::bigint,'operator_confirmed',p_reason,ps,pe) RETURNING * INTO u;
  IF u.recipient_source='override' THEN INSERT INTO public.billing_recipient_plan_overrides(recipient_plan_id,billing_unit_id,project_id,recipient_customer_id) VALUES(plan.id,u.id,p_project,u.recipient_customer_id); END IF;
  INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,before_value,after_value,actor_user_id,reason) VALUES(p_project,u.id,p_key,'created',NULL,to_jsonb(u),actor,p_reason);
  result:=result||jsonb_build_array(to_jsonb(u));
 END LOOP;
 IF plan.id IS NOT NULL THEN UPDATE public.billing_recipient_plans SET revision=revision+1 WHERE id=plan.id; END IF;
 UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_key;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.create_future_schedule(uuid,bigint,jsonb,jsonb,bigint,jsonb,text) FROM PUBLIC;
