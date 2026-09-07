// Isolated synthetic PostgreSQL only. No production connection or credentials.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
let n = 0
const key = () => `33333333-3333-4333-8333-${String(++n).padStart(12,'0')}`
const write = (op, plan, rev, units, recipient=2, overrides={'1':1}) => db.query(
  'select write_invoice_recipient_plan($1,1,$2,$3,$4::jsonb,$5,$6::jsonb) as result',
  [op,plan,rev,JSON.stringify(units),recipient,JSON.stringify(overrides)])
const snapshot = async () => (await db.query(`select jsonb_build_object(
  'units',(select jsonb_agg(to_jsonb(u) order by id) from billing_units u),
  'plans',(select jsonb_agg(to_jsonb(p) order by id) from billing_recipient_plans p),
  'overrides',(select jsonb_agg(to_jsonb(o) order by id) from billing_recipient_plan_overrides o),
  'events',(select jsonb_agg(to_jsonb(e) order by id) from billing_unit_events e),
  'operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from billing_operations o)
  ) as value`)).rows[0].value
try {
  await db.exec(`create table customers(id bigint primary key);
    create table projects(id bigint primary key);
    create table contracts(id bigint primary key,project_id bigint references projects(id));
    create table annual_records(id bigint primary key);
    create schema auth;
    create function auth.uid() returns uuid language sql as
      'select nullif(current_setting(''test.actor'',true),'''')::uuid';
    insert into customers values(1),(2),(3); insert into projects values(1);
    insert into contracts values(1,1);
    set test.actor='11111111-1111-4111-8111-111111111111';`)
  await db.transaction(async tx => {
    await tx.exec("set local ageful.allow_draft_migration='yes'")
    for (const name of ['20260907_billing_ownership_foundation.sql','20260907_invoice_write_rpc.sql','20260907_invoice_recipient_plan_rpc.sql']) {
      await tx.exec(readFileSync(new URL('../database/drafts/'+name,import.meta.url),'utf8'))
    }
  })
  await db.exec(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,scheduled_date,original_method,collection_method)
    values(1,1,'next',2026,'2026-12-01','invoice','invoice'),(1,1,'later',2027,'2027-06-01','invoice','invoice');
    insert into billing_units(project_id,contract_id,occurrence_key,service_year,original_method,collection_method,
      recipient_customer_id,recipient_source,lifecycle,issued_on,received_on,collection_state,frozen_amount,frozen_line_items,frozen_at,amount_basis)
    values(1,1,'paid',2025,'invoice','invoice',1,'confirmed','received','2025-06-01','2025-06-10','succeeded',100,
      '[{"name":"保守料","amount":100}]',now(),'operator_confirmed');`)
  const before = await snapshot(), op = key()
  await assert.rejects(write(key(),null,null,{'1':0}), /全ての回/)
  await assert.rejects(write(key(),null,null,{'1':0,'2':0},2,{'3':2}), /未発行/)
  await assert.rejects(write(key(),null,null,{'1':0,'2':0},999), /存在しません/)
  assert.deepEqual(await snapshot(), before)
  const result = await write(op,null,null,{'1':0,'2':0})
  const first = await snapshot(), plan = first.plans[0].id
  assert.deepEqual(first.units.map(u=>u.recipient_customer_id),[1,2,1])
  assert.deepEqual(first.units.map(u=>u.lifecycle),['planned','planned','received'])
  assert.deepEqual(first.units[2],before.units[2], 'Paid history stays byte-for-byte unchanged')
  assert.equal(first.plans[0].effective_from,'2026-12-01')
  assert.equal(first.overrides.length,1)
  assert.equal(first.events.length,2)
  assert.deepEqual((await write(op,null,null,{'1':0,'2':0})).rows,result.rows)
  assert.deepEqual(await snapshot(),first)
  await assert.rejects(write(op,null,null,{'1':0,'2':0},3), /同じ操作ID/)
  await assert.rejects(write(key(),null,null,{'1':1,'2':1}), /指定が更新/)
  await assert.rejects(write(key(),plan,0,{'1':0,'2':1}), /全ての回/)
  // Fail on second audit event, after first unit/event and plan/override writes.
  await db.exec(`create function test_fail_event() returns trigger language plpgsql as $$ begin
    if NEW.billing_unit_id=2 then raise exception 'synthetic audit failure'; end if; return NEW; end $$;
    create trigger test_fail before insert on billing_unit_events for each row execute function test_fail_event();`)
  await assert.rejects(write(key(),plan,0,{'1':1,'2':1},3,{}), /synthetic audit failure/)
  assert.deepEqual(await snapshot(),first,'Entire plan and audit transaction rolled back')
  await db.exec('drop trigger test_fail on billing_unit_events')
  await write(key(),plan,0,{'1':1,'2':1},3,{})
  const second = await snapshot()
  assert.equal(second.plans.filter(p=>p.retired_at===null).length,1)
  assert.deepEqual(second.units.map(u=>u.recipient_customer_id),[3,3,1])
  assert.deepEqual(second.units[2],before.units[2])
  await write(op,null,null,{'1':0,'2':0})
  assert.deepEqual(await snapshot(),second,'Old retry never restores old recipients')
  await db.exec("set test.actor=''")
  await assert.rejects(write(key(),second.plans[1].id,0,{'1':2,'2':2}), /ログイン/)
  assert.equal((await db.query("select has_function_privilege('public','write_invoice_recipient_plan(uuid,bigint,bigint,integer,jsonb,bigint,jsonb)','execute') as allowed")).rows[0].allowed,false)
  await db.exec("set test.actor='11111111-1111-4111-8111-111111111111'")
  await db.query('select write_invoice_unit($1,1,2,$2,$3::jsonb)',[key(),'issue',JSON.stringify({
    recipient_customer_id:3,frozen_amount:100,frozen_line_items:[{name:'保守料',amount:100}],
    scheduled_date:'2026-12-01',issued_on:'2026-12-01',received_on:null,payment_due_on:null,
  })])
  const issued = (await snapshot()).units[0]
  await assert.rejects(write(key(),second.plans[1].id,0,{'1':2,'2':2}), /全ての回/)
  await write(key(),second.plans[1].id,0,{'2':2},2,{})
  const third = await snapshot()
  assert.deepEqual(third.units[0],issued,'Unpaid issued invoice also stays unchanged')
  const active = third.plans.find(p=>p.retired_at===null)
  await db.exec(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,scheduled_date,original_method,collection_method)
    values(1,1,'new-unseen',2028,'2028-06-01','invoice','invoice');`)
  await assert.rejects(write(key(),active.id,0,{'2':3},2,{}), /全ての回/)
  await db.exec(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,scheduled_date,original_method,collection_method)
    values(1,1,'debit',2028,'2028-07-25','direct_debit','direct_debit');`)
  const withDebit = await snapshot()
  await assert.rejects(write(key(),active.id,0,{'2':3,'4':0,'5':0},2,{}), /口座振替/)
  assert.deepEqual(await snapshot(),withDebit)
  console.log('PASS: next A / next-year B, paid preservation, atomic plan+overrides+audit, stale/retry/failure protection')
} finally { await db.close() }
