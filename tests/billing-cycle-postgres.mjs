// Isolated synthetic Postgres only. No .env, hosted DB, credentials or network.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
for(const scheduleStorage of ['text[]','jsonb']){
const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111'
let seq=0;const key=()=>`cccccccc-cccc-4ccc-8ccc-${String(++seq).padStart(12,'0')}`
const rows=async t=>(await db.query(`select to_jsonb(t) value from ${t} t order by id`)).rows.map(r=>r.value)
const contract=async()=>(await rows('contracts'))[0]
const versions=async()=>Object.fromEntries((await rows('billing_units')).map(u=>[u.id,u.revision]))
const latest=async()=>Math.max(0,...(await rows('billing_cycle_rules')).map(r=>r.id))
const request=async(year=2027,mode='calendar_prepaid')=>({action:'cycle_rule',value:{projectId:1,contract:await contract(),versions:await versions(),expectedRule:await latest(),year,mode,reason:'架空検証：移行期間を確認して暦年・前年12月請求へ'}})
const write=(id,r)=>db.query('select billing_runtime_write($1,$2::jsonb) result',[id,JSON.stringify(r)])
try{
  await db.exec(`create role authenticated;create role anon;create schema auth;
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    grant usage on schema public,auth to authenticated,anon;set test.actor='${owner}';
    create table customers(id bigint primary key);create table projects(id bigint primary key,customer_id bigint);
    create table contracts(id bigint primary key,project_id bigint references projects(id),maintenance_start_date date,billing_method text,billing_count integer,billing_schedule_days ${scheduleStorage});
    create table annual_records(id bigint primary key);
    insert into customers values(1);insert into projects values(1,1);
    insert into contracts values(1,1,'2023-08-01','請求書',1,${scheduleStorage==='text[]'?"ARRAY['12月1日']":"'[\"12月1日\"]'::jsonb"});
    create table ageful_migration_target(project_ref text);insert into ageful_migration_target values('old-project');`)
  await db.transaction(async tx=>{await tx.exec("set local ageful.allow_draft_migration='yes'");
    for(const f of ['20260907_billing_ownership_foundation.sql','20260907_manual_billing_plan.sql','20260914_management_lifecycle.sql','20260914_future_schedule.sql'])
      await tx.exec(readFileSync(new URL('../database/drafts/'+f,import.meta.url),'utf8'))})
  for(const t of ['maintenance_responses','periodic_maintenance','prospects','attachments','invoice_import_evidence','invoice_recipient_initializations','billing_migration_acceptances','billing_runtime_control'])await db.exec(`create table if not exists ${t}(id bigint primary key)`)
  await db.exec(`create function assert_billing_runtime_access() returns void language plpgsql security definer as $$begin
    if auth.uid() is distinct from '${owner}'::uuid then raise exception 'Owner only' using errcode='42501';end if;end$$;
    create function billing_runtime_snapshot() returns jsonb language plpgsql security definer as $$begin perform assert_billing_runtime_access();return jsonb_build_object('version',2,'ready',true,'cutover_on','2026-09-27','events','[]'::jsonb,'transfers','[]'::jsonb,'management_events','[]'::jsonb,'units',(select coalesce(jsonb_agg(to_jsonb(u)),'[]') from billing_units u));end$$;
    create function billing_runtime_backup() returns jsonb language plpgsql security definer as $$begin perform assert_billing_runtime_access();return jsonb_build_object('version',2,'billing_units',(select coalesce(jsonb_agg(to_jsonb(u)),'[]') from billing_units u));end$$;
    alter function create_future_schedule(uuid,bigint,jsonb,jsonb,bigint,jsonb,text) security definer;
    create function billing_runtime_write(p_key uuid,p_request jsonb) returns jsonb language plpgsql security definer as $$declare v jsonb:=p_request->'value';begin perform assert_billing_runtime_access();if p_request->>'action'='future_schedule' then return create_future_schedule(p_key,(v->>'projectId')::bigint,v->'contract',v->'versions',(v->>'last')::bigint,v->'items',v->>'reason');end if;return p_request;end$$;
    grant execute on function billing_runtime_write(uuid,jsonb),billing_runtime_snapshot(),billing_runtime_backup() to authenticated;
    insert into billing_units(project_id,contract_id,recipient_customer_id,recipient_source,occurrence_key,service_year,original_method,collection_method,lifecycle,issued_on,received_on,collection_state,frozen_amount,frozen_line_items,frozen_at,amount_basis,period_start,period_end)
    values(1,1,1,'confirmed','transition',2026,'invoice','invoice','received','2026-07-01','2026-07-11','succeeded',68750,'[{"name":"保守料","amount":68750}]',now(),'source_record','2026-08-01','2026-12-31');`)
  const migration=readFileSync(new URL('../database/migrations/20261003_billing_cycle_rules.sql',import.meta.url),'utf8'),paid=await rows('billing_units'),originalContract=await contract()
  await assert.rejects(db.exec(migration),/Wrong project/);await db.exec('rollback')
  assert.equal((await db.query("select to_regclass('billing_cycle_rules') value")).rows[0].value,null)
  await db.exec("update ageful_migration_target set project_ref='ufawaiddntqqbjhycbxn'");await db.exec(migration)
  assert.deepEqual(await rows('billing_units'),paid);assert.deepEqual(await contract(),originalContract);assert.deepEqual(await rows('billing_cycle_rules'),[])
  const beforeOps=()=>db.query('select count(*)::integer n from billing_operations')
  const malformed=await request();malformed.value.year=2027.5
  await assert.rejects(write(key(),malformed),/入力/)
  const stale=await request();stale.value.expectedRule=99;await assert.rejects(write(key(),stale),/更新/)
  const outdated=await request();outdated.value.contract.billing_count=2;await assert.rejects(write(key(),outdated),/契約/)
  await db.exec("begin;update contracts set billing_count=2");await assert.rejects(write(key(),await request()),/年1回/);await db.exec('rollback')
  await db.exec("begin;update billing_units set period_end='2027-07-31'");await assert.rejects(write(key(),await request()),/重な/);await db.exec('rollback')
  await db.exec(`create function fail_cycle_test() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure';end$$;
    create trigger fail_cycle before insert on billing_cycle_rules for each row execute function fail_cycle_test()`)
  const n=(await beforeOps()).rows[0].n;await assert.rejects(write(key(),await request()),/synthetic audit failure/)
  assert.equal((await beforeOps()).rows[0].n,n);assert.deepEqual(await rows('billing_cycle_rules'),[]);await db.exec('drop trigger fail_cycle on billing_cycle_rules')
  const op=key(),r=await request(),receipt=(await write(op,r)).rows[0].result
  assert.equal(receipt.effective_year,2027);assert.deepEqual(await rows('billing_units'),paid);assert.deepEqual(await contract(),originalContract)
  assert.deepEqual((await write(op,r)).rows[0].result,receipt);assert.equal((await rows('billing_cycle_rules')).length,1)
  await assert.rejects(write(op,{...r,value:{...r.value,reason:'違う確認'}}),/同じ操作ID/)
  const future=await request();const add={action:'future_schedule',value:{projectId:1,contract:future.value.contract,versions:future.value.versions,last:0,cycleRevision:future.value.expectedRule,reason:'翌年の保守期間分を前年12月に請求する架空検証',items:[{year:2027,round:1,method:'invoice',recipientId:1,periodStart:'2027-01-01',periodEnd:'2027-12-31',date:'2026-12-01',amount:165000}]}}
  await assert.rejects(write(key(),{...add,value:{...add.value,cycleRevision:0}}),/繰り返し設定が更新/)
  await assert.rejects(write(key(),{...add,value:{...add.value,items:[{...add.value.items[0],year:2026,periodStart:'2026-08-01',periodEnd:'2027-07-31'}]}}),/次の保守期間と重な/)
  const addOp=key(),added=(await write(addOp,add)).rows[0].result
  assert.equal(added[0].scheduled_date,'2026-12-01');assert.equal(added[0].service_year,2027);assert.equal(added[0].period_start,'2027-01-01');assert.deepEqual((await rows('billing_units'))[0],paid[0])
  const next=await request(2028,'anniversary');await write(key(),next)
  assert.deepEqual((await write(addOp,add)).rows[0].result,added,'An old successful retry survives a later rule change')
  assert.deepEqual((await write(op,r)).rows[0].result,receipt,'Old rule retries do not revert later rules')
  await assert.rejects(db.exec("update billing_cycle_rules set reason='改変'"),/変更・削除/);await assert.rejects(db.exec('truncate billing_cycle_rules'),/変更・削除/)
  await db.exec('set role authenticated')
  const snapshot=(await db.query('select billing_runtime_snapshot() s')).rows[0].s
  assert.equal(snapshot.cycle_rules_ready,true);assert.equal(snapshot.cycle_rules.length,2);assert.equal(snapshot.events[0].event_type,'cycle_rule_changed')
  assert.equal((await db.query('select billing_runtime_backup() s')).rows[0].s.billing_cycle_rules.length,2)
  await assert.rejects(db.query('select * from billing_cycle_rules'),/permission denied/)
  await assert.rejects(db.query('select billing_runtime_snapshot_before_cycles()'),/permission denied/)
  await assert.rejects(db.query('select write_billing_cycle_rule($1,$2::jsonb)',[key(),JSON.stringify(r.value)]),/permission denied/)
  await db.exec("set test.actor='22222222-2222-4222-8222-222222222222'")
  await assert.rejects(db.query('select billing_runtime_snapshot()'),/Owner only/);await assert.rejects(write(key(),r),/Owner only/)
  await db.exec('reset role');assert.deepEqual((await rows('billing_units'))[0],paid[0]);assert.deepEqual(await contract(),originalContract)
  console.log('PASS: new-DB-only additive migration, unchanged business rows, real prepayment insert, overlap/config/stale rejection, atomic rollback, immutable audit, exact retries, private helpers, owner-only snapshot/backup')
}finally{await db.close()}
}
