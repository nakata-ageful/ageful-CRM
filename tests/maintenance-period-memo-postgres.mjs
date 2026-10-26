import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),sql=readFileSync(new URL('../database/migrations/20261026015351_maintenance_period_memo_date.sql',import.meta.url),'utf8')
try{
 await db.exec(`create role authenticated;create role anon;
 create table ageful_migration_target(project_ref text);insert into ageful_migration_target values('old-project');
 create table contracts(id bigint primary key,maintenance_start_date date,annual_maintenance_inc bigint,notes text);
 create table billing_units(id bigint primary key,scheduled_date date,issued_on date,received_on date,frozen_amount bigint,period_start date,period_end date);
 create table annual_records(id bigint primary key,notes text);
 create table periodic_maintenance(id bigint primary key,notes text);
 create table billing_cycle_rules(id bigint primary key,effective_year integer,mode text);
 insert into contracts values(1,'2023-08-01',165000,'保持する備考');
 insert into billing_units values(1,'2026-12-01','2026-12-01','2026-12-10',165000,'2027-01-01','2027-12-31');
 insert into annual_records values(1,'過去記録');insert into periodic_maintenance values(1,'保守予定');
 insert into billing_cycle_rules values(1,2027,'calendar_prepaid');
 alter table contracts enable row level security;grant select,update on contracts to authenticated;
 create policy operator_select on contracts for select to authenticated using(true);
 create policy operator_update on contracts for update to authenticated using(true) with check(true);`)
 const rows=async(t,withoutMemo=false)=>(await db.query(`select ${withoutMemo?"to_jsonb(t)-'maintenance_period_start_memo_date'":"to_jsonb(t)"} v from ${t} t order by id`)).rows.map(r=>r.v)
 const before={};for(const t of ['contracts','billing_units','annual_records','periodic_maintenance','billing_cycle_rules'])before[t]=await rows(t)
 await assert.rejects(db.exec(sql),/Wrong project/);await db.exec('rollback')
 assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='contracts' and column_name='maintenance_period_start_memo_date'")).rows[0].n,0)
 await db.exec("update ageful_migration_target set project_ref='ufawaiddntqqbjhycbxn'");await db.exec(sql)
 assert.equal((await rows('contracts'))[0].maintenance_period_start_memo_date,null,'No inference or backfill')
 await db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.exec("update contracts set maintenance_period_start_memo_date='2027-01-01' where id=1")})
 assert.equal((await rows('contracts'))[0].maintenance_period_start_memo_date,'2027-01-01')
 for(const t of Object.keys(before))assert.deepEqual(await rows(t,t==='contracts'),before[t])
 await db.exec('update contracts set maintenance_period_start_memo_date=null where id=1')
 await assert.rejects(db.exec("update contracts set maintenance_period_start_memo_date='2027-02-30' where id=1"),/date|range/i)
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');await tx.exec('select * from contracts')}),/permission denied/)
 assert.equal((await db.query("select relrowsecurity from pg_class where relname='contracts'")).rows[0].relrowsecurity,true)
 console.log('PASS: new-target-only additive nullable date, no backfill, memo update/clear, strict date and existing RLS/grants, unchanged invoices/payments/maintenance/rules/contract start')
}finally{await db.close()}
