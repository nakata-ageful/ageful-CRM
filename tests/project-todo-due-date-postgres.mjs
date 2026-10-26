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

 const legacy=await write(id(1),1,null,'既存タスク');
 const beforeTasks=await rows('project_todos');
 const dueSql=readFileSync(new URL('../database/migrations/20261026022652_project_todo_due_date.sql',import.meta.url),'utf8');
 await db.exec("update ageful_migration_target set project_ref='wrong'");await assert.rejects(db.exec(dueSql),/Wrong project/);await db.exec('rollback');
 await db.exec("update ageful_migration_target set project_ref='ufawaiddntqqbjhycbxn'");await db.exec(dueSql);
 const afterTasks=(await rows('project_todos')).map(({due_date,creation_due_date,...t})=>{assert.equal(due_date,null);assert.equal(creation_due_date,null);return t});assert.deepEqual(afterTasks,beforeTasks,'Existing task content, completion, timestamps and revisions remain identical');
 const dueWrite=(key,revision,content,due,completed=false)=>asUser(async tx=>(await tx.query('select project_todo_write_with_due_date($1,1,$2,$3,$4,$5) v',[key,revision,content,completed,due])).rows[0].v);
 let t=await dueWrite(id(1),1,legacy.content,'2026-11-03');assert.equal(t.due_date,'2026-11-03');assert.equal(t.revision,2);
 await assert.rejects(dueWrite(id(1),1,'競合する変更','2026-10-30'),/更新されています/);
 t=await dueWrite(id(1),2,legacy.content,'2026-11-03');assert.equal(t.revision,2,'Same-payload retry is a no-op');
 t=await write(id(1),1,2,'古い画面から文章変更');assert.equal(t.due_date,'2026-11-03','Old writer preserves due date');
 t=await dueWrite(id(1),3,t.content,'2026-11-03',true);const completedOn=t.completed_at;assert.equal(t.is_completed,true);
 t=await dueWrite(id(1),4,t.content,null,true);assert.equal(t.due_date,null);assert.equal(t.completed_at,completedOn,'Deadline-only edits preserve completion timestamp');
 t=await dueWrite(id(1),5,t.content,'2026-11-01',false);assert.equal(t.completed_at,null);assert.equal(t.due_date,'2026-11-01');
 const created=await dueWrite(id(2),null,'追加の再送','2026-12-01');await dueWrite(id(2),1,'追加の再送を編集','2026-10-30');
 assert.equal((await dueWrite(id(2),null,'追加の再送','2026-12-01')).due_date,'2026-10-30','Creation retry never reverts later edits');
 await assert.rejects(dueWrite(id(2),null,'追加の再送','2026-12-02'),/別のTodo/);
 await assert.rejects(dueWrite(id(4),null,'不正日付','2026-02-30'),/range|date/);
 await assert.rejects(dueWrite(id(4),null,'無限日付','infinity'),/check|constraint/);
 await assert.rejects(asUser(tx=>tx.query("update project_todos set creation_due_date='2026-12-31' where id=$1",[id(2)])),/変更できません/);
 await db.exec(`set test.actor='${other}'`);await assert.rejects(dueWrite(id(3),null,'別の利用者','2026-11-01'),/利用権限/);await db.exec(`set test.actor='${actor}'`);
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select project_todo_write_with_due_date($1,1,null,$2,false,null)',[id(4),'未ログイン'])}),/permission denied/);
 const backup=(await asUser(tx=>tx.query('select billing_runtime_backup() v'))).rows[0].v;assert.equal(backup.project_todos.find(t=>t.id===id(1)).due_date,'2026-11-01');
 assert.deepEqual(await snapshot(),before,'Deadline migration/writes never mutate billing, maintenance, customer, owner, prospect or contract data');
 console.log('PASS: additive deadline migration preserves existing rows, CAS and retry safety, due set/edit/clear, completion dates, old-client preservation, invalid-date rejection, unchanged operator/RLS isolation and backup coverage');
}catch(e){console.error('FAIL:',e.message,e.detail??'');process.exitCode=1}finally{await db.close()}
