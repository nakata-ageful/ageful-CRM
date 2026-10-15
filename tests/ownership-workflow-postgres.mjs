// Synthetic Postgres only. No production credentials or customer records.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),actor='11111111-1111-4111-8111-111111111111'
let n=0;const key=()=>`12345678-1234-4234-8234-${String(++n).padStart(12,'0')}`
const read=f=>readFileSync(new URL('../database/'+f,import.meta.url),'utf8')
const one=async(t,id)=>(await db.query(`select to_jsonb(x) value from ${t} x where id=$1`,[id])).rows[0]?.value
const rows=async t=>(await db.query(`select to_jsonb(x) value from ${t} x order by to_jsonb(x)::text`)).rows.map(r=>r.value)
const snap=async()=>Object.fromEntries(await Promise.all(['customers','projects','contracts','prospects','billing_units','billing_operations','ownership_transfers','ownership_workflow_events','billing_recipient_plans'].map(async t=>[t,await rows(t)])))
const write=(k,r)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');return tx.query('select billing_runtime_write($1,$2::jsonb) value',[k,JSON.stringify(r)])})
const workflow=async(action,extra={},k=key())=>write(k,{action:'ownership_workflow',value:{action,value:{projectId:1,project:await one('projects',1),reason:'合成テスト',...extra}}})
try{
  await db.exec(`create role authenticated;create role anon;create schema auth;
    grant usage on schema public,auth to authenticated,anon;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    set test.actor='${actor}';set request.headers='{"x-ageful-client":"ledger-v1"}';`)
  await db.exec(read('schema.sql'))
  await db.exec('alter table contracts add column ownership_transfer_date date,add column billing_schedule_days text[]')
  await db.transaction(async tx=>{await tx.exec("set local ageful.allow_draft_migration='yes'");
    for(const f of ['20260907_billing_ownership_foundation.sql','20260907_invoice_write_rpc.sql','20260907_invoice_import_rpc.sql',
      '20260907_preserve_maintenance_source.sql','20260907_invoice_recipient_initialization.sql','20260907_invoice_initialization_inspection.sql',
      '20260907_imported_invoice_source_guard.sql','20260907_legacy_invoice_creation_guard.sql','20260907_transfer_detail_choices.sql',
      '20260907_manual_billing_plan.sql','20260907_transfer_ownership_manual.sql','20260907_manual_debit_result.sql','20260907_create_manual_debit_plan.sql',
      '20260914_management_lifecycle.sql','20260914_future_schedule.sql','20260909_billing_runtime.sql','20260914_confirm_imported_round.sql',
      '20260924_transfer_selected_next.sql'])await tx.exec(read('drafts/'+f))})
  await db.exec(`create table ageful_migration_target(project_ref text);insert into ageful_migration_target values('ufawaiddntqqbjhycbxn');
    insert into customers(id,name) values(1,'A'),(2,'B'),(3,'C'),(4,'未定');
    insert into projects(id,customer_id,project_name,plant_name) values(1,1,'架空発電所','架空発電所'),(2,4,'既存未定の発電所','既存未定の発電所');
    insert into contracts(id,project_id,billing_method,annual_maintenance_inc) values(1,1,'請求書',165000);
    insert into prospects(id,customer_name,project_name,converted_customer_id) values(100,'未定','既存未定の発電所',4);
    select setval(pg_get_serial_sequence('prospects','id'),100);
    insert into billing_recipient_plans(project_id,default_recipient_customer_id,effective_from) values(1,1,'2025-01-01');
    insert into billing_units(project_id,contract_id,occurrence_key,service_year,round_number,recipient_customer_id,original_method,collection_method,lifecycle,issued_on,received_on,collection_state,frozen_amount,frozen_line_items,frozen_at)
      values(1,1,'paid',2025,1,1,'invoice','invoice','received','2025-01-01','2025-02-01','succeeded',165000,'[{"name":"保守料","amount":165000}]',now());
    insert into billing_units(project_id,contract_id,occurrence_key,service_year,round_number,recipient_customer_id,original_method,collection_method,planned_amount,scheduled_date)
      values(1,1,'future',2026,1,1,'invoice','invoice',165000,'2026-12-01');
    insert into billing_migration_acceptances(project_id,report,actor_user_id) values(1,'{"synthetic":true}','${actor}'),(2,'{"synthetic":true}','${actor}');
    insert into billing_runtime_control(owner_user_id,enabled,future_schedule_coverage_verified,cutover_on) values('${actor}',true,true,'2026-09-01');`)
  await db.exec(read('migrations/20261003_billing_cycle_rules.sql'))
  await db.exec(read('migrations/20261010083859_billing_record_removal.sql'))
  const facts=await rows('billing_units'),legacy=await one('prospects',100),oldProject=await one('projects',2),oldCustomers=await rows('customers')
  await db.exec(read('migrations/20261015025017_ownership_workflow.sql'))
  const initial=await snap(),startKey=key(),startRequest={action:'ownership_workflow',value:{action:'start',value:{projectId:1,project:await one('projects',1),customerId:null,reason:'未定で募集'}}}
  const first=(await write(startKey,startRequest)).rows[0].value.prospectId
  assert.equal((await one('prospects',first)).converted_customer_id,null)
  assert.equal((await one('projects',1)).customer_id,1)
  assert.equal((await rows('projects')).length,2);assert.equal((await rows('contracts')).length,1)
  const afterStart=await snap();await write(startKey,startRequest);assert.deepEqual(await snap(),afterStart,'Start replay creates no duplicates')
  await assert.rejects(workflow('start',{customerId:null}),/登録済み/)
  await assert.rejects(db.query("update prospects set customer_name='B' where id=$1",[first]),/引継ぎ先/)
  await assert.rejects(db.query('delete from prospects where id=$1',[first]),/取消/)
  await db.query("update prospects set equipment=300000,apply_status='通過' where id=$1",[first])
  assert.equal((await one('projects',1)).customer_id,1,'Loan approval never changes owner')
  await workflow('candidate',{prospectId:first,prospect:await one('prospects',first),customerId:2})
  assert.equal((await one('prospects',first)).candidate_customer_id,2)
  assert.equal((await one('projects',1)).customer_id,1)
  await workflow('start',{customerId:3})
  const undecided=(await workflow('start',{customerId:null})).rows[0].value.prospectId
  await assert.rejects(workflow('candidate',{prospectId:undecided,prospect:await one('prospects',undecided),customerId:2}),/登録済み/)
  await workflow('cancel',{prospectId:undecided,prospect:await one('prospects',undecided)})
  assert.equal((await one('projects',1)).customer_id,1,'Cancelling a candidate never changes owner')
  const snapshotBeforeFailure=await snap()
  await db.exec(`create function fail_workflow() returns trigger language plpgsql as $$begin raise exception 'audit failure';end$$;
    create trigger fail before insert on ownership_workflow_events for each row execute function fail_workflow()`)
  await assert.rejects(workflow('unknown',{date:'2026-01-01'}),/audit failure/)
  assert.deepEqual(await snap(),snapshotBeforeFailure,'Audit failure rolls back owner/default retirement')
  await db.exec('drop trigger fail on ownership_workflow_events')
  await assert.rejects(workflow('unknown',{date:'2199-01-01'}),/未来/)
  const unknownKey=key(),unknownRequest={action:'ownership_workflow',value:{action:'unknown',value:{projectId:1,project:await one('projects',1),date:'2026-01-01',reason:'売却済・氏名不明'}}}
  await write(unknownKey,unknownRequest)
  const unknown=await one('projects',1);assert.equal(unknown.customer_id,null);assert.equal(unknown.previous_owner_customer_id,1)
  await assert.rejects(db.exec('update projects set previous_owner_customer_id=3 where id=1'),/専用/)
  await assert.rejects(db.exec("update projects set owner_unconfirmed_on='2026-01-02' where id=1"),/専用/)
  assert.equal(unknown.owner_unconfirmed_on,'2026-01-01');assert.equal((await rows('billing_recipient_plans')).filter(p=>!p.retired_at).length,0)
  assert.deepEqual(await rows('billing_units'),facts,'Unknown owner keeps every actual and planned invoice unchanged')
  const cCandidate=(await rows('prospects')).find(p=>p.candidate_customer_id===3)
  await workflow('cancel',{prospectId:cCandidate.id,prospect:cCandidate})
  assert.equal((await one('projects',1)).customer_id,null,'Cancellation cannot restore an ended A owner')
  const unknownSnapshot=await snap();await write(unknownKey,unknownRequest);assert.deepEqual(await snap(),unknownSnapshot)
  const preservedChoices=facts.filter(u=>u.lifecycle==='planned').map(u=>({unitId:String(u.id),expectedRevision:u.revision,recipientId:u.recipient_customer_id,
    method:u.collection_method==='invoice'?'請求書':'口座振替',scheduledDate:u.scheduled_date,plannedAmount:u.planned_amount,periodStart:u.period_start,periodEnd:u.period_end,note:u.plan_note}))
  const contract=await one('contracts',1),transfer={project:unknown,contract,newOwner:2,futureRecipient:2,date:'2026-01-02',fields:{contract:{}},choices:preservedChoices,reason:'Bへ引継ぎ',procedureConfirmed:true}
  await assert.rejects(write(key(),{action:'transfer',value:transfer}),/見込み管理/)
  const completeKey=key(),completeRequest={action:'ownership_workflow',value:{action:'complete',value:{projectId:1,project:unknown,reason:'Bへ引継ぎ',prospectId:first,prospect:await one('prospects',first),transfer}}}
  const completeBefore=await snap()
  await db.exec('create trigger fail before insert on ownership_workflow_events for each row execute function fail_workflow()')
  await assert.rejects(write(completeKey,completeRequest),/audit failure/)
  assert.deepEqual(await snap(),completeBefore,'Completion audit failure rolls back transfer, contract, billing, prospects and both operation logs')
  await db.exec('drop trigger fail on ownership_workflow_events')
  await write(completeKey,completeRequest)
  const completeAfter=await snap();await write(completeKey,completeRequest);assert.deepEqual(await snap(),completeAfter,'Completion replay is stable')
  assert.equal((await one('projects',1)).customer_id,2);assert.equal((await one('projects',1)).owner_unconfirmed_on,null)
  assert.equal((await one('prospects',first)).ownership_state,'completed')
  assert.equal((await rows('prospects')).filter(p=>p.ownership_state==='open').length,0)
  const afterUnits=await rows('billing_units')
  assert.deepEqual(afterUnits.find(u=>u.lifecycle==='received'),facts.find(u=>u.lifecycle==='received'),'A past actual remains exactly unchanged')
  for(const field of ['recipient_customer_id','planned_amount','scheduled_date','period_start','period_end','collection_method'])assert.deepEqual(afterUnits.find(u=>u.lifecycle==='planned')[field],facts.find(u=>u.lifecycle==='planned')[field],'Existing plan choice remains '+field)
  assert.equal((await rows('ownership_transfers'))[0].from_customer_id,1)
  assert.equal((await rows('ownership_transfers'))[0].project_fields_before.customer_id,null)
  assert.deepEqual(await one('prospects',100),{...legacy,ownership_project_id:null,candidate_customer_id:null,ownership_state:null});assert.deepEqual(await one('projects',2),{...oldProject,previous_owner_customer_id:null,owner_unconfirmed_on:null})
  assert.deepEqual(await rows('customers'),oldCustomers,'Existing 未定 and all customers untouched')
  const publicSnapshot=await db.transaction(async tx=>{await tx.exec('set local role authenticated');return (await tx.query('select billing_runtime_snapshot() value')).rows[0].value})
  assert.equal(publicSnapshot.version,4);assert.equal(publicSnapshot.ownership_workflow_ready,true);assert.equal(publicSnapshot.record_removal_ready,true)
  assert.equal(publicSnapshot.ownership_workflow_events.length,(await rows('ownership_workflow_events')).length)
  const backup=(await db.query('select billing_runtime_backup() value')).rows[0].value
  assert.equal(backup.ownership_workflow_events.length,publicSnapshot.ownership_workflow_events.length)
  assert.equal(backup.billing_units.length,2);assert.equal(backup.version,2)
  await db.exec("set test.actor='22222222-2222-4222-8222-222222222222'")
  await assert.rejects(workflow('start',{customerId:null}),/利用権限/)
  assert.equal((await db.query("select has_function_privilege('anon','ownership_workflow_write(uuid,jsonb)','execute') allowed")).rows[0].allowed,false)
  console.log('PASS: same-project undecided/named prospects, no customer/project duplication, guarded identity, approval isolation, unknown→B, immutable invoices/legacy 未定, audit rollback, replay and single-owner access')
}catch(e){console.error(e.message);process.exitCode=1}finally{await db.close()}
