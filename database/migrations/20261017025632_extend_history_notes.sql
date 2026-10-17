BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS
 (SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN RAISE EXCEPTION 'Wrong project';END IF;
END $$;
ALTER TABLE public.ownership_history_notes DROP CONSTRAINT ownership_history_notes_kind_check;
ALTER TABLE public.ownership_history_notes ADD CONSTRAINT ownership_history_notes_kind_check CHECK(kind IN('ownership','workflow','billing','management'));

CREATE OR REPLACE FUNCTION public.write_ownership_history_note(p_key uuid,v jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p bigint;k text;target text;expected integer;body text;fingerprint text;original text;old_text text;
 project_value public.projects%ROWTYPE;prior public.ownership_history_notes%ROWTYPE;latest public.ownership_history_notes%ROWTYPE;
 next_revision integer;
BEGIN
 PERFORM public.assert_billing_runtime_access();
 IF p_key IS NULL OR jsonb_typeof(v) IS DISTINCT FROM 'object' OR
 (SELECT count(*) FROM jsonb_object_keys(v))<>5 OR NOT(v ?& ARRAY['projectId','kind','targetId','expectedRevision','text']) OR
 jsonb_typeof(v->'projectId') IS DISTINCT FROM 'number' OR v->>'projectId' !~ '^[1-9][0-9]*$' OR
 jsonb_typeof(v->'kind') IS DISTINCT FROM 'string' OR v->>'kind' NOT IN('ownership','workflow','billing','management') OR
 jsonb_typeof(v->'targetId') IS DISTINCT FROM 'string' OR
 jsonb_typeof(v->'expectedRevision') IS DISTINCT FROM 'number' OR v->>'expectedRevision' !~ '^[0-9]+$' OR
 jsonb_typeof(v->'text') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'メモの保存内容を確認してください';END IF;
 IF (v->>'projectId')::numeric>9007199254740991 OR (v->>'expectedRevision')::numeric>2147483646 THEN
 RAISE EXCEPTION 'メモの対象・更新回数を確認してください';END IF;
 p:=(v->>'projectId')::bigint;k:=v->>'kind';target:=v->>'targetId';expected:=(v->>'expectedRevision')::integer;
 body:=btrim(v->>'text',E' \t\n\r'||chr(11)||chr(12)||'　');
 IF length(body)=0 OR length(body)>4000 THEN RAISE EXCEPTION 'メモを1～4000文字で入力してください';END IF;
 IF k<>'workflow' THEN
  IF target !~ '^[1-9][0-9]*$' OR length(target)>16 OR target::numeric>9007199254740991 THEN
   RAISE EXCEPTION '所有者変更の履歴を確認してください';END IF;
 ELSE
  IF target !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
   RAISE EXCEPTION '引継ぎ手続きの履歴を確認してください';END IF;
  target:=target::uuid::text;
 END IF;
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('action','history_note','value',v,'actor',auth.uid())::text,'UTF8')),'hex');
 -- Same-key requests are serialized even if a caller supplies another project.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_key::text,0));
 IF EXISTS(SELECT 1 FROM public.billing_operations WHERE operation_key=p_key) OR
  EXISTS(SELECT 1 FROM public.ownership_workflow_events WHERE operation_key=p_key) THEN
  RAISE EXCEPTION 'この保存操作は別の処理に使われています。画面を開き直してください';END IF;
 SELECT * INTO project_value FROM public.projects WHERE id=p FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '発電所が見つかりません。画面を開き直してください';END IF;
 SELECT * INTO prior FROM public.ownership_history_notes WHERE operation_key=p_key;
 IF FOUND THEN
  IF prior.request_hash IS DISTINCT FROM fingerprint OR prior.actor_user_id IS DISTINCT FROM auth.uid() THEN
   RAISE EXCEPTION '同じ保存操作で別の内容は保存できません';END IF;
  RETURN jsonb_build_object('completed',true,'operation_key',p_key,'revision',prior.revision);
 END IF;
 IF project_value.archived_at IS NOT NULL THEN RAISE EXCEPTION '保管済みの発電所のメモは変更できません';END IF;
 IF k='ownership' THEN
  SELECT coalesce(field_decisions->>'reason','') INTO original FROM public.ownership_transfers WHERE id=target::bigint AND project_id=p;
 ELSIF k='billing' THEN
  SELECT coalesce(reason,'') INTO original FROM public.billing_unit_events WHERE id=target::bigint AND project_id=p;
 ELSIF k='management' THEN
  SELECT coalesce(reason,'') INTO original FROM public.project_management_events WHERE id=target::bigint AND project_id=p;
 ELSE
  SELECT reason INTO original FROM public.ownership_workflow_events WHERE operation_key=target::uuid AND project_id=p;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'この発電所の履歴が見つかりません。画面を開き直してください';END IF;
 SELECT * INTO latest FROM public.ownership_history_notes WHERE kind=k AND target_id=target ORDER BY revision DESC LIMIT 1;
 next_revision:=coalesce(latest.revision,0)+1;
 IF expected<>next_revision-1 THEN RAISE EXCEPTION 'メモが更新されています。画面を開き直して確認してください';END IF;
 old_text:=CASE WHEN latest.operation_key IS NULL THEN original ELSE latest.text END;
 IF body=old_text THEN RAISE EXCEPTION 'メモの内容は変更されていません';END IF;
 INSERT INTO public.ownership_history_notes(operation_key,project_id,kind,target_id,revision,original_text,previous_text,text,request_hash,actor_user_id)
 VALUES(p_key,p,k,target,next_revision,original,old_text,body,fingerprint,auth.uid());
 RETURN jsonb_build_object('completed',true,'operation_key',p_key,'revision',next_revision);
END $$;
REVOKE ALL ON FUNCTION public.write_ownership_history_note(uuid,jsonb) FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
