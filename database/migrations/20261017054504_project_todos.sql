-- Generated with Supabase CLI. NEW application only; no existing business rows change.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS(
  SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN
  RAISE EXCEPTION 'Wrong project: Todo is for the new application only';
 END IF;
END $$;

-- Reuse the application's operator identity, without coupling Todo to billing calculations.
CREATE FUNCTION public.project_todo_access() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.billing_runtime_control WHERE owner_user_id=auth.uid() AND enabled)
$$;
REVOKE ALL ON FUNCTION public.project_todo_access() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_todo_access() TO authenticated;

CREATE TABLE public.project_todos (
 id uuid PRIMARY KEY,
 project_id bigint NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
 created_by uuid NOT NULL DEFAULT auth.uid(),
 content text NOT NULL CHECK(length(trim(content)) BETWEEN 1 AND 2000),
 is_completed boolean NOT NULL DEFAULT false,
 completed_at timestamptz,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 creation_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(is_completed=(completed_at IS NOT NULL))
);
CREATE INDEX project_todos_project_operator_idx ON public.project_todos(project_id,created_by,is_completed,created_at,id);
ALTER TABLE public.project_todos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_todos FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.project_todos TO authenticated;
CREATE POLICY project_todos_read ON public.project_todos FOR SELECT TO authenticated
 USING(created_by=(SELECT auth.uid()) AND (SELECT public.project_todo_access()));
CREATE POLICY project_todos_insert ON public.project_todos FOR INSERT TO authenticated
 WITH CHECK(created_by=(SELECT auth.uid()) AND (SELECT public.project_todo_access()));
CREATE POLICY project_todos_update ON public.project_todos FOR UPDATE TO authenticated
 USING(created_by=(SELECT auth.uid()) AND (SELECT public.project_todo_access()))
 WITH CHECK(created_by=(SELECT auth.uid()) AND (SELECT public.project_todo_access()));

CREATE FUNCTION public.guard_project_todo() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE archived timestamptz;
BEGIN
 IF NOT public.project_todo_access() OR NEW.created_by IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'ログイン・Todoの利用権限を確認してください' USING ERRCODE='42501';
 END IF;
 SELECT archived_at INTO archived FROM public.projects WHERE id=NEW.project_id FOR SHARE;
 IF NOT FOUND OR archived IS NOT NULL THEN RAISE EXCEPTION '発電所が見つからないか、保管中のため変更できません'; END IF;
 NEW.content:=trim(NEW.content);
 IF TG_OP='INSERT' THEN
  IF NEW.is_completed THEN RAISE EXCEPTION '新しいTodoは未完了で追加してください'; END IF;
  NEW.creation_hash:=md5(NEW.content);NEW.created_at:=clock_timestamp();NEW.revision:=1;NEW.completed_at:=NULL;
 ELSE
  IF (NEW.id,NEW.project_id,NEW.created_by,NEW.creation_hash,NEW.created_at) IS DISTINCT FROM
     (OLD.id,OLD.project_id,OLD.created_by,OLD.creation_hash,OLD.created_at) THEN
   RAISE EXCEPTION 'Todoの発電所・作成者は変更できません';
  END IF;
  NEW.revision:=OLD.revision+1;
  NEW.completed_at:=CASE WHEN NOT NEW.is_completed THEN NULL WHEN OLD.is_completed THEN OLD.completed_at ELSE clock_timestamp() END;
 END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_project_todo() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER project_todo_guard BEFORE INSERT OR UPDATE ON public.project_todos
 FOR EACH ROW EXECUTE FUNCTION public.guard_project_todo();

-- Invoker respects RLS; the caller gets no privileges on any financial/maintenance table.
CREATE FUNCTION public.project_todo_write(p_id uuid,p_project bigint,p_revision integer,p_content text,p_completed boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item public.project_todos%ROWTYPE;
BEGIN
 IF NOT public.project_todo_access() THEN RAISE EXCEPTION 'ログイン・Todoの利用権限を確認してください' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_project IS NULL OR p_content IS NULL OR length(trim(p_content)) NOT BETWEEN 1 AND 2000
  OR p_completed IS NULL OR (p_revision IS NOT NULL AND p_revision<1) THEN RAISE EXCEPTION 'Todoは1〜2000文字で入力してください'; END IF;
 IF p_revision IS NULL THEN
  IF p_completed THEN RAISE EXCEPTION '新しいTodoは未完了で追加してください'; END IF;
  INSERT INTO public.project_todos(id,project_id,content,creation_hash)
   VALUES(p_id,p_project,trim(p_content),'') ON CONFLICT(id) DO NOTHING;
 END IF;
 SELECT * INTO item FROM public.project_todos WHERE id=p_id AND project_id=p_project FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Todoが見つかりません。読み込み直してください'; END IF;
 IF p_revision IS NULL THEN
  IF item.creation_hash<>md5(trim(p_content)) THEN RAISE EXCEPTION '同じ操作で別のTodoは追加できません'; END IF;
  RETURN to_jsonb(item); -- retry never overwrites later edits/completion
 END IF;
 IF item.content=trim(p_content) AND item.is_completed=p_completed THEN RETURN to_jsonb(item); END IF;
 IF item.revision<>p_revision THEN RAISE EXCEPTION 'Todoが更新されています。読み込み直して確認してください' USING ERRCODE='40001'; END IF;
 UPDATE public.project_todos SET content=trim(p_content),is_completed=p_completed WHERE id=p_id RETURNING * INTO item;
 RETURN to_jsonb(item);
END $$;
REVOKE ALL ON FUNCTION public.project_todo_write(uuid,bigint,integer,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_todo_write(uuid,bigint,integer,text,boolean) TO authenticated;

-- Add Todo to the existing one-snapshot export. No changes to billing writers or snapshots.
ALTER FUNCTION public.billing_runtime_backup() RENAME TO billing_runtime_backup_before_todos;
REVOKE ALL ON FUNCTION public.billing_runtime_backup_before_todos() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.billing_runtime_backup() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM public.assert_billing_runtime_access();
 RETURN public.billing_runtime_backup_before_todos()||jsonb_build_object('project_todos_ready',true,'project_todos',
  coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY created_at,id) FROM public.project_todos t WHERE created_by=auth.uid()),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.billing_runtime_backup() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.billing_runtime_backup() TO authenticated;
COMMENT ON TABLE public.project_todos IS '発電所ごとの自由なTodo。請求・保守対応とは独立。削除せず完了／未完了を管理する。';
NOTIFY pgrst,'reload schema';
COMMIT;
