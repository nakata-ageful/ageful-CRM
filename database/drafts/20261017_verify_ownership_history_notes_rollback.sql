-- NEW DB ONLY. Hosted PostgreSQL/Auth smoke; NOT a browser/HTTP test.
-- Uses an existing active history target when available. Never changes the
-- original event. All temporary note revisions are rolled back at the end.
-- Execute the whole script, including ROLLBACK, in one SQL-editor request.
BEGIN;
SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS
 (SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn') THEN RAISE EXCEPTION 'Wrong project';END IF;
 PERFORM set_config('request.jwt.claims',(SELECT jsonb_build_object('sub',owner_user_id,'role','authenticated')::text
  FROM public.billing_runtime_control WHERE enabled),true);
END $$;
SET LOCAL request.headers='{"x-ageful-client":"ledger-v1"}';
SET LOCAL ROLE authenticated;
DO $$ DECLARE before_value jsonb;after_value jsonb;snapshot_value jsonb;source_kind text;target text;pid bigint;
 expected integer;k uuid;request jsonb;receipt jsonb;saved jsonb;rejected boolean;tested integer:=0;
BEGIN
 before_value:=public.billing_runtime_backup();snapshot_value:=public.billing_runtime_snapshot();
 IF snapshot_value->'history_notes_ready' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'History-note migration is not ready';END IF;
 FOREACH source_kind IN ARRAY ARRAY['ownership','workflow'] LOOP
  target:=NULL;pid:=NULL;
  SELECT h.target_id,h.project_id INTO target,pid FROM (
   SELECT e->>'id' target_id,(e->>'project_id')::bigint project_id
    FROM jsonb_array_elements(snapshot_value->'transfers') e WHERE source_kind='ownership'
   UNION ALL
   SELECT e->>'operation_key',(e->>'project_id')::bigint
    FROM jsonb_array_elements(snapshot_value->'ownership_workflow_events') e WHERE source_kind='workflow'
  ) h JOIN public.projects p ON p.id=h.project_id WHERE p.archived_at IS NULL ORDER BY h.project_id,h.target_id LIMIT 1;
  IF target IS NULL THEN RAISE NOTICE 'SKIP: no active % history target',source_kind;CONTINUE;END IF;
  SELECT coalesce(max((n->>'revision')::integer),0) INTO expected FROM jsonb_array_elements(snapshot_value->'history_notes') n
   WHERE n->>'kind'=source_kind AND n->>'target_id'=target;
  k:=gen_random_uuid();request:=jsonb_build_object('action','history_note','value',jsonb_build_object('projectId',pid,
   'kind',source_kind,'targetId',target,'expectedRevision',expected,'text','検証専用・保存しない説明文 '||k::text));
  receipt:=public.billing_runtime_write(k,request);
  IF (receipt->>'revision')::integer<>expected+1 OR public.billing_runtime_write(k,request) IS DISTINCT FROM receipt THEN RAISE EXCEPTION 'Note/replay mismatch';END IF;
  saved:=public.billing_runtime_snapshot();rejected:=false;
  BEGIN
   PERFORM public.billing_runtime_write(gen_random_uuid(),request);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN rejected:=true;END;
  IF NOT rejected OR public.billing_runtime_snapshot() IS DISTINCT FROM saved THEN RAISE EXCEPTION 'Stale note was not atomically rejected';END IF;
  after_value:=public.billing_runtime_backup();
  IF after_value-'history_notes' IS DISTINCT FROM before_value-'history_notes' THEN RAISE EXCEPTION 'An original business/audit row changed';END IF;
  tested:=tested+1;
 END LOOP;
 RAISE NOTICE 'PASS: % target kinds checked; authenticated note/replay/stale rejection and unchanged raw originals. All test notes roll back next.',tested;
END $$;
SELECT 'Rollback-only history-note smoke completed. See NOTICE for tested/skipped target counts; no note is committed.' AS validation;
ROLLBACK;
