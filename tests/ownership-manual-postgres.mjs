import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite();let n=0;const key=()=>`88888888-8888-4888-8888-${String(++n).padStart(12,'0')}`
try{
  await db.exec(`create table customers(id bigint primary key,name text);create table projects(id bigint primary key,customer_id bigint,old_owner text,notes text);
    create table contracts(id bigint primary key,project_id bigint,billing_method text,ownership_transfer_date date,notes text);
    create table annual_records(id bigint primary key,contract_id bigint);create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    set test.actor='11111111-1111-4111-8111-111111111111';insert into customers values(1,'A'),(2,'B'),(3,'C');
    insert into projects values(1,1,null,'現場メモ');insert into contracts values(1,1,'口座振替','2024-01-01','Aの契約');`)
  await db.transaction(async tx=>{await tx.exec("set local ageful.allow_draft_migration='yes'");for(const f of ['20260907_billing_ownership_foundation.sql','20260907_invoice_write_rpc.sql','20260907_transfer_detail_choices.sql','20260907_manual_billing_plan.sql','20260907_transfer_ownership_manual.sql'])await tx.exec(readFileSync(new URL('../database/drafts/'+f,import.meta.url),'utf8'))})
  await db.exec(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,original_method,collection_method,recipient_customer_id,planned_amount)
    values(1,1,'a',2026,'invoice','invoice',1,100),(1,1,'b',2026,'direct_debit','direct_debit',1,200);`)
  const snapshot=async()=>{const s={};for(const t of ['projects','contracts','billing_units','billing_unit_events','billing_operations','ownership_transfers','billing_recipient_plans','billing_recipient_plan_overrides'])s[t]=(await db.query(`select to_jsonb(x) as v from ${t} x order by to_jsonb(x)::text`)).rows.map(r=>r.v);return s}
  const choices=(rev,owner)=>[1,2].map(id=>({unitId:String(id),expectedRevision:rev,recipientId:owner,method:id===1?'口座振替':'請求書',scheduledDate:'2026-12-01',plannedAmount:id*100,periodStart:null,periodEnd:null,note:'個別確認'}))
  const transfer=(op,s,owner=2,cs=choices(0,2))=>db.query('select transfer_ownership_manual($1,1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7::jsonb,$8)',
    [op,owner,'2025-09-01',JSON.stringify(s.projects[0]),JSON.stringify(s.contracts[0]),JSON.stringify({contract:{notes:{mode:'clear'}}}),JSON.stringify(cs),'架空の移転'])
  const before=await snapshot()
  await assert.rejects(transfer(key(),before,1),/所有者/)
  await assert.rejects(transfer(key(),before,2,choices(0,3)),/請求先/)
  await db.exec(`create function fail_transfer() returns trigger language plpgsql as $$begin raise exception 'final snapshot failure';end$$;
    create trigger fail before insert on ownership_transfers for each row execute function fail_transfer();`)
  await assert.rejects(transfer(key(),before),/final snapshot failure/)
  assert.deepEqual(await snapshot(),before,'Final failure rolls back owner, contract, both units, events and child/parent operations')
  await db.exec('drop trigger fail on ownership_transfers')
  const op=key();await transfer(op,before);const after=await snapshot()
  assert.equal(after.projects[0].customer_id,2);assert.equal(after.projects[0].old_owner,'A');assert.equal(after.contracts[0].notes,null)
  assert.deepEqual(after.ownership_transfers[0].contract_before,before.contracts[0]);assert.deepEqual(after.ownership_transfers[0].project_fields_before,before.projects[0])
  assert.equal(after.billing_unit_events.length,2);assert.equal(after.billing_operations.length,2)
  await transfer(op,before);assert.deepEqual(await snapshot(),after)
  await assert.rejects(transfer(key(),before),/更新/)
  await transfer(key(),after,3,choices(1,3));const third=await snapshot()
  assert.equal(third.projects[0].customer_id,3);assert.equal(third.ownership_transfers.length,2)
  assert.equal(third.billing_recipient_plans.find(p=>p.retired_at===null).default_recipient_customer_id,3)
  assert.ok(third.ownership_transfers.some(t=>t.from_customer_id===1&&t.to_customer_id===2))
  assert.ok(third.ownership_transfers.some(t=>t.from_customer_id===2&&t.to_customer_id===3))
  await transfer(op,before);assert.deepEqual(await snapshot(),third,'Old replay cannot undo C ownership')
  assert.equal((await db.query("select has_function_privilege('public','transfer_ownership_manual(uuid,bigint,bigint,date,jsonb,jsonb,jsonb,jsonb,text)','execute') as ok")).rows[0].ok,false)
  console.log('PASS: atomic mixed-plan A→B→C, selected contract clear, complete snapshots, final-failure rollback, stable replay and stale guards. No legacy/recipient-plan integration.')
}finally{await db.close()}
