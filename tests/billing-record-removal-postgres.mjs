// Synthetic PostgreSQL only: no environment secrets, hosted DB or real records.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111'
let seq=0;const key=()=>`eeeeeeee-eeee-4eee-8eee-${String(++seq).padStart(12,'0')}`
const read=(folder,name)=>readFileSync(new URL(`../database/${folder}/${name}`,import.meta.url),'utf8')
const rows=async table=>(await db.query(`select to_jsonb(r) v from ${table} r order by id`)).rows.map(r=>r.v)
const unit=async id=>(await rows('billing_units')).find(u=>u.id===id)
const write=(k,r)=>db.query('select billing_runtime_write($1,$2::jsonb) result',[k,JSON.stringify(r)])
const request=async(id,mode='remove',reason='架空検証：重複して登録したため')=>({action:'record_removal',value:{unitId:id,revision:(await unit(id)).revision,mode,reason}})
const facts=u=>Object.fromEntries(Object.entries(u).filter(([k])=>!['removed_at','removal_reason','revision','updated_at'].includes(k)))
const counts=async()=>(await db.query('select (select count(*)::int from billing_operations) operations,(select count(*)::int from billing_unit_events) events')).rows[0]
try{
 await db.exec(`create role authenticated;create role anon;create schema auth;
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
  grant usage on schema public,auth to authenticated,anon;set test.actor='${owner}';
  create table customers(id bigint primary key);create table projects(id bigint primary key,customer_id bigint);
  create table contracts(id bigint primary key,project_id bigint references projects(id),maintenance_start_date date,billing_method text,billing_count integer,billing_schedule_days text[]);
  create table annual_records(id bigint primary key);insert into customers values(1),(2);insert into projects values(1,1);
  insert into contracts values(1,1,'2023-10-27','請求書',1,ARRAY['12月1日']);
  create table ageful_migration_target(project_ref text);insert into ageful_migration_target values('ufawaiddntqqbjhycbxn');`)
 await db.transaction(async tx=>{await tx.exec("set local ageful.allow_draft_migration='yes'");
  for(const name of ['20260907_billing_ownership_foundation.sql','20260907_invoice_write_rpc.sql','20260907_manual_debit_result.sql','20260907_manual_billing_plan.sql','20260914_management_lifecycle.sql','20260914_future_schedule.sql'])await tx.exec(read('drafts',name))})
 for(const t of ['maintenance_responses','periodic_maintenance','prospects','attachments','invoice_import_evidence','invoice_recipient_initializations','billing_migration_acceptances','billing_runtime_control'])await db.exec(`create table if not exists ${t}(id bigint primary key)`)
 await db.exec(`create function assert_billing_runtime_access() returns void language plpgsql security definer as $$begin
  if auth.uid() is distinct from '${owner}'::uuid then raise exception 'Owner only' using errcode='42501';end if;end$$;
  create function billing_runtime_snapshot() returns jsonb language plpgsql security definer as $$begin perform assert_billing_runtime_access();return jsonb_build_object('version',2,'ready',true,'cutover_on','2026-09-27','events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from billing_unit_events e),'units',(select coalesce(jsonb_agg(to_jsonb(u)),'[]') from billing_units u));end$$;
  create function billing_runtime_backup() returns jsonb language plpgsql security definer as $$begin perform assert_billing_runtime_access();return jsonb_build_object('billing_units',(select coalesce(jsonb_agg(to_jsonb(u)),'[]') from billing_units u));end$$;
  create function billing_runtime_write(p_key uuid,p_request jsonb) returns jsonb language plpgsql security definer as $$declare v jsonb:=p_request->'value';begin
   perform assert_billing_runtime_access();
   if p_request->>'action'='invoice' then return write_invoice_unit(p_key,(v->>'unitId')::bigint,(v->>'revision')::integer,v->>'mode',v->'value',v->>'reason');end if;
   if p_request->>'action'='service_period' then return set_billing_service_period(p_key,(v->>'projectId')::bigint,v->'contract',v->'versions',(v->>'year')::integer,(v->>'periodStart')::date,(v->>'periodEnd')::date,v->>'reason');end if;
   if p_request->>'action'='future_schedule' then return create_future_schedule(p_key,(v->>'projectId')::bigint,v->'contract',v->'versions',(v->>'last')::bigint,v->'items',v->>'reason');end if;
   return p_request;end$$;
  grant execute on function billing_runtime_snapshot(),billing_runtime_backup(),billing_runtime_write(uuid,jsonb) to authenticated;
  insert into billing_units(project_id,contract_id,recipient_customer_id,recipient_source,occurrence_key,service_year,round_number,original_method,collection_method,lifecycle,issued_on,received_on,collection_state,frozen_amount,frozen_line_items,frozen_at,amount_basis,period_start,period_end)
  values(1,1,1,'confirmed','duplicate-long',2023,1,'invoice','invoice','received','2023-09-16','2023-09-17','succeeded',187000,'[{"name":"保守料","amount":187000}]',now(),'source_record','2023-10-27','2028-12-31'),
    (1,1,1,'confirmed','real-record',2023,2,'invoice','invoice','received','2023-09-16','2023-09-17','succeeded',187000,'[{"name":"保守料","amount":187000}]',now(),'source_record','2023-10-27','2024-10-26'),
    (1,1,1,'confirmed','debit-record',2025,1,'direct_debit','direct_debit','received',NULL,'2025-11-27','succeeded',0,'[{"name":"保守料","amount":0}]',now(),'operator_confirmed','2025-10-27','2026-10-26');
  insert into billing_units(project_id,contract_id,occurrence_key,service_year,round_number,original_method,collection_method) values(1,1,'planned',2026,1,'invoice','invoice');`)
 await db.exec(read('migrations','20261003_billing_cycle_rules.sql'))
 const before=await rows('billing_units'),migration=read('migrations','20261010083859_billing_record_removal.sql')
 await db.exec("update ageful_migration_target set project_ref='old-app'")
 await assert.rejects(db.exec(migration),/Wrong project/);await db.exec('rollback')
 assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='billing_units' and column_name='removed_at'")).rows[0].n,0)
 await db.exec("update ageful_migration_target set project_ref='ufawaiddntqqbjhycbxn'")
 await db.exec(migration);assert.deepEqual((await rows('billing_units')).map(facts),before.map(facts))
 const old=await unit(1),base=await counts(),r=await request(1),op=key()
 for(const changes of [{reason:' '},{mode:'purge'},{revision:-1},{revision:0.5},{unitId:0},{unitId:1.5},{amount:1}])await assert.rejects(write(key(),{...r,value:{...r.value,...changes}}),/確認/)
 await assert.rejects(write(key(),await request(4)),/実績/);assert.deepEqual(await counts(),base)
 await db.exec(`create function test_fail_removal_event() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure';end$$;
  create trigger test_fail_removal before insert on billing_unit_events for each row execute function test_fail_removal_event()`)
 await assert.rejects(write(key(),r),/synthetic audit failure/);assert.deepEqual(await unit(1),old);assert.deepEqual(await counts(),base)
 await db.exec('drop trigger test_fail_removal on billing_unit_events')
 const removed=(await write(op,r)).rows[0].result
 assert.ok(removed.removed_at);assert.equal(removed.removal_reason,r.value.reason);assert.equal(removed.revision,1);assert.deepEqual(facts(removed),facts(old))
 assert.deepEqual((await write(op,r)).rows[0].result,removed);assert.deepEqual(await counts(),{operations:1,events:1})
 await assert.rejects(write(op,{...r,value:{...r.value,reason:'違う'}}),/同じ操作ID/)
 await assert.rejects(write(key(),r),/更新/);await assert.rejects(write(key(),await request(1)),/削除状態/)
 await assert.rejects(db.exec("update billing_units set plan_note='改変',revision=revision+1 where id=1"),/削除済み/)
 await assert.rejects(db.exec('delete from billing_units where id=1'),/append-only/)
 const invoiceValue={recipient_customer_id:1,frozen_amount:187000,frozen_line_items:[{name:'保守料',amount:187000}],scheduled_date:null,issued_on:'2023-09-16',received_on:'2023-09-17',payment_due_on:null}
 await assert.rejects(write(key(),{action:'invoice',value:{unitId:1,revision:1,mode:'correction',reason:'削除後の訂正',value:invoiceValue}}),/削除済み/)
 const versions=()=>rows('billing_units').then(us=>Object.fromEntries(us.map(u=>[u.id,u.revision])))
 const contract=(await rows('contracts'))[0]
 const period={action:'service_period',value:{projectId:1,contract,versions:await versions(),year:2023,periodStart:'2023-10-27',periodEnd:'2024-12-31',reason:'有効な別回の期間だけ修正'}}
 await write(key(),period);assert.deepEqual(await unit(1),removed);assert.equal((await unit(2)).period_end,'2024-12-31');assert.equal((await unit(2)).revision,1)
 // A deleted long range does not suppress other years or block future inserts.
 await write(key(),{action:'future_schedule',value:{projectId:1,contract,versions:await versions(),last:0,items:[{year:2027,round:1,date:'2027-12-01',method:'invoice',recipientId:1,amount:187000,periodStart:'2027-10-27',periodEnd:'2028-10-26'}],reason:'正当な別期間の予定'}})
 const sameIdentity={action:'future_schedule',value:{projectId:1,contract,versions:await versions(),last:0,items:[{year:2023,round:1,date:'2023-12-01',method:'invoice',recipientId:1,amount:187000,periodStart:'2023-10-27',periodEnd:'2024-12-31'}],reason:'削除済みの再作成は禁止'}}
 await assert.rejects(write(key(),sameIdentity),/二重作成/)
 await write(key(),{action:'cycle_rule',value:{projectId:1,contract,versions:await versions(),expectedRule:0,year:2028,mode:'anniversary',reason:'削除した長期間は将来の繰り返し条件の根拠に使わない'}})
 assert.deepEqual(await unit(1),removed,'Cycle changes preserve the removed snapshot')
 const restoreRequest=await request(1,'restore','正しい記録だったため'),restoreOp=key(),restored=(await write(restoreOp,restoreRequest)).rows[0].result
 assert.equal(restored.removed_at,null);assert.equal(restored.removal_reason,null);assert.deepEqual(facts(restored),facts(old));assert.equal(restored.revision,2)
 assert.deepEqual((await write(op,r)).rows[0].result,removed,'Old successful retry does not re-remove a restored record');assert.deepEqual(await unit(1),restored)
 const debitOriginal=await unit(3);await write(key(),await request(3));const debitRemoved=await unit(3)
 assert.deepEqual(facts(debitRemoved),facts(debitOriginal));await write(key(),await request(3,'restore','0円の振替実績を復元'));assert.deepEqual(facts(await unit(3)),facts(debitOriginal))
 const events=await rows('billing_unit_events'),e=events.find(e=>e.operation_key===op)
 assert.deepEqual(e.before_value,old);assert.deepEqual(e.after_value,removed);assert.equal(e.actor_user_id,owner)
 const ownerRequest=await request(1)
 await db.exec('set role authenticated')
 const snapshot=(await db.query('select billing_runtime_snapshot() s')).rows[0].s
 assert.equal(snapshot.version,3);assert.equal(snapshot.record_removal_ready,true);assert.equal(snapshot.units.length,5)
 assert.ok(snapshot.units.every(u=>'removed_at'in u&&'removal_reason'in u))
 assert.ok((await db.query('select billing_runtime_backup() s')).rows[0].s.billing_units.every(u=>'removed_at'in u))
 await assert.rejects(db.query('select write_billing_record_removal($1,$2::jsonb)',[key(),JSON.stringify(r.value)]),/permission denied/)
 await assert.rejects(db.query('select billing_runtime_snapshot_before_removal()'),/permission denied/)
 await assert.rejects(db.query('select billing_runtime_write_before_removal($1,$2::jsonb)',[key(),JSON.stringify(r)]),/permission denied/)
 await assert.rejects(db.query('update billing_units set removed_at=now() where id=1'),/permission denied/)
 await db.exec("set test.actor='22222222-2222-4222-8222-222222222222'")
 await assert.rejects(write(key(),ownerRequest),/Owner only/)
 // Owner gate on snapshot is independent of row access.
 await assert.rejects(db.query('select billing_runtime_snapshot()'),/Owner only/)
 console.log('PASS: removal/restore preserve financial facts; no live DML; audit+atomic rollback, exact retries, stale/malformed/state rejection, same-year period isolation, future-period compatibility, tombstone dedupe, v3 old-reader gate, private helpers and owner access')
}finally{await db.close()}
