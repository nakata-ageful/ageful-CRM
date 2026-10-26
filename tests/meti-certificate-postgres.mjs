import assert from 'node:assert/strict'
import{readFileSync}from'node:fs'
import{PGlite}from'@electric-sql/pglite'
const db=new PGlite(),sql=readFileSync('database/migrations/20261026055250_meti_certificate_import.sql','utf8')
const snapshot=async t=>(await db.query(`select to_jsonb(x) v from ${t} x order by to_jsonb(x)::text`)).rows.map(r=>r.v)
const run=req=>db.transaction(async tx=>{await tx.exec('set local role authenticated');return(await tx.query('select meti_certificate_apply($1::jsonb) v',[JSON.stringify(req)])).rows[0].v})
try{
 await db.exec(`create role authenticated;create role anon;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function billing_runtime_is_owner() returns boolean language sql security invoker as $$select auth.uid()='11111111-1111-4111-8111-111111111111'::uuid$$;
 set test.actor='11111111-1111-4111-8111-111111111111';grant usage on schema auth to authenticated,anon;`)
 await db.exec(readFileSync('database/schema.sql','utf8'))
 await db.exec(`alter table projects add column archived_at timestamptz;
 create table ageful_migration_target(project_ref text);insert into ageful_migration_target values('wrong');
 insert into customers(id,name,address)values(1,'合成顧客','元の住所'),(2,'別の顧客','別の住所');
 insert into projects(id,customer_id,project_name,panel_kw,meti_notes)values(1,1,'合成発電所',49.5,'元の備考'),(2,1,'別の発電所',10,'別の備考');
 insert into contracts(id,project_id)values(1,1);insert into annual_records(contract_id,year,billing_date)values(1,2025,'2025-12-01');
 grant select,update on projects,customers to authenticated;`)
 const tables=['customers','projects','contracts','annual_records','maintenance_responses','periodic_maintenance','prospects'],baseline=Object.fromEntries(await Promise.all(tables.map(async t=>[t,await snapshot(t)])))
 await assert.rejects(db.exec(sql),/Wrong project/);await db.exec('rollback');await db.exec("update ageful_migration_target set project_ref='ufawaiddntqqbjhycbxn'");await db.exec(sql)
 for(const t of tables)assert.deepEqual(await snapshot(t),baseline[t],'Migration leaves existing data unchanged')
 const req={projectId:1,customerId:1,before:{panel_kw:49.5,meti_notes:'元の備考'},patch:{panel_kw:84.4,meti_notes:'元の備考\n事業者住所：読み取り住所'},updateCustomer:true,customerBefore:'元の住所',customerAddress:'読み取り住所'}
 assert.equal((await run(req)).applied,true);const saved=await snapshot('projects');assert.equal(saved.find(r=>r.id===1).panel_kw,84.4)
 await run(req);assert.deepEqual(await snapshot('projects'),saved,'Same request retry is a no-op')
 for(const t of tables.filter(t=>!['projects','customers'].includes(t)))assert.deepEqual(await snapshot(t),baseline[t],'No contract/billing/maintenance/prospect writes')
 assert.deepEqual((await snapshot('projects')).find(r=>r.id===2),baseline.projects.find(r=>r.id===2))
 await assert.rejects(run({...req,patch:{customer_id:2},before:{customer_id:1}}),/反映できない/)
 await assert.rejects(run({...req,patch:{panel_kw:99},before:{panel_kw:49.5}}),/更新されています/)
 await assert.rejects(run({...req,patch:{panel_kw:-1},before:{panel_kw:84.4}}),/出力/)
 await assert.rejects(run({...req,patch:{grid_certified_at:'2026-02-30'},before:{grid_certified_at:null}}),/date|range/)
 await assert.rejects(run({...req,patch:{panel_count:2.5},before:{panel_count:null}}),/枚数/)
 const b=await snapshot('projects');await assert.rejects(run({...req,patch:{panel_kw:100},before:{panel_kw:84.4},customerBefore:'古い住所',customerAddress:'競合した住所'}),/顧客の住所が更新/);assert.deepEqual(await snapshot('projects'),b,'Customer conflict rolls back project update')
 await db.exec(`create function fail_customer_import_test() returns trigger language plpgsql as $$begin raise exception 'synthetic customer save failure';end$$; create trigger fail_customer_import_test before update on customers for each row execute function fail_customer_import_test();`)
 const atomicBefore=await snapshot('projects');await assert.rejects(run({...req,patch:{panel_kw:100},before:{panel_kw:84.4},customerBefore:'読み取り住所',customerAddress:'新しい住所'}),/synthetic customer save failure/);assert.deepEqual(await snapshot('projects'),atomicBefore,'A customer UPDATE failure rolls back the earlier project UPDATE');await db.exec('drop trigger fail_customer_import_test on customers')
 await db.exec("set test.actor='22222222-2222-4222-8222-222222222222'");await assert.rejects(run(req),/利用権限/);await db.exec("set test.actor='11111111-1111-4111-8111-111111111111'")
 await assert.rejects(run({...req,patch:{panel_kw:84.375},before:{panel_kw:84.4}}),/小数点以下2桁/)
 await assert.rejects(run({...req,customerId:2}),/所有者/)
 await db.exec("update projects set archived_at=now() where id=1");await assert.rejects(run(req),/所有者/)
 await db.exec("set test.actor=''");await assert.rejects(run(req),/利用権限/)
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select meti_certificate_apply($1::jsonb)',[JSON.stringify(req)])}),/permission denied/)
 const f=(await db.query("select prosecdef from pg_proc where proname='meti_certificate_apply'")).rows[0];assert.equal(f.prosecdef,false)
 console.log('PASS: new-project guard, zero migration data changes, invoker permissions, chosen fields only, atomic project/customer save, retries, concurrent edit/owner/archive rejection, invalid fields/date/numbers, unchanged billing/contract/maintenance/prospect rows')
}catch(e){console.error('FAIL:',e.message,e.detail??'');process.exitCode=1}finally{await db.close()}
