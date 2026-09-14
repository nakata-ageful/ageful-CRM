-- Read-only catalog inventory. Does not read customer records, credentials or Auth users.
-- Run in the intended project's SQL editor. This is NOT a migration or a backup.
BEGIN TRANSACTION READ ONLY;
SELECT jsonb_build_object(
  'database',current_database(),
  'server_version',current_setting('server_version'),
  'captured_at',transaction_timestamp(),
  'tables',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.table_name),'[]') FROM (
    SELECT c.relname table_name,c.relkind,c.relrowsecurity rls,c.relforcerowsecurity force_rls,
      pg_get_userbyid(c.relowner) owner,c.relacl::text acl
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S')
  ) t),
  'columns',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.table_name,c.ordinal_position),'[]') FROM (
    SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default,is_identity
    FROM information_schema.columns WHERE table_schema='public'
  ) c),
  'constraints',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.table_name,c.name),'[]') FROM (
    SELECT r.relname table_name,c.conname name,c.contype,pg_get_constraintdef(c.oid) definition
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname='public'
  ) c),
  'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname),'[]')
    FROM pg_policies p WHERE p.schemaname='public'),
  'triggers',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.table_name,t.name),'[]') FROM (
    SELECT c.relname table_name,t.tgname name,t.tgenabled,pg_get_triggerdef(t.oid) definition
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND NOT t.tgisinternal
  ) t),
  'functions',(SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.name,f.arguments),'[]') FROM (
    SELECT p.proname name,pg_get_function_identity_arguments(p.oid) arguments,
      p.prosecdef security_definer,p.proconfig,p.proacl::text acl,
      pg_get_userbyid(p.proowner) owner,md5(pg_get_functiondef(p.oid)) definition_hash
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind IN ('f','p')
  ) f),
  'grants',(SELECT coalesce(jsonb_agg(to_jsonb(g) ORDER BY g.table_name,g.grantee,g.privilege_type),'[]') FROM (
    SELECT table_name,grantee,privilege_type FROM information_schema.table_privileges WHERE table_schema='public'
  ) g)
) AS preflight;
ROLLBACK;
