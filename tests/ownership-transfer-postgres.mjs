// Inherit-all only, synthetic PostgreSQL fixtures. No credentials/live writes.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite()
let sequence=0
const key=()=>`44444444-4444-4444-8444-${String(++sequence).padStart(12,'0')}`
const tables=['projects','contracts','billing_units','billing_recipient_plans','billing_recipient_plan_overrides',
  'billing_operations','billing_unit_events','ownership_transfers','prospects']
async function snapshot(){
  const result={}
  for(const table of tables)result[table]=(await db.query(`select to_jsonb(t) as value from ${table} t order by to_jsonb(t)::text`)).rows.map(r=>r.value)
  return result
}
function transfer(op,before,owner=2,defaultRecipient=2,overrides={'1':1},date='2025-09-01'){
  const plan=before.billing_recipient_plans.find(p=>p.retired_at===null)
  const versions=Object.fromEntries(before.billing_units.filter(u=>u.lifecycle==='planned').map(u=>[u.id,u.revision]))
  return db.query('select transfer_ownership_inherit($1,1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8::jsonb,$9,$10::jsonb) as result',
    [op,owner,date,JSON.stringify(before.projects[0]),JSON.stringify(before.contracts[0]),plan?.id??null,plan?.revision??null,
      JSON.stringify(versions),defaultRecipient,JSON.stringify(overrides)])
}
try{
  await db.exec(`create table customers(id bigint primary key,name text not null);
    create table projects(id bigint primary key,customer_id bigint references customers(id),old_owner text,notes text,extra jsonb);
    create table contracts(id bigint primary key,project_id bigint references projects(id),billing_method text,
      ownership_transfer_date date,equipment_contract_date date,annual_maintenance_inc bigint,notes text,extra jsonb);
    create table annual_records(id bigint primary key,contract_id bigint references contracts(id));
    create table prospects(id bigint primary key,converted_customer_id bigint,notes text);
    create schema auth;
    create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''test.actor'',true),'''')::uuid';
    set test.actor='11111111-1111-4111-8111-111111111111';
    insert into customers values(1,'架空A'),(2,'架空B'),(3,'架空C');
    insert into projects values(1,1,'以前の所有者','現場の注意','{"nested":["project history"]}');
    insert into contracts values(1,1,'請求書','2024-01-01','2020-01-01',82500,'Aの契約情報','{"future_column":true}');
    insert into prospects values(1,1,'A時代の営業記録');`)
  await db.transaction(async tx=>{
    await tx.exec("set local ageful.allow_draft_migration='yes'")
    for(const name of ['20260907_billing_ownership_foundation.sql','20260907_invoice_write_rpc.sql',
      '20260907_invoice_recipient_plan_rpc.sql','20260907_transfer_ownership_inherit_rpc.sql']){
      await tx.exec(readFileSync(new URL('../database/drafts/'+name,import.meta.url),'utf8'))
    }
  })
  await db.exec(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,scheduled_date,original_method,collection_method,recipient_customer_id)
    values(1,1,'next',2025,'2025-12-01','invoice','invoice',1),(1,1,'later',2026,'2026-06-01','invoice','invoice',1);
    insert into billing_units(project_id,contract_id,occurrence_key,service_year,original_method,collection_method,
      recipient_customer_id,recipient_source,lifecycle,issued_on,received_on,collection_state,frozen_amount,frozen_line_items,frozen_at,amount_basis)
    values(1,1,'paid',2024,'invoice','invoice',1,'confirmed','received','2024-06-01','2024-06-10','succeeded',82500,
      '[{"name":"保守料","amount":82500}]',now(),'operator_confirmed');`)
  const before=await snapshot()
  await assert.rejects(transfer(key(),before,1),/同じ所有者/)
  await assert.rejects(transfer(key(),before,999),/新所有者/)
  const stale=structuredClone(before);stale.contracts[0].notes='outdated'
  await assert.rejects(transfer(key(),stale),/更新されています/)
  const staleProject=structuredClone(before);staleProject.projects[0].notes='old site note'
  await assert.rejects(transfer(key(),staleProject),/更新されています/)
  const future=(await db.query("select (current_date+1)::text as day")).rows[0].day
  await assert.rejects(transfer(key(),before,2,2,{},future),/未来日予約/)
  await assert.rejects(transfer(key(),before,2,2,{'3':2}),/未発行/)
  await assert.rejects(transfer(key(),before,2,2,{},'2023-01-01'),/前の日付/)
  assert.deepEqual(await snapshot(),before)
  // Final history insert fails after both owner and contract update + entire child plan operation.
  await db.exec(`create function test_fail_transfer() returns trigger language plpgsql as $$begin
    raise exception 'synthetic transfer audit failure'; end$$;
    create trigger fail_transfer before insert on ownership_transfers for each row execute function test_fail_transfer();`)
  await assert.rejects(transfer(key(),before),/synthetic transfer audit failure/)
  assert.deepEqual(await snapshot(),before,'Owner, contract, child plan, histories and both operations roll back')
  await db.exec('drop trigger fail_transfer on ownership_transfers')
  const firstOp=key(),receipt=await transfer(firstOp,before),first=await snapshot()
  assert.equal(first.projects[0].customer_id,2)
  assert.equal(first.projects[0].old_owner,'架空A')
  assert.equal(first.contracts[0].ownership_transfer_date,'2025-09-01')
  assert.deepEqual(first.contracts[0],{...before.contracts[0],ownership_transfer_date:'2025-09-01'})
  assert.deepEqual(first.projects[0],{...before.projects[0],customer_id:2,old_owner:'架空A'})
  assert.equal(first.billing_units.find(u=>u.id===1).recipient_customer_id,1)
  assert.equal(first.billing_units.find(u=>u.id===2).recipient_customer_id,2)
  assert.deepEqual(first.billing_units.find(u=>u.id===3),before.billing_units.find(u=>u.id===3))
  assert.deepEqual(first.prospects,before.prospects)
  assert.deepEqual(first.ownership_transfers[0].contract_before,before.contracts[0])
  assert.deepEqual(first.ownership_transfers[0].project_fields_after,first.projects[0])
  assert.equal(first.billing_operations.length,2)
  assert.deepEqual((await transfer(firstOp,before)).rows,receipt.rows)
  assert.deepEqual(await snapshot(),first)
  await assert.rejects(transfer(firstOp,before,3),/同じ操作ID/)
  await transfer(key(),first,3,3,{},'2025-10-01')
  const second=await snapshot()
  assert.equal(second.projects[0].customer_id,3)
  assert.equal(second.projects[0].old_owner,'架空B')
  assert.equal(second.billing_units.find(u=>u.id===1).recipient_customer_id,3,'Next invoice can switch immediately to new owner')
  assert.equal(second.ownership_transfers.length,2)
  assert.deepEqual(second.ownership_transfers.find(t=>t.operation_key===firstOp),first.ownership_transfers[0])
  await transfer(firstOp,before)
  assert.deepEqual(await snapshot(),second,'Old retry cannot rewind A→B→C')
  await db.exec('insert into annual_records values(1,1)')
  await assert.rejects(transfer(key(),second,1,1,{},'2025-11-01'),/旧年度記録/)
  assert.deepEqual(await snapshot(),second)
  await db.exec("set test.actor=''")
  await assert.rejects(transfer(key(),second,1),/ログイン/)
  assert.equal((await db.query("select has_function_privilege('public','transfer_ownership_inherit(uuid,bigint,bigint,date,jsonb,jsonb,bigint,integer,jsonb,bigint,jsonb)','execute') as allowed")).rows[0].allowed,false)
  console.log('PASS: inherit-all atomic A→B→C, next A/later B and immediate C, full snapshots, frozen past, unchanged prospect, retry/stale/legacy/access guards')
  console.log('Scope: isolated invoice-only with no legacy records. Field edits, real triggers/RLS, migration and concurrent sessions not verified.')
}finally{await db.close()}
