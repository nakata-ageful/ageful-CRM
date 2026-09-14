-- LOCAL FRESH-DB DRAFT ONLY. No business data or access policy is enabled here.
DO $$ BEGIN IF current_setting('ageful.allow_draft_migration',true) IS DISTINCT FROM 'yes' THEN RAISE EXCEPTION 'Draft migration blocked'; END IF; END $$;
CREATE TABLE public.project_management_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 project_id bigint NOT NULL REFERENCES public.projects(id) ON DELETE RESTRICT,
 operation_key uuid NOT NULL UNIQUE,
 scope text NOT NULL CHECK(scope IN('maintenance','all')),
 action text NOT NULL CHECK(action IN('end','resume')),
 effective_date date NOT NULL,
 reason text NOT NULL CHECK(length(trim(reason))>0),
 confirmed_choices jsonb NOT NULL CHECK(jsonb_typeof(confirmed_choices)='array'),
 actor_user_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 schema_version integer NOT NULL DEFAULT 1,
 FOREIGN KEY(operation_key,project_id) REFERENCES public.billing_operations(operation_key,project_id) ON DELETE RESTRICT
);
ALTER TABLE public.project_management_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_management_events FROM PUBLIC;
CREATE TRIGGER management_events_immutable BEFORE UPDATE OR DELETE ON public.project_management_events FOR EACH ROW EXECUTE FUNCTION public.reject_audit_row_mutation();
CREATE TRIGGER management_events_no_truncate BEFORE TRUNCATE ON public.project_management_events FOR EACH STATEMENT EXECUTE FUNCTION public.reject_audit_row_mutation();
CREATE FUNCTION public.management_active_on(p_project bigint,p_scope text,p_date date) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT action='resume' FROM public.project_management_events
   WHERE project_id=p_project AND scope=p_scope AND (effective_date<p_date OR (effective_date=p_date AND action='resume'))
   ORDER BY effective_date DESC,id DESC LIMIT 1),true)
$$;
REVOKE ALL ON FUNCTION public.management_active_on(bigint,text,date) FROM PUBLIC;

CREATE FUNCTION public.write_management_lifecycle(p_key uuid,p_project bigint,p_expected_last bigint,
 p_scope text,p_action text,p_date date,p_choices jsonb,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); fingerprint text; op public.billing_operations%ROWTYPE;
 prior public.project_management_events%ROWTYPE; c jsonb; expected jsonb; actual jsonb;
 old_unit public.billing_units%ROWTYPE; new_unit public.billing_units%ROWTYPE;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'ログインが必要です'; END IF;
 IF p_key IS NULL OR p_project IS NULL OR p_expected_last IS NULL OR p_expected_last<0 OR p_scope IS NULL OR p_scope NOT IN('maintenance','all')
  OR p_action IS NULL OR p_action NOT IN('end','resume') OR p_date IS NULL OR p_date NOT BETWEEN '2000-01-01'::date AND '2200-12-31'::date
  OR jsonb_typeof(p_choices) IS DISTINCT FROM 'array' OR p_reason IS NULL OR length(trim(p_reason))=0 THEN RAISE EXCEPTION '終了・再開の入力を確認してください'; END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','management','project',p_project,'last',p_expected_last,
  'scope',p_scope,'operation',p_action,'date',p_date,'choices',p_choices,'reason',p_reason,'actor',actor)::text,'UTF8')),'hex');
 INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
  VALUES(p_key,'plan',p_project,fingerprint,actor) ON CONFLICT DO NOTHING;
 SELECT * INTO STRICT op FROM public.billing_operations WHERE operation_key=p_key FOR UPDATE;
 IF op.request_hash IS DISTINCT FROM fingerprint OR op.actor_user_id IS DISTINCT FROM actor THEN RAISE EXCEPTION '同じ操作IDで別の内容は保存できません'; END IF;
 IF op.completed_at IS NOT NULL THEN RETURN jsonb_build_object('completed',true); END IF;
 PERFORM id FROM public.projects WHERE id=p_project FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '発電所がありません'; END IF;
 PERFORM id FROM public.billing_recipient_plans WHERE project_id=p_project ORDER BY id FOR UPDATE;
 IF coalesce((SELECT max(id) FROM public.project_management_events WHERE project_id=p_project),0)<>p_expected_last THEN RAISE EXCEPTION '終了・再開履歴が更新されています'; END IF;
 SELECT * INTO prior FROM public.project_management_events WHERE project_id=p_project AND scope=p_scope ORDER BY effective_date DESC,id DESC LIMIT 1;
 IF (prior.id IS NULL AND p_action='resume') OR prior.action=p_action THEN RAISE EXCEPTION '現在の終了・再開状態を確認してください'; END IF;
 IF prior.id IS NOT NULL AND p_date<=prior.effective_date THEN RAISE EXCEPTION '前回の終了・再開より後の日付を指定してください'; END IF;
 IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=p_project AND source_annual_record_id IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM public.billing_migration_acceptances WHERE project_id=p_project) THEN RAISE EXCEPTION '移行確認が必要です'; END IF;
 PERFORM id FROM public.billing_units WHERE project_id=p_project ORDER BY id FOR UPDATE;
 FOR c IN SELECT value FROM jsonb_array_elements(p_choices) LOOP
  IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR NOT(c ?& ARRAY['unitId','expectedRevision','action','amount']) OR (SELECT count(*) FROM jsonb_object_keys(c))<>4
   OR jsonb_typeof(c->'unitId') IS DISTINCT FROM 'string' OR c->>'unitId' !~ '^[1-9][0-9]*$'
   OR jsonb_typeof(c->'expectedRevision') IS DISTINCT FROM 'number' OR c->>'expectedRevision' !~ '^[0-9]+$'
   OR jsonb_typeof(c->'action') IS DISTINCT FROM 'string' OR c->>'action' NOT IN('keep','amount','cancel') THEN RAISE EXCEPTION '各回の確認内容が不正です'; END IF;
  IF c->>'action'='amount' THEN
   IF jsonb_typeof(c->'amount') IS DISTINCT FROM 'number' OR c->>'amount' !~ '^[0-9]+$' OR (c->>'amount')::numeric>9007199254740991 THEN RAISE EXCEPTION '変更後の予定額を入力してください'; END IF;
  ELSIF c->'amount' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION '金額変更以外では金額を指定しません'; END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'unitId') FROM jsonb_array_elements(p_choices))<>jsonb_array_length(p_choices) THEN RAISE EXCEPTION '請求回が重複しています'; END IF;
 SELECT coalesce(jsonb_object_agg(value->>'unitId',value->'expectedRevision'),'{}') INTO expected FROM jsonb_array_elements(p_choices);
 SELECT coalesce(jsonb_object_agg(id::text,revision),'{}') INTO actual FROM public.billing_units WHERE project_id=p_project AND lifecycle='planned';
 IF expected IS DISTINCT FROM actual THEN RAISE EXCEPTION '予定の全件・版を確認し直してください'; END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_choices) LOOP
  SELECT * INTO STRICT old_unit FROM public.billing_units WHERE project_id=p_project AND id=(c->>'unitId')::bigint;
  IF c->>'action'='keep' THEN CONTINUE; END IF;
  IF old_unit.collection_state<>'pending' OR old_unit.issued_on IS NOT NULL OR old_unit.received_on IS NOT NULL OR old_unit.frozen_at IS NOT NULL THEN RAISE EXCEPTION '実績・振替不能の回はここで変更できません'; END IF;
  IF c->>'action'='cancel' THEN
   UPDATE public.billing_units SET lifecycle='cancelled',collection_state='not_applicable',revision=revision+1 WHERE id=old_unit.id RETURNING * INTO new_unit;
  ELSE
   UPDATE public.billing_units SET planned_amount=(c->>'amount')::bigint,revision=revision+1 WHERE id=old_unit.id RETURNING * INTO new_unit;
  END IF;
  INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,before_value,after_value,actor_user_id,reason)
   VALUES(p_project,old_unit.id,p_key,CASE WHEN c->>'action'='cancel' THEN 'cancelled' ELSE 'plan_changed' END,to_jsonb(old_unit),to_jsonb(new_unit),actor,p_reason);
 END LOOP;
 UPDATE public.billing_recipient_plans SET revision=revision+1 WHERE project_id=p_project AND retired_at IS NULL;
 INSERT INTO public.project_management_events(project_id,operation_key,scope,action,effective_date,reason,confirmed_choices,actor_user_id)
  VALUES(p_project,p_key,p_scope,p_action,p_date,p_reason,p_choices,actor);
 UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=p_key;
 RETURN jsonb_build_object('completed',true);
END $$;
REVOKE ALL ON FUNCTION public.write_management_lifecycle(uuid,bigint,bigint,text,text,date,jsonb,text) FROM PUBLIC;
DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON public.project_management_events FROM %I',r); END IF;
END LOOP; END $$;
