import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const db=new PGlite();let n=0;const key=()=>`77777777-7777-4777-8777-${String(++n).padStart(12,'0')}`
try {
  await db.exec(`create table customers(id bigint primary key);create table projects(id bigint primary key);
    create table contracts(id bigint primary key,project_id bigint);create table annual_records(id bigint primary key);
    create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    set test.actor='11111111-1111-4111-8111-111111111111';insert into customers values(1),(2);insert into projects values(1);insert into contracts values(1,1);`)
  await db.transaction(async tx=>{await tx.exec("set local ageful.allow_draft_migration='yes'");for(const f of ['20260907_billing_ownership_foundation.sql','20260907_invoice_write_rpc.sql','20260907_manual_billing_plan.sql','20260907_manual_debit_result.sql'])await tx.exec(readFileSync(new URL('../database/drafts/'+f,import.meta.url),'utf8'))})
  await db.exec(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,original_method,collection_method,recipient_customer_id,planned_amount)
    values(1,1,'a',2026,'invoice','invoice',1,82500),(1,1,'b',2026,'direct_debit','direct_debit',1,82500);`)
  const snapshot=async()=> (await db.query(`select jsonb_build_object('units',(select jsonb_agg(to_jsonb(u) order by id) from billing_units u),
    'events',(select jsonb_agg(to_jsonb(e) order by id) from billing_unit_events e),'ops',(select jsonb_agg(to_jsonb(o) order by operation_key) from billing_operations o)) as s`)).rows[0].s
  const choice=(id,rev,method)=>({unitId:String(id),expectedRevision:rev,recipientId:2,method,scheduledDate:'2027-06-01',plannedAmount:82500,periodStart:'2027-06-01',periodEnd:'2028-05-31',note:'翌年から'})
  const write=(id,cs)=>db.query('select write_manual_billing_plan($1,1,$2::jsonb,$3)',[id,JSON.stringify(cs),'架空検証'])
  const cs=[choice(1,0,'口座振替'),choice(2,0,'請求書')], before=await snapshot()
  await assert.rejects(write(key(),cs.slice(0,1)),/全件/)
  await assert.rejects(write(key(),[cs[0],cs[0]]),/重複/)
  await assert.rejects(write(key(),[cs[0],{...cs[1],periodEnd:null}]),/対象期間/)
  await assert.rejects(write(key(),[cs[0],{...cs[1],scheduledDate:'2027-02-30'}]))
  assert.deepEqual(await snapshot(),before)
  await db.exec(`create function fail_audit() returns trigger language plpgsql as $$begin if NEW.billing_unit_id=2 then raise exception 'audit failure';end if;return NEW;end$$;
    create trigger fail before insert on billing_unit_events for each row execute function fail_audit();`)
  await assert.rejects(write(key(),cs),/audit failure/);assert.deepEqual(await snapshot(),before)
  await db.exec('drop trigger fail on billing_unit_events')
  const op=key();await write(op,cs);const saved=await snapshot()
  assert.equal(saved.events.length,2);assert.equal(saved.units[0].collection_method,'direct_debit');assert.equal(saved.units[1].collection_method,'invoice')
  assert.equal(saved.units[0].original_method,'invoice');assert.equal(saved.units[0].period_end,'2028-05-31');assert.equal(saved.units[0].frozen_amount,null)
  await write(op,cs);assert.deepEqual(await snapshot(),saved)
  await assert.rejects(write(key(),cs),/全件/)
  await write(key(),[choice(1,1,'口座振替'),choice(2,1,'請求書')])
  await db.exec(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,original_method,collection_method,recipient_customer_id,
    recipient_source,lifecycle,received_on,collection_state,frozen_amount,frozen_line_items,frozen_at)
    values(1,1,'paid',2025,'direct_debit','direct_debit',1,'confirmed','received','2025-06-01','succeeded',82500,'[{"name":"保守料","amount":82500}]',now());
    insert into billing_units(project_id,contract_id,occurrence_key,service_year,original_method,collection_method,recipient_customer_id,collection_state)
    values(1,1,'failed',2026,'direct_debit','invoice',1,'failed');`)
  const baseline=await snapshot(), next=[choice(1,2,'口座振替'),choice(2,2,'請求書'),{...choice(4,0,'請求書'),recipientId:1}]
  await assert.rejects(write(key(),[...next.slice(0,2),choice(4,0,'請求書')]),/元の請求先/)
  await assert.rejects(write(key(),[...next.slice(0,2),{...next[2],method:'口座振替'}]),/元の請求先/)
  await assert.rejects(write(key(),[...next,choice(3,0,'請求書')]),/全件/)
  assert.deepEqual(await snapshot(),baseline)
  await write(key(),next)
  assert.deepEqual((await snapshot()).units.find(u=>u.id===3),baseline.units.find(u=>u.id===3),'Paid record byte-for-byte preserved')
  // Invoice-origin plan switched to debit must support an observed failure and same-unit recovery.
  await db.query("select record_manual_debit_result($1,1,3,'invoice_switch','{}','銀行で不能確認')",[key()])
  const failed=(await snapshot()).units.find(u=>u.id===1)
  assert.equal(failed.original_method,'invoice');assert.equal(failed.collection_state,'failed');assert.equal(failed.recipient_customer_id,2)
  await db.query("select write_invoice_unit($1,1,4,'issue',$2::jsonb)",[key(),JSON.stringify({recipient_customer_id:2,scheduled_date:'2027-06-01',
    frozen_amount:82500,frozen_line_items:[{name:'保守料',amount:82500}],issued_on:'2027-06-01',received_on:null,payment_due_on:null})])
  await db.query("select write_invoice_unit($1,1,5,'collection',$2::jsonb)",[key(),JSON.stringify({received_on:'2027-06-10'})])
  assert.equal((await snapshot()).units.find(u=>u.id===1).lifecycle,'received')
  await db.exec("insert into billing_units(project_id,contract_id,occurrence_key,service_year,original_method,collection_method,recipient_customer_id) values(1,1,'invoice-origin-debit',2027,'invoice','direct_debit',2)")
  await db.query("select record_manual_debit_result($1,5,0,'received',$2::jsonb,'入金確認')",[key(),JSON.stringify({received_on:'2027-07-01',amount:100,line_items:[{name:'保守料',amount:100}]})])
  assert.equal((await snapshot()).units.find(u=>u.id===5).lifecycle,'received')
  const correction=key(), correctedValue={received_on:'2027-07-02',amount:120,line_items:[{name:'保守料',amount:120}]}
  const correct=()=>db.query("select record_manual_debit_result($1,5,1,'correction',$2::jsonb,'記録誤りを確認')",[correction,JSON.stringify(correctedValue)])
  await correct();const corrected=await snapshot()
  assert.equal(corrected.units.find(u=>u.id===5).frozen_amount,120)
  assert.equal(corrected.units.find(u=>u.id===5).recipient_customer_id,2)
  assert.ok(corrected.events.some(e=>e.billing_unit_id===5&&e.event_type==='corrected'&&e.before_value.frozen_amount===100&&e.after_value.frozen_amount===120))
  await correct();assert.deepEqual(await snapshot(),corrected)
  await assert.rejects(db.query("select record_manual_debit_result($1,5,2,'correction',$2::jsonb,'')",[key(),JSON.stringify(correctedValue)]),/確認内容/)
  await db.exec("insert into billing_recipient_plans(project_id,default_recipient_customer_id,effective_from) values(1,2,'2027-06-01')")
  await assert.rejects(write(key(),next),/全件/)
  await db.exec("set test.actor=''");await assert.rejects(write(key(),cs),/ログイン/)
  assert.equal((await db.query("select has_function_privilege('public','write_manual_billing_plan(uuid,bigint,jsonb,text)','execute') as allowed")).rows[0].allowed,false)
  console.log('PASS: explicit mixed plans, period/note persistence, audit rollback, stable retry, stale/full coverage and auth guards. Isolated only; ownership and recipient-plan integration NOT included.')
} finally {await db.close()}
