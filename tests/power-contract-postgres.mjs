import assert from 'node:assert/strict'
import{readFileSync}from'node:fs'
import{PGlite}from'@electric-sql/pglite'
const db=new PGlite(),sql=readFileSync('database/migrations/20261031020013_power_contract_import.sql','utf8')
const snapshot=async t=>(await db.query(`select to_jsonb(x) v from ${t} x order by to_jsonb(x)::text`)).rows.map(r=>r.v)
const run=req=>db.transaction(async tx=>{await tx.exec('set local role authenticated');return(await tx.query('select power_contract_apply($1::jsonb) v',[JSON.stringify(req)])).rows[0].v})
try{
 await db.exec(`create role authenticated;create role anon;create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
 create function billing_runtime_is_owner() returns boolean language sql security invoker as $$select auth.uid()='11111111-1111-4111-8111-111111111111'::uuid$$;
 set test.actor='11111111-1111-4111-8111-111111111111';grant usage on schema auth to authenticated,anon;`)
 await db.exec(readFileSync('database/schema.sql','utf8'))
 await db.exec(`alter table projects add column archived_at timestamptz,add column fit_end_date date;
 create table ageful_migration_target(project_ref text);insert into ageful_migration_target values('wrong');
 insert into customers(id,name,address)values(1,'合成顧客','元の住所'),(2,'別の顧客','別の住所');
 insert into projects(id,customer_id,project_name,fit_period,power_company_notes)values(1,1,'合成発電所',20,'元の備考'),(2,1,'別の発電所',20,'別の備考');
 insert into contracts(id,project_id)values(1,1);insert into annual_records(contract_id,year,billing_date)values(1,2025,'2025-12-01');
 grant select,update on projects to authenticated;`)
 const tables=['customers','projects','contracts','annual_records','maintenance_responses','periodic_maintenance','prospects'],baseline=Object.fromEntries(await Promise.all(tables.map(async t=>[t,await snapshot(t)])))
 await assert.rejects(db.exec(sql),/Wrong project/);await db.exec('rollback');await db.exec("update ageful_migration_target set project_ref='ufawaiddntqqbjhycbxn'");await db.exec(sql)
 for(const t of tables)assert.deepEqual(await snapshot(t),baseline[t],'Migration must not change business data')
 const req={projectId:1,customerId:1,before:{fit_period:20,fit_end_date:null,power_company_notes:'元の備考'},patch:{fit_period:18,fit_end_date:'2040-01-01',power_company_notes:'元の備考\n電力会社情報'}}
 assert.equal((await run(req)).applied,true);const saved=await snapshot('projects');assert.equal(saved.find(r=>r.id===1).fit_period,18)
 await run(req);assert.deepEqual(await snapshot('projects'),saved,'Identical retry is a no-op')
 for(const t of tables.filter(t=>t!=='projects'))assert.deepEqual(await snapshot(t),baseline[t],'No customer/contract/billing/maintenance/prospect writes')
 assert.deepEqual((await snapshot('projects')).find(r=>r.id===2),baseline.projects.find(r=>r.id===2))
 for(const [key,value]of Object.entries({customer_id:2,panel_kw:50,site_address:'変更',sales_price:1,old_owner:'別人'}))await assert.rejects(run({...req,patch:{[key]:value},before:{[key]:null}}),/反映できない/)
 await assert.rejects(run({...req,patch:{fit_period:19},before:{fit_period:20}}),/更新されています/)
 for(const value of [18.5,-1,0,1001,'18',null])await assert.rejects(run({...req,patch:{fit_period:value},before:{fit_period:18}}),/FIT|形式|反映できない/)
 for(const value of ['2026-02-30','2026-00-01','1800-01-01','2026-01-02'])await assert.rejects(run({...req,patch:{fit_end_date:value},before:{fit_end_date:'2040-01-01'}}),/date|range|日付|FIT期間/)
 await assert.rejects(run({...req,patch:{generation_point_id:'123'},before:{generation_point_id:null}}),/受給地点/)
 await assert.rejects(run({...req,patch:{grid_id:'<script>'},before:{grid_id:null}}),/設備ID/)
 await assert.rejects(run({...req,patch:{grid_id:'ZZ12345A67'},before:{}}),/反映できない/)
 const b=await snapshot('projects');await assert.rejects(run({...req,patch:{fit_period:19,fit_end_date:'bad'},before:{fit_period:18,fit_end_date:'2040-01-01'}}));assert.deepEqual(await snapshot('projects'),b,'Invalid date rolls back all selected fields')
 await db.exec("set test.actor='22222222-2222-4222-8222-222222222222'");await assert.rejects(run(req),/利用権限/);await db.exec("set test.actor='11111111-1111-4111-8111-111111111111'")
 await assert.rejects(run({...req,customerId:2}),/所有者/)
 await db.exec("update projects set archived_at=now() where id=1");await assert.rejects(run(req),/所有者/)
 await db.exec("set test.actor=''");await assert.rejects(run(req),/利用権限/)
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.query('select power_contract_apply($1::jsonb)',[JSON.stringify(req)])}),/permission denied/)
 assert.equal((await db.query("select prosecdef from pg_proc where proname='power_contract_apply'")).rows[0].prosecdef,false)
 console.log('PASS: new DB guard, no migration data edits, invoker/owner authorization, selected fields only, atomic validation, idempotent retry, concurrent edits, archive/owner change guards, no billing/customer/maintenance/prospect changes')
}catch(e){console.error('FAIL:',e.message,e.detail??'');process.exitCode=1}finally{await db.close()}
