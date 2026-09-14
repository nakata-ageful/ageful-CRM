-- Local migration tooling only. No application-role grants; use after migration acceptance.
DO $$ BEGIN IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF; END $$;
CREATE FUNCTION public.confirm_imported_round(p_key uuid,p_expected jsonb,p_source jsonb,p_round integer,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); old_unit public.billing_units%ROWTYPE; new_unit public.billing_units%ROWTYPE;
 op public.billing_operations%ROWTYPE; fingerprint text;
BEGIN
 IF actor IS NULL OR p_key IS NULL OR p_round IS NULL OR p_round NOT BETWEEN 1 AND 96 OR p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION '回番号と確認根拠が必要です'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('expected',p_expected,'source',p_source,'round',p_round,'reason',p_reason,'actor',actor)::text,'UTF8')),'hex');
 INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
 VALUES(p_key,'correction',(p_expected->>'project_id')::bigint,fingerprint,actor) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_key FOR UPDATE;
 IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION '同じ操作IDで内容は変更できません'; END IF;
 IF op.completed_at IS NOT NULL THEN RETURN (SELECT after_value FROM public.billing_unit_events WHERE operation_key=p_key AND event_type='corrected'); END IF;
 PERFORM id FROM public.projects WHERE id=op.project_id FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.billing_migration_acceptances WHERE project_id=op.project_id) THEN RAISE EXCEPTION '移行照合を先に完了してください'; END IF;
 PERFORM id FROM public.billing_units WHERE project_id=op.project_id ORDER BY id FOR UPDATE;
 SELECT * INTO STRICT old_unit FROM public.billing_units WHERE id=(p_expected->>'id')::bigint AND project_id=op.project_id;
 IF to_jsonb(old_unit) IS DISTINCT FROM p_expected OR old_unit.round_number IS NOT NULL OR old_unit.service_month IS NOT NULL OR old_unit.source_annual_record_id IS NULL OR old_unit.source_payment_index IS DISTINCT FROM 0 THEN RAISE EXCEPTION '未対応の単回記録ではないか、記録が更新されています'; END IF;
 PERFORM id FROM public.annual_records WHERE id=old_unit.source_annual_record_id FOR SHARE;
 IF NOT EXISTS(SELECT 1 FROM public.invoice_import_evidence e JOIN public.annual_records a ON a.id=e.source_annual_record_id
  WHERE a.id=old_unit.source_annual_record_id AND e.project_id=op.project_id AND e.source_record=p_source AND to_jsonb(a)=p_source)
 THEN RAISE EXCEPTION '確認時の元記録と一致しません'; END IF;
 IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=op.project_id AND service_year=old_unit.service_year AND id<>old_unit.id AND (round_number=p_round OR service_month IS NOT NULL OR round_number IS NULL)) THEN RAISE EXCEPTION '同じ保守期間の回が重複または未確認です'; END IF;
 UPDATE public.billing_units SET round_number=p_round,revision=revision+1 WHERE id=old_unit.id RETURNING * INTO new_unit;
 INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,before_value,after_value,actor_user_id,reason)
 VALUES(op.project_id,old_unit.id,p_key,'corrected',to_jsonb(old_unit),to_jsonb(new_unit),actor,p_reason);
 UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_key;
 RETURN to_jsonb(new_unit);
END $$;
REVOKE ALL ON FUNCTION public.confirm_imported_round(uuid,jsonb,jsonb,integer,text) FROM PUBLIC;
