-- Generated with Supabase CLI. Additive Todo-only deadline; existing clients keep their writer.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS(
  SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN
  RAISE EXCEPTION 'Wrong project: Todo deadlines are for the new application only';
 END IF;
END $$;
-- No default or backfill: all existing tasks stay undated and otherwise untouched.
ALTER TABLE public.project_todos
 ADD COLUMN due_date date CHECK(due_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'),
 ADD COLUMN creation_due_date date CHECK(creation_due_date BETWEEN DATE '0001-01-01' AND DATE '9999-12-31');
COMMENT ON COLUMN public.project_todos.due_date IS '任意のタスク期日。請求・保守の日付には使用しない。';
COMMENT ON COLUMN public.project_todos.creation_due_date IS '追加の再送確認用。当初の期日を保持し、編集不可。';
CREATE OR REPLACE FUNCTION public.guard_project_todo() RETURNS trigger
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
  NEW.creation_due_date:=NEW.due_date;NEW.creation_hash:=md5(NEW.content);NEW.created_at:=clock_timestamp();NEW.revision:=1;NEW.completed_at:=NULL;
 ELSE
  IF (NEW.id,NEW.project_id,NEW.created_by,NEW.creation_hash,NEW.created_at,NEW.creation_due_date) IS DISTINCT FROM
     (OLD.id,OLD.project_id,OLD.created_by,OLD.creation_hash,OLD.created_at,OLD.creation_due_date) THEN
   RAISE EXCEPTION 'Todoの発電所・作成者は変更できません';
  END IF;
  NEW.revision:=OLD.revision+1;
  NEW.completed_at:=CASE WHEN NOT NEW.is_completed THEN NULL WHEN OLD.is_completed THEN OLD.completed_at ELSE clock_timestamp() END;
 END IF;
 NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;

CREATE FUNCTION public.project_todo_write_with_due_date(p_id uuid,p_project bigint,p_revision integer,p_content text,p_completed boolean,p_due_date date) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE item public.project_todos%ROWTYPE;
BEGIN
 IF NOT public.project_todo_access() THEN RAISE EXCEPTION 'ログイン・Todoの利用権限を確認してください' USING ERRCODE='42501'; END IF;
 IF p_id IS NULL OR p_project IS NULL OR p_content IS NULL OR length(trim(p_content)) NOT BETWEEN 1 AND 2000
  OR p_completed IS NULL OR (p_revision IS NOT NULL AND p_revision<1) THEN RAISE EXCEPTION 'Todoは1〜2000文字で入力してください'; END IF;
 IF p_revision IS NULL THEN
  IF p_completed THEN RAISE EXCEPTION '新しいTodoは未完了で追加してください'; END IF;
  INSERT INTO public.project_todos(id,project_id,content,creation_hash,due_date)
   VALUES(p_id,p_project,trim(p_content),'',p_due_date) ON CONFLICT(id) DO NOTHING;
 END IF;
 SELECT * INTO item FROM public.project_todos WHERE id=p_id AND project_id=p_project FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Todoが見つかりません。読み込み直してください'; END IF;
 IF p_revision IS NULL THEN
  IF item.creation_hash<>md5(trim(p_content)) OR item.creation_due_date IS DISTINCT FROM p_due_date THEN RAISE EXCEPTION '同じ操作で別のTodoは追加できません'; END IF;
  RETURN to_jsonb(item); -- retry never overwrites later edits/completion
 END IF;
 IF item.content=trim(p_content) AND item.is_completed=p_completed AND item.due_date IS NOT DISTINCT FROM p_due_date THEN RETURN to_jsonb(item); END IF;
 IF item.revision<>p_revision THEN RAISE EXCEPTION 'Todoが更新されています。読み込み直して確認してください' USING ERRCODE='40001'; END IF;
 UPDATE public.project_todos SET content=trim(p_content),is_completed=p_completed,due_date=p_due_date WHERE id=p_id RETURNING * INTO item;
 RETURN to_jsonb(item);
END $$;
REVOKE ALL ON FUNCTION public.project_todo_write_with_due_date(uuid,bigint,integer,text,boolean,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.project_todo_write_with_due_date(uuid,bigint,integer,text,boolean,date) TO authenticated;


NOTIFY pgrst,'reload schema';
COMMIT;
