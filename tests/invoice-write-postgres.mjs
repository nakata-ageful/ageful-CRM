// Real PostgreSQL engine in isolated WASM memory. No credentials, network or live data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const actor = '11111111-1111-4111-8111-111111111111'
const sql = name => readFileSync(new URL('../database/drafts/' + name, import.meta.url), 'utf8')
let sequence = 0
const key = () => `22222222-2222-4222-8222-${String(++sequence).padStart(12, '0')}`
const value = (changes = {}) => ({ recipient_customer_id: 1, frozen_amount: 82500,
  frozen_line_items: [{ name: '保守料', amount: 82500 }], scheduled_date: '2026-07-15',
  issued_on: '2026-07-15', received_on: null, payment_due_on: null, ...changes })
const write = (op, id, revision, kind, v, reason = null) => db.query(
  'select public.write_invoice_unit($1,$2,$3,$4,$5::jsonb,$6) as unit', [op,id,revision,kind,JSON.stringify(v),reason])
const row = async id => (await db.query('select * from billing_units where id=$1', [id])).rows[0]
const counts = async () => (await db.query(`select
  (select count(*)::int from billing_operations) as operations,
  (select count(*)::int from billing_unit_events) as events`)).rows[0]
try {
  await db.exec(`create table customers(id bigint primary key);
    create table projects(id bigint primary key);
    create table contracts(id bigint primary key, project_id bigint references projects(id));
    create table annual_records(id bigint primary key);
    create schema auth;
    create function auth.uid() returns uuid language sql as
      'select nullif(current_setting(''test.actor'', true), '''')::uuid';
    insert into customers values (1),(2);
    insert into projects values (1),(2);
    insert into contracts values (1,1),(2,2);`)
  // Migration is always executed inside an explicit transaction. Guard failure leaves no tables.
  await assert.rejects(db.transaction(async tx => tx.exec(sql('20260907_billing_ownership_foundation.sql'))), /Draft migration blocked/)
  assert.equal((await db.query("select to_regclass('public.billing_units') as name")).rows[0].name, null)
  await db.transaction(async tx => {
    await tx.exec("set local ageful.allow_draft_migration='yes'")
    await tx.exec(sql('20260907_billing_ownership_foundation.sql'))
    await tx.exec(sql('20260907_invoice_write_rpc.sql'))
  })
  await db.query("select set_config('test.actor',$1,false)", [actor])
  await db.exec(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,original_method,collection_method)
    values (1,1,'invoice-1',2026,'invoice','invoice'),(1,1,'invoice-2',2026,'invoice','invoice');`)
  const initial = await row(1)
  assert.equal(initial.frozen_amount, null, 'Planned amount may remain empty')
  const before = await counts()
  for (const item of [{ name: '保守料' }, { amount: 82500 }, { name: null, amount: 82500 },
    { name: '保守料', amount: null }, { name: '保守料', amount: '82500' }, { name: '', amount: 82500 }]) {
    await assert.rejects(write(key(),1,0,'issue',value({ frozen_line_items: [item] })), /Invalid frozen line item/)
    assert.deepEqual(await row(1), initial)
    assert.deepEqual(await counts(), before, 'Failed validation rolls operation reservation back too')
  }
  await assert.rejects(write(key(),1,0,'issue',value({ frozen_amount: 1 })), /total do not match/)
  await assert.rejects(write(key(),1,0,'issue',value({ recipient_customer_id: 999 })), /foreign key/)
  await assert.rejects(write(key(),1,0,'issue',value({ issued_on: '2026-02-30' })), /out of range/)
  await assert.rejects(write(key(),1,0,'issue',value({ issued_on: null })), /発行日/)
  await assert.rejects(write(key(),1,0,'issue',value({ project_id: 2 })), /変更できない/)
  const incomplete = value(); delete incomplete.received_on
  await assert.rejects(write(key(),1,0,'issue',incomplete), /変更項目が不足/)
  await db.exec("set test.actor=''")
  await assert.rejects(write(key(),1,0,'issue',value()), /ログイン/)
  await db.query("select set_config('test.actor',$1,false)", [actor])
  const issuedKey = key()
  await write(issuedKey,1,0,'issue',value())
  const issued = await row(1)
  assert.equal(issued.lifecycle, 'issued')
  assert.equal(issued.frozen_amount, 82500)
  assert.equal(issued.revision, 1)
  assert.deepEqual(await counts(), { operations: 1, events: 1 })
  await write(issuedKey,1,0,'issue',value())
  assert.deepEqual(await counts(), { operations: 1, events: 1 }, 'Retry writes no duplicate')
  await assert.rejects(write(issuedKey,1,0,'issue',value({ recipient_customer_id: 2 })), /同じ操作ID/)
  await assert.rejects(write(key(),1,0,'correction',value(), '金額訂正'), /情報が更新/)
  await assert.rejects(write(key(),1,1,'correction',value(), '  '), /訂正理由/)
  // Simulate failure after unit UPDATE, when inserting the audit record.
  await db.exec(`create function test_fail_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure'; end$$;
    create trigger test_fail before insert on billing_unit_events for each row execute function test_fail_audit();`)
  await assert.rejects(write(key(),1,1,'correction',value({ recipient_customer_id: 2 }), '請求先訂正'), /synthetic audit failure/)
  assert.deepEqual(await row(1), issued, 'Audit failure rolls back the already-executed unit update')
  assert.deepEqual(await counts(), { operations: 1, events: 1 })
  await db.exec('drop trigger test_fail on billing_unit_events')
  const correctionKey = key()
  const correctedValue = value({ recipient_customer_id: 2, frozen_amount: 82830,
    frozen_line_items: [{ name: '保守料', amount: 82500 }, { name: '再発行手数料', amount: 330 }], received_on: '2026-08-01' })
  await write(correctionKey,1,1,'correction',correctedValue, '第2回の再発行手数料と請求先を訂正')
  const corrected = await row(1)
  assert.equal(corrected.lifecycle, 'received')
  assert.equal(corrected.recipient_customer_id, 2)
  assert.equal(corrected.frozen_amount, 82830)
  const event = (await db.query("select * from billing_unit_events where event_type='corrected'")).rows[0]
  assert.equal(event.before_value.frozen_amount, 82500)
  assert.equal(event.before_value.recipient_customer_id, 1)
  assert.equal(event.after_value.frozen_amount, 82830)
  assert.equal(event.actor_user_id, actor)
  assert.ok(event.recorded_at && event.reason)
  // Retrying the earlier issue after correction must not roll the current invoice back.
  await write(issuedKey,1,0,'issue',value())
  assert.deepEqual(await row(1), corrected)
  assert.deepEqual(await counts(), { operations: 2, events: 2 })
  await assert.rejects(db.exec('update billing_units set frozen_amount=1 where id=1'), /total do not match/)
  await assert.rejects(db.exec('update billing_units set recipient_customer_id=1,revision=revision+1 where id=1'), /履歴を一緒/)
  await assert.rejects(db.exec(`update billing_units set frozen_amount=1,
    frozen_line_items='[{"name":"保守料","amount":1}]',revision=revision+1 where id=1`), /履歴を一緒/)
  await assert.rejects(db.exec("update billing_unit_events set reason='overwrite'"), /append-only/)
  await assert.rejects(db.exec('delete from billing_unit_events'), /append-only/)
  await assert.rejects(db.exec('delete from billing_units'), /append-only/)
  await assert.rejects(db.exec('truncate billing_units cascade'), /append-only/)
  assert.deepEqual(await row(1), corrected)
  // Same expected revision submitted twice, different requests: only one succeeds.
  const competing = await Promise.allSettled([
    write(key(),1,2,'correction',correctedValue,'訂正1'), write(key(),1,2,'correction',correctedValue,'訂正2')])
  assert.equal(competing.filter(x => x.status === 'fulfilled').length, 1)
  assert.equal((await row(1)).revision, 3)
  // Zero is a valid final amount, distinct from an unknown planned amount.
  await write(key(),2,0,'issue',value({ frozen_amount: 0, frozen_line_items: [{ name: '無償', amount: 0 }] }))
  assert.equal((await row(2)).frozen_amount, 0)
  // Full draft -> issued -> received workflow through the same audited RPC.
  await db.exec(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,original_method,collection_method)
    values (1,1,'invoice-3',2027,'invoice','invoice');`)
  const draftKey = key()
  const draftValue = { recipient_customer_id: 2, scheduled_date: '2027-06-15' }
  await write(draftKey,3,0,'plan',draftValue)
  const planned = await row(3)
  assert.equal(planned.lifecycle, 'planned')
  assert.equal(planned.frozen_amount, null)
  assert.equal(planned.issued_on, null)
  assert.equal(planned.recipient_customer_id, 2)
  assert.equal((await db.query("select event_type from billing_unit_events where operation_key=$1", [draftKey])).rows[0].event_type, 'plan_changed')
  await write(draftKey,3,0,'plan',draftValue)
  assert.equal((await row(3)).revision, 1)
  await assert.rejects(write(key(),3,0,'plan',draftValue), /情報が更新/)
  await assert.rejects(write(key(),3,1,'plan',{ ...draftValue, frozen_amount: 99 }), /変更できない/)
  await assert.rejects(write(key(),3,1,'collection',{ received_on: '2027-07-01' }), /この状態/)
  // A draft may still have unknown date/payer; it remains unissued.
  await write(key(),3,1,'plan',{ recipient_customer_id: null, scheduled_date: null })
  assert.equal((await row(3)).recipient_source, 'unconfirmed')
  await write(key(),3,2,'plan',draftValue)
  await write(key(),3,3,'issue',value({ recipient_customer_id: 2, issued_on: '2027-06-15', scheduled_date: '2027-06-15' }))
  const beforeReceipt = await row(3)
  await assert.rejects(write(key(),3,4,'plan',draftValue), /この状態/)
  await assert.rejects(write(key(),3,4,'collection',{ received_on: null }), /入金日/)
  await assert.rejects(write(key(),3,4,'collection',{ received_on: '2027-07-01', recipient_customer_id: 1 }), /変更できない/)
  const beforeFailure = await counts()
  await db.exec('create trigger test_fail before insert on billing_unit_events for each row execute function test_fail_audit()')
  await assert.rejects(write(key(),3,4,'collection',{ received_on: '2027-07-01' }), /synthetic audit failure/)
  assert.deepEqual(await row(3), beforeReceipt)
  assert.deepEqual(await counts(), beforeFailure)
  await db.exec('drop trigger test_fail on billing_unit_events')
  const receiptKey = key()
  await write(receiptKey,3,4,'collection',{ received_on: '2027-07-01' })
  const received = await row(3)
  assert.equal(received.lifecycle, 'received')
  for (const field of ['frozen_amount','frozen_line_items','frozen_at','recipient_customer_id','issued_on','scheduled_date']) {
    assert.deepEqual(received[field], beforeReceipt[field], `Receipt preserves ${field}`)
  }
  await write(receiptKey,3,4,'collection',{ received_on: '2027-07-01' })
  assert.equal((await row(3)).revision, 5)
  await assert.rejects(write(key(),3,5,'collection',{ received_on: '2027-07-02' }), /この状態/)
  assert.equal((await db.query("select count(*)::int as n from billing_unit_events where billing_unit_id=3 and event_type='collection_recorded'")).rows[0].n, 1)
  const fresh = (await db.query(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,
    original_method,collection_method,scheduled_date,recipient_customer_id)
    values(1,1,'cancel-plan',2028,'invoice','invoice','2028-06-01',1) returning id`)).rows[0].id
  const beforeCancel = await row(fresh), cancelCounts=await counts(), cancelKey=key()
  await assert.rejects(write(key(),fresh,0,'cancel',{}), /理由/)
  await assert.rejects(write(key(),fresh,0,'cancel',{recipient_customer_id:2},'予定整理'), /変更できない/)
  await db.exec(`create function test_fail_cancellation() returns trigger language plpgsql as $$ begin
    if NEW.event_type='cancelled' then raise exception 'synthetic cancel failure'; end if; return NEW; end $$;
    create trigger fail_cancel before insert on billing_unit_events for each row execute function test_fail_cancellation();`)
  await assert.rejects(write(key(),fresh,0,'cancel',{},'請求回数変更'), /synthetic cancel failure/)
  assert.deepEqual(await row(fresh),beforeCancel)
  assert.deepEqual(await counts(),cancelCounts)
  await db.exec('drop trigger fail_cancel on billing_unit_events')
  await write(cancelKey,fresh,0,'cancel',{},'請求回数変更')
  const cancelled=await row(fresh)
  assert.equal(cancelled.lifecycle,'cancelled')
  assert.equal(cancelled.collection_state,'not_applicable')
  assert.equal(cancelled.scheduled_date.getTime(),beforeCancel.scheduled_date.getTime())
  assert.equal(cancelled.recipient_customer_id,1)
  await write(cancelKey,fresh,0,'cancel',{},'請求回数変更')
  assert.equal((await row(fresh)).revision,1)
  await assert.rejects(write(key(),fresh,1,'issue',value()), /この状態/)
  await assert.rejects(write(key(),3,5,'cancel',{},'入金済を消す'), /この状態/)
  assert.deepEqual(await row(3),received)
  assert.equal((await db.query("select count(*)::int as n from billing_unit_events where billing_unit_id=$1 and event_type='cancelled'",[fresh])).rows[0].n,1)
  // Neither public execution nor public table access is enabled by these drafts.
  await db.exec('create role test_anon; set role test_anon')
  await assert.rejects(write(key(),1,3,'correction',correctedValue,'権限なし'), /permission denied/)
  await assert.rejects(db.exec('select * from billing_units'), /permission denied/)
  await db.exec('reset role')
  console.log('PASS: PostgreSQL planned save, issuance, receipt, audited correction, strict line items, retry, stale revision, rollback, direct-update rejection, audit immutability and no public access.')
  console.log('PASS: unissued plan retirement keeps source date/payer, requires reason, is atomic/idempotent and cannot cancel paid history')
  console.log('Scope: synthetic in-memory PGlite; Supabase Auth/RLS, multi-session locks, migration and durable restore are NOT tested.')
} finally { await db.close() }
