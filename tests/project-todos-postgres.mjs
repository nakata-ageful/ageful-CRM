// Isolated synthetic PostgreSQL only; never reads credentials or connects remotely.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),actor='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222'
const sql=readFileSync(new URL('../database/migrations/20261017054504_project_todos.sql',import.meta.url),'utf8')
const id=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`
const rows=async t=>(await db.query(`select to_jsonb(x) v from ${t} x order by to_jsonb(x)::text`)).rows.map(r=>r.v)
const legacy=['customers','projects','contracts','annual_records','maintenance_responses','periodic_maintenance','prospects','billing_units']
const snapshot=async()=>Object.fromEntries(await Promise.all(legacy.map(async t=>[t,await rows(t)])))
const asUser=fn=>db.transaction(async tx=>{await tx.exec('set local role authenticated');return fn(tx)})
const write=(key,project,revision,content,completed=false)=>asUser(async tx=>(await tx.query('select public.project_todo_write($1,$2,$3,$4,$5) value',[key,project,revision,content,completed])).rows[0].value)
try{
 await db.exec(`create role authenticated;create role anon;create schema auth;grant usage on schema public,auth to authenticated,anon;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 set test.actor='${actor}';`)
 await db.exec(readFileSync(new URL('../database/schema.sql',import.meta.url),'utf8'))
 await db.exec(`alter table projects add column archived_at timestamptz;
 create table billing_runtime_control(owner_user_id uuid,enabled boolean);insert into billing_runtime_control values('${actor}',true);
 create table ageful_migration_target(project_ref text);insert into ageful_migration_target values('wrong');
 create table billing_units(id bigint primary key,project_id bigint,amount integer);
 insert into customers(id,name) values(1,'合成顧客');insert into projects(id,customer_id,project_name) values(1,1,'合成発電所A'),(2,1,'合成発電所B');update projects set archived_at=now() where id=2;
 insert into contracts(id,project_id) values(1,1);insert into billing_units values(1,1,82500);
 insert into maintenance_responses(project_id,response_content,status) values(1,'既存の保守対応','対応中');
 create function assert_billing_runtime_access() returns void language plpgsql security definer set search_path='' as $$begin if auth.uid() is null or not exists(select 1 from public.billing_runtime_control where owner_user_id=auth.uid() and enabled) then raise exception 'not authorized' using errcode='42501';end if;end$$;
 create function billing_runtime_backup() returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('version',2,'billing_units',(select jsonb_agg(to_jsonb(b)) from public.billing_units b))$$;
 grant select,update on projects to authenticated;grant execute on function billing_runtime_backup() to authenticated;`)
 const before=await snapshot(),backupBefore=(await db.query('select billing_runtime_backup() v')).rows[0].v
 await assert.rejects(db.exec(sql),/Wrong project/);await db.exec('rollback');assert.equal((await db.query("select to_regclass('project_todos') v")).rows[0].v,null)
 await db.exec("update ageful_migration_target set project_ref='ufawaiddntqqbjhycbxn'");await db.exec(sql)
 assert.deepEqual(await snapshot(),before,'Migration must not change any existing business row')
 const first=await write(id(1),1,null,'  契約書を送る  ');assert.equal(first.content,'契約書を送る');assert.equal(first.revision,1);assert.equal(first.is_completed,false)
 await write(id(1),1,null,'契約書を送る');assert.equal((await rows('project_todos')).length,1,'Create retry does not duplicate')
 await assert.rejects(write(id(1),1,null,'別の内容'),/別のTodo/)
 const done=await write(id(1),1,1,'契約書を送る',true);assert.equal(done.revision,2);assert.ok(done.completed_at)
 const retried=await write(id(1),1,null,'契約書を送る');assert.deepEqual(retried,done,'Late create retry never undoes completion')
 assert.deepEqual(await write(id(1),1,1,'契約書を送る',true),done,'Repeated completion is a no-op')
 await assert.rejects(write(id(1),1,1,'古い画面から上書き',false),/更新されています/)
 const opened=await write(id(1),1,2,'書類を確認して送る',false);assert.equal(opened.revision,3);assert.equal(opened.completed_at,null)
 await assert.rejects(write(id(1),2,3,'別発電所への移動',false),/見つかりません/)
 await assert.rejects(write(id(2),1,null,''),/2000文字/);await assert.rejects(write(id(2),1,null,'x'.repeat(2001)),/2000文字/)
 await assert.rejects(write(id(2),1,null,'完了で作成',true),/未完了/)
 await assert.rejects(asUser(tx=>tx.query("update project_todos set created_by=$1 where id=$2",[other,id(1)])),/利用権限|変更できません/)
 await assert.rejects(write(id(2),2,null,'保管中へ追加'),/保管中/)
 const todoRows=await rows('project_todos');await db.exec(`set test.actor='${other}'`)
 assert.equal((await asUser(tx=>tx.query('select * from project_todos'))).rows.length,0,'Another authenticated user sees no Todo')
 await assert.rejects(write(id(3),1,null,'権限なし'),/利用権限/)
 await db.exec(`set test.actor='${actor}'`)
 await assert.rejects(asUser(tx=>tx.query('delete from project_todos')),/permission denied/)
 await assert.rejects(asUser(tx=>tx.query('select billing_runtime_backup_before_todos()')),/permission denied/)
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select * from project_todos')}),/permission denied/)
 const backup=(await asUser(tx=>tx.query('select billing_runtime_backup() v'))).rows[0].v
 assert.equal(backup.project_todos_ready,true);assert.equal(backup.project_todos.length,1)
 const {project_todos_ready,project_todos,...original}=backup;assert.deepEqual(original,backupBefore,'Original backup fields are unchanged')
 assert.deepEqual(await snapshot(),before,'Todo writes leave all billing, maintenance, owners, contracts and prospects unchanged')
 assert.deepEqual(await rows('project_todos'),todoRows)
 const policies=(await db.query("select count(*)::int n from pg_policies where tablename='project_todos'")).rows[0].n;assert.equal(policies,3)
 console.log('PASS: Todo migration target, RLS/operator isolation, scoped writes, CAS, idempotent creation/completion, edit/reopen, archived/invalid/delete rejection, same-snapshot backup and unchanged original billing/maintenance/contract/owner/prospect rows')
}catch(e){console.error('FAIL:',e.message,e.detail??'');process.exitCode=1}finally{await db.close()}
