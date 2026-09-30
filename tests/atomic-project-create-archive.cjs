// Optional offline rehearsal against the existing private migrated DB archive.
// No network; all changes are inside an in-memory copy, never the archive itself.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {tables,ledger}=require('../scripts/prepare-migrated-notes-delta.cjs');
async function main(){
 const archive=process.argv[2];
 if(!archive||!path.resolve(archive).startsWith('/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups/'))throw Error('Private archive required');
 const {PGlite}=await import('@electric-sql/pglite');
 const db=new PGlite({loadDataDir:new Blob([fs.readFileSync(archive)])});
 const owner='9a4b877c-d73d-4c37-a902-40c521240d06';
 const read=async()=>{const result={};for(const t of [...tables,...ledger])result[t]=(await db.query(`select to_jsonb(t) v from public.${t} t order by to_jsonb(t)::text`)).rows.map(r=>r.v);return result;};
 try{
  await db.exec(`create table ageful_migration_target(project_ref text);insert into ageful_migration_target values('ufawaiddntqqbjhycbxn');
   create or replace function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   insert into billing_runtime_control(owner_user_id,enabled,future_schedule_coverage_verified,cutover_on) values('${owner}',true,true,'2026-09-27');
   set request.jwt.claim.sub='${owner}';set request.headers='{"x-ageful-client":"ledger-v1"}';`);
  // The JSON-derived archive omits legacy defaults. Restore only the defaults
  // verified in the new hosted DB on 2026-09-30, inside this offline copy.
  for(const t of ['projects','contracts'])await db.exec(`create sequence test_${t}_id_seq;
   select setval('test_${t}_id_seq',(select max(id)+1 from ${t}),false);
   alter table ${t} alter column id set default nextval('test_${t}_id_seq');
   alter table ${t} alter column created_at set default now();`);
  const before=await read();
  await db.exec(fs.readFileSync(path.join(__dirname,'../database/migrations/20260930_atomic_project_create.sql'),'utf8'));
  assert.deepEqual(await read(),before,'migration must not change the 19 business/audit tables');
  // Exercise all whitelisted columns, with actual types/defaults/guards/triggers.
  const def=(await db.query("select pg_get_functiondef('public.create_project_with_contract(uuid,bigint,jsonb)'::regprocedure) v")).rows[0].v;
  const allowed=[...def.match(/allowed text\[\]:=ARRAY\[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
  const payload=Object.fromEntries(allowed.map(k=>[k,null]));Object.assign(payload,{project_name:'架空・一括保存試験',plant_name:'架空発電所',has_4g:false,panel_kw:49.5,panel_count:120});
  const key='e1234567-1234-4123-8123-123456789012',customer=before.customers[0].id;
  const create=()=>db.query('select create_project_with_contract($1,$2,$3::jsonb) v',[key,customer,JSON.stringify(payload)]);
  await db.exec('begin;set local role authenticated');
  const project=(await create()).rows[0].v;assert.equal(project.customer_id,customer);
  assert.equal((await create()).rows[0].v.id,project.id);
  await db.exec('reset role');const saved=await read();
  assert.equal(saved.projects.length,before.projects.length+1);assert.equal(saved.contracts.length,before.contracts.length+1);
  assert.equal(saved.billing_operations.length,before.billing_operations.length+1);assert.equal(saved.billing_migration_acceptances.length,before.billing_migration_acceptances.length+1);
  await db.exec('rollback');assert.deepEqual(await read(),before,'rehearsal must leave all 19 tables unchanged');
  await db.exec("begin;create function test_atomic_contract_fail() returns trigger language plpgsql as $$begin raise exception 'synthetic contract failure';end$$;create trigger fail_atomic_contract before insert on contracts for each row execute function test_atomic_contract_fail();set local role authenticated");
  await assert.rejects(create(),/synthetic contract failure/);await db.exec('rollback');assert.deepEqual(await read(),before);
  const smoke=fs.readFileSync(path.join(__dirname,'../database/drafts/20260930_atomic_project_rollback_smoke.sql'),'utf8');
  assert(!/\bCOMMIT\s*;/i.test(smoke.replace(/--[^\n]*/g,'')));
  await db.exec(smoke);assert.deepEqual(await read(),before,'exact hosted rollback SQL must leave all 19 tables unchanged');
  console.log('PASS: migrated archive, exact schema/guards, authenticated full-field creation, retry, failed-contract rollback and all 19 tables unchanged. No hosted writes.');
 }finally{await db.close()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
