import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
const owner='11111111-1111-4111-8111-111111111111';
let sequence=0;const key=()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12,'0')}`;
const tables=['customers','projects','contracts','billing_operations','billing_migration_acceptances'];
const snapshot=async()=>{const s={};for(const t of tables)s[t]=(await db.query(`select to_jsonb(t) v from ${t} t order by to_jsonb(t)::text`)).rows.map(r=>r.v);return s};
const create=(id,p={project_name:'架空発電所',plant_name:'架空発電所',notes:'備考'},customer=1)=>db.query('select create_project_with_contract($1,$2,$3::jsonb) v',[id,customer,JSON.stringify(p)]);
try{
 await db.exec(`create role anon;create role authenticated;create schema auth;
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
  create table ageful_migration_target(project_ref text);insert into ageful_migration_target values('ufawaiddntqqbjhycbxn');
  create table billing_runtime_control(owner_user_id uuid,enabled boolean);insert into billing_runtime_control values('${owner}',true);
  create function assert_billing_runtime_access() returns void language plpgsql as $$begin
    if not exists(select 1 from billing_runtime_control where enabled and owner_user_id=auth.uid()) then raise exception '利用権限がありません' using errcode='42501';end if;end$$;
  create table customers(id bigint primary key,name text);insert into customers values(1,'架空顧客');
  create table projects(id bigint generated always as identity primary key,customer_id bigint not null references customers(id),project_name text not null,plant_name text,notes text);
  create table contracts(id bigint generated always as identity primary key,project_id bigint not null references projects(id));
  create table billing_operations(operation_key uuid primary key,operation_kind text not null check(operation_kind in ('plan','issue','collection','correction','cancel','ownership_transfer')),
    project_id bigint not null references projects(id),request_hash text not null,actor_user_id uuid,completed_at timestamptz);
  create table billing_migration_acceptances(project_id bigint primary key references projects(id));
  create function test_accept_project() returns trigger language plpgsql as $$begin insert into billing_migration_acceptances values(new.id);return new;end$$;
  create trigger accept_project after insert on projects for each row execute function test_accept_project();
  set test.actor='${owner}';`);
 const sql=readFileSync(new URL('../database/migrations/20260930_atomic_project_create.sql',import.meta.url),'utf8');
 await db.exec("update ageful_migration_target set project_ref='wrong'");await assert.rejects(db.exec(sql),/Wrong project/);await db.exec('rollback');
 await db.exec("update ageful_migration_target set project_ref='ufawaiddntqqbjhycbxn'");await db.exec(sql);
 const before=await snapshot();
 await assert.rejects(create(key(),{project_name:' '}),/案件名/);await assert.rejects(create(key(),{project_name:'案件',id:999}),/入力項目/);
 await assert.rejects(create(key(),undefined,999),/顧客/);assert.deepEqual(await snapshot(),before);
 await db.exec(`create function test_fail_contract() returns trigger language plpgsql as $$begin raise exception 'synthetic contract failure';end$$;
  create trigger fail_contract before insert on contracts for each row execute function test_fail_contract();`);
 const retryKey=key();await assert.rejects(create(retryKey),/synthetic contract failure/);assert.deepEqual(await snapshot(),before,'project, contract, acceptance and operation roll back');
 await db.exec('drop trigger fail_contract on contracts');
 await db.exec('set role authenticated');const project=(await create(retryKey)).rows[0].v;await db.exec('reset role');
 const after=await snapshot();assert.equal(after.projects.length,1);assert.equal(after.contracts.length,1);assert.equal(after.contracts[0].project_id,project.id);
 assert.equal(after.billing_migration_acceptances.length,1);assert.equal(after.billing_operations[0].operation_kind,'project_create');
 await create(retryKey);assert.deepEqual(await snapshot(),after,'stable retry creates nothing');
 await assert.rejects(create(retryKey,{project_name:'違う案件'}),/別の内容/);assert.deepEqual(await snapshot(),after);
 await db.exec(`set test.actor='22222222-2222-4222-8222-222222222222'`);await assert.rejects(create(key()),/利用権限/);await assert.rejects(create(retryKey),/利用権限/);
 await db.exec("set test.actor='';set role anon");await assert.rejects(create(key()),/permission denied/);await db.exec(`reset role;set test.actor='${owner}'`);
 // Audit failure occurs last, after both parent rows. Everything must still roll back.
 await db.exec(`create function test_fail_creation_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure';end$$;
  create trigger fail_audit before insert on billing_operations for each row execute function test_fail_creation_audit();`);
 await assert.rejects(create(key()),/synthetic audit failure/);assert.deepEqual(await snapshot(),after);
 console.log('PASS: exact project-create SQL, wrong-target guard, atomic parent/contract/acceptance/audit rollback, successful authenticated save, stable retry, changed-request/other-user/anonymous denial.');
}finally{await db.close()}
