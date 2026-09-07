// Synthetic data only. No .env, Supabase, persistent database or network.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
for(const scheduleStorage of ['text[]','jsonb']){
const db=new PGlite()
let sequence=0
const key=()=>`55555555-5555-4555-8555-${String(++sequence).padStart(12,'0')}`
const tables=['projects','contracts','annual_records','billing_units','billing_recipient_plans',
  'billing_recipient_plan_overrides','billing_operations','billing_unit_events','invoice_schedule_changes','ownership_transfers']
async function snapshot(){
  const result={}
  for(const t of tables)result[t]=(await db.query(`select to_jsonb(t) value from ${t} t order by to_jsonb(t)::text`)).rows.map(r=>r.value)
  return result
}
const target=(source_id,round_number,service_year=2100)=>({source_id,service_year,round_number})
function save(op,before,configuration,targets,retire=[],reason='請求回数と予定日を変更'){
  const plan=before.billing_recipient_plans.find(p=>p.retired_at===null)
  const units=Object.fromEntries(before.billing_units.filter(u=>u.lifecycle==='planned').map(u=>[u.id,u.revision]))
  return db.query('select write_invoice_schedule($1,1,1,$2::jsonb,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9) result',
    [op,JSON.stringify(before.contracts[0]),plan.id,plan.revision,JSON.stringify(units),JSON.stringify(configuration),JSON.stringify(targets),JSON.stringify(retire),reason])
}
try{
  await db.exec(`create table customers(id bigint primary key,name text);
    create table projects(id bigint primary key,customer_id bigint references customers(id),old_owner text);
    create table contracts(id bigint primary key,project_id bigint references projects(id),billing_method text,
      billing_count integer,billing_schedule_days ${scheduleStorage},billing_amount_overrides jsonb,
      annual_maintenance_inc bigint,billing_item_flags jsonb,has_issuance_fee boolean,issuance_fee_inc bigint,notes text,ownership_transfer_date date);
    create table annual_records(id bigint primary key,contract_id bigint references contracts(id));
    create schema auth;
    create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''test.actor'',true),'''')::uuid';
    set test.actor='11111111-1111-4111-8111-111111111111';
    insert into customers values(1,'架空A'),(2,'架空B');
    insert into projects values(1,1);
    insert into contracts values(1,1,'請求書',2,${scheduleStorage==='text[]'?"ARRAY['6月1日','12月1日']":"'[\"6月1日\",\"12月1日\"]'"},'{"1":82500}',165000,null,false,null,'購入履歴は保持');`)
  await db.transaction(async tx=>{
    await tx.exec("set local ageful.allow_draft_migration='yes'")
    for(const name of ['20260907_billing_ownership_foundation.sql','20260907_invoice_write_rpc.sql',
      '20260907_transfer_detail_choices.sql','20260907_invoice_schedule_rpc.sql','20260907_invoice_recipient_plan_rpc.sql',
      '20260907_transfer_ownership_inherit_rpc.sql']){
      await tx.exec(readFileSync(new URL('../database/drafts/'+name,import.meta.url),'utf8'))
    }
  })
  await db.exec(`insert into billing_recipient_plans(project_id,default_recipient_customer_id,effective_from) values(1,2,'2100-01-01');
    insert into billing_units(project_id,contract_id,recipient_plan_id,recipient_customer_id,recipient_source,
      occurrence_key,service_year,round_number,scheduled_date,original_method,collection_method)
    values(1,1,1,1,'override','one',2100,1,'2100-06-01','invoice','invoice'),
      (1,1,1,2,'default','two',2100,2,'2100-12-01','invoice','invoice');
    insert into billing_recipient_plan_overrides(project_id,recipient_plan_id,billing_unit_id,recipient_customer_id) values(1,1,1,1);
    insert into billing_units(project_id,contract_id,recipient_customer_id,recipient_source,occurrence_key,service_year,
      original_method,collection_method,lifecycle,issued_on,received_on,collection_state,frozen_amount,frozen_line_items,frozen_at,amount_basis)
    values(1,1,1,'confirmed','past',2099,'invoice','invoice','received','2099-06-01','2099-06-10','succeeded',82500,
      '[{"name":"保守料","amount":82500}]',now(),'source_record');`)
  const before=await snapshot()
  const configuration={billing_count:3,billing_schedule_days:['3月1日','7月1日','11月1日'],billing_amount_overrides:{'2':91000}}
  const targets=[target(null,1),target(1,2),target(null,3)]
  const retire=[{id:2,reason:'この回は取りやめ、新構成の予定を追加'}]
  await db.exec('update billing_recipient_plan_overrides set recipient_customer_id=2 where id=1')
  const inconsistent=await snapshot()
  await assert.rejects(save(key(),inconsistent,configuration,targets,retire),/個別の請求先指定/)
  assert.deepEqual(await snapshot(),inconsistent)
  await db.exec('update billing_recipient_plan_overrides set recipient_customer_id=1 where id=1')
  const rejects=[
    [{...configuration,billing_count:2},targets,retire,/回数/],
    [{...configuration,billing_amount_overrides:{'4':1}},targets,retire,/個別金額/],
    [{...configuration,billing_amount_overrides:{'2':-1}},targets,retire,/個別金額/],
    [{...configuration,billing_amount_overrides:'82500'},targets,retire,/形式/],
    [{...configuration,billing_method:'口座振替'},targets,retire,/明示/],
    [{billing_count:3,billing_schedule_days:configuration.billing_schedule_days},targets,retire,/明示/],
    [{...configuration,billing_schedule_days:['2月29日','7月1日','11月1日']},targets,retire,/out of range/],
    [{...configuration,billing_schedule_days:['3月1日','03月01日','11月1日']},targets,retire,/同日/],
    [configuration,targets,[],/すべて/],
    [configuration,targets,[{id:2,reason:''}],/理由/],
    [configuration,[...targets,target(1,1)],retire,/重複/],
    [configuration,[target(null,1),target(3,2),target(null,3)],retire,/元の未発行/],
    [configuration,[target(null,1),target(999,2),target(null,3)],retire,/元の未発行/],
    [configuration,[target(null,1),target(1,2)],retire,/全回分/],
    [configuration,[{...targets[0],recipient_customer_id:1},...targets.slice(1)],retire,/年度・回/],
    [configuration,[{service_year:2100,round_number:1},...targets.slice(1)],retire,/年度・回/],
    [configuration,[target(null,1),target(1,2,2101),target(null,3)],retire,/元の未発行/],
    [configuration,targets,[{id:1,reason:'重複'},{id:2,reason:'削減'}],/重複/],
  ]
  for(const [config,ts,rs,message] of rejects){
    await assert.rejects(save(key(),before,config,ts,rs),message)
    assert.deepEqual(await snapshot(),before,'Rejected request leaves every table unchanged')
  }
  await assert.rejects(save(key(),before,configuration,targets,retire,''),/理由/)
  const stale=structuredClone(before);stale.contracts[0].notes='古い情報'
  await assert.rejects(save(key(),stale,configuration,targets,retire),/契約が更新/)
  const staleUnit=structuredClone(before);staleUnit.billing_units.find(u=>u.id===1).revision++
  await assert.rejects(save(key(),staleUnit,configuration,targets,retire),/未発行予定が更新/)
  const stalePlan=structuredClone(before);stalePlan.billing_recipient_plans[0].revision++
  await assert.rejects(save(key(),stalePlan,configuration,targets,retire),/請求先指定が更新/)
  // Error at the very end: added/changed/retired units, contract, plan, events and operation all roll back.
  await db.exec(`create function test_fail_schedule() returns trigger language plpgsql as $$begin
    raise exception 'synthetic final audit failure';end$$;
    create trigger fail_schedule before insert on invoice_schedule_changes for each row execute function test_fail_schedule();`)
  await assert.rejects(save(key(),before,configuration,targets,retire),/synthetic final audit failure/)
  assert.deepEqual(await snapshot(),before)
  await db.exec('drop trigger fail_schedule on invoice_schedule_changes')
  const op=key(),receipt=(await save(op,before,configuration,targets,retire)).rows[0].result
  const first=await snapshot(),kept=first.billing_units.find(u=>u.id===1),cancelled=first.billing_units.find(u=>u.id===2)
  assert.deepEqual(first.contracts[0],{...before.contracts[0],...configuration})
  assert.equal(kept.recipient_customer_id,1)
  assert.equal(kept.occurrence_key,'one')
  assert.equal(kept.round_number,2)
  assert.equal(kept.scheduled_date,'2100-07-01')
  assert.equal(kept.frozen_amount,null)
  assert.equal(cancelled.lifecycle,'cancelled')
  assert.equal(cancelled.scheduled_date,'2100-12-01')
  assert.deepEqual(first.billing_units.find(u=>u.id===3),before.billing_units.find(u=>u.id===3))
  assert.deepEqual(first.billing_recipient_plan_overrides,before.billing_recipient_plan_overrides)
  const added=first.billing_units.filter(u=>!before.billing_units.some(old=>old.id===u.id))
  assert.equal(added.length,2)
  assert.ok(added.every(u=>u.recipient_customer_id===2&&u.frozen_amount===null&&u.recipient_source==='default'))
  assert.equal(first.billing_recipient_plans[0].revision,1)
  assert.equal(first.billing_unit_events.length,4)
  assert.deepEqual(first.invoice_schedule_changes[0].contract_before,before.contracts[0])
  assert.deepEqual(first.invoice_schedule_changes[0].contract_after,first.contracts[0])
  assert.deepEqual((await save(op,before,configuration,targets,retire)).rows[0].result,receipt)
  assert.deepEqual(await snapshot(),first)
  await assert.rejects(save(op,before,configuration,targets,retire,'違う理由'),/同じ操作ID/)
  const reduced={billing_count:1,billing_schedule_days:['12月1日'],billing_amount_overrides:null}
  await save(key(),first,reduced,[target(1,1)],added.map(u=>({id:u.id,reason:'年1回に変更'})))
  const second=await snapshot()
  assert.equal(second.billing_units.filter(u=>u.lifecycle==='planned').length,1)
  assert.equal(second.billing_units.find(u=>u.id===1).recipient_customer_id,1)
  assert.deepEqual(second.invoice_schedule_changes.find(x=>x.operation_key===op),first.invoice_schedule_changes[0])
  await save(op,before,configuration,targets,retire)
  assert.deepEqual(await snapshot(),second,'Old retry does not undo a later schedule change')
  // Ownership + schedule + new-round exception must be ONE transaction.
  const schedule={configuration:{billing_count:2,billing_schedule_days:['5月1日','12月1日'],billing_amount_overrides:{'2':91000}},
    targets:[target(null,1),target(1,2)],retire:[],reason:'所有者変更と同時に年2回へ変更',new_recipient_overrides:{'2100:1':1}}
  const choices={contract:{notes:{mode:'change',value:'Bの契約備考'},annual_maintenance_inc:{mode:'change',value:180000}}}
  const transfer=(operation,s=second,change=schedule,overrides={})=>{
    const plan=s.billing_recipient_plans.find(p=>p.retired_at===null)
    return db.query('select transfer_ownership_inherit($1,1,2,current_date,$2::jsonb,$3::jsonb,$4,$5,$6::jsonb,2,$7::jsonb,$8::jsonb,$9::jsonb) result',
      [operation,JSON.stringify(s.projects[0]),JSON.stringify(s.contracts[0]),plan.id,plan.revision,
        JSON.stringify(Object.fromEntries(s.billing_units.filter(u=>u.lifecycle==='planned').map(u=>[u.id,u.revision]))),
        JSON.stringify(overrides),JSON.stringify(choices),JSON.stringify(change)])
  }
  await assert.rejects(transfer(key(),second,{...schedule,new_recipient_overrides:{'2100:2':1}}),/追加回/)
  await assert.rejects(transfer(key(),second,{...schedule,new_recipient_overrides:{'2100:1':999}}),/請求先が存在/)
  await assert.rejects(transfer(key(),second,schedule,{'999':1}),/確認した回ID/)
  assert.deepEqual(await snapshot(),second)
  await db.exec(`create function fail_combined_transfer() returns trigger language plpgsql as $$begin
    raise exception 'synthetic combined transfer failure';end$$;
    create trigger fail_combined before insert on ownership_transfers for each row execute function fail_combined_transfer();`)
  await assert.rejects(transfer(key()),/synthetic combined transfer failure/)
  assert.deepEqual(await snapshot(),second,'Owner, new schedule, added round, payer exceptions, choices and every audit all roll back')
  await db.exec('drop trigger fail_combined on ownership_transfers')
  const combinedOp=key(),combinedReceipt=(await transfer(combinedOp)).rows
  const combined=await snapshot(),newRound=combined.billing_units.find(u=>u.lifecycle==='planned'&&u.round_number===1)
  assert.equal(combined.projects[0].customer_id,2)
  assert.equal(combined.projects[0].old_owner,'架空A')
  assert.equal(newRound.recipient_customer_id,1,'A may receive the newly created next round')
  assert.equal(combined.billing_units.find(u=>u.id===1).recipient_customer_id,2,'Following retained round uses B')
  assert.deepEqual(combined.contracts[0].billing_amount_overrides,{'2':91000})
  assert.equal(combined.contracts[0].annual_maintenance_inc,180000)
  assert.equal(combined.contracts[0].notes,'Bの契約備考')
  assert.deepEqual(combined.billing_units.find(u=>u.id===3),before.billing_units.find(u=>u.id===3))
  assert.deepEqual(combined.ownership_transfers[0].contract_before,second.contracts[0])
  assert.deepEqual(combined.ownership_transfers[0].contract_after,combined.contracts[0])
  assert.equal(combined.billing_operations.length-second.billing_operations.length,3)
  assert.deepEqual((await transfer(combinedOp)).rows,combinedReceipt)
  assert.deepEqual(await snapshot(),combined)
  await assert.rejects(transfer(combinedOp,second,{...schedule,new_recipient_overrides:{}}),/同じ操作ID/)
  // A paid occurrence in a target year must not be silently mixed into a new annual divisor.
  await db.exec(`insert into billing_units(project_id,contract_id,recipient_customer_id,recipient_source,occurrence_key,service_year,
    original_method,collection_method,lifecycle,issued_on,frozen_amount,frozen_line_items,frozen_at,amount_basis)
    values(1,1,1,'confirmed','already-issued',2100,'invoice','invoice','issued','2100-01-01',82500,
      '[{"name":"保守料","amount":82500}]',now(),'source_record')`)
  const withIssued=await snapshot()
  const remainingTargets=[target(newRound.id,1),target(1,2)]
  await assert.rejects(save(key(),withIssued,schedule.configuration,remainingTargets),/発行済み等がある年度/)
  assert.deepEqual(await snapshot(),withIssued)
  await db.exec('insert into annual_records values(1,1)')
  const withLegacy=await snapshot()
  await assert.rejects(save(key(),withLegacy,schedule.configuration,remainingTargets),/旧年度記録/)
  assert.deepEqual(await snapshot(),withLegacy)
  for(const sql of ["update invoice_schedule_changes set schema_version=2","delete from invoice_schedule_changes","truncate invoice_schedule_changes"]){
    await assert.rejects(db.exec(sql),/append-only/)
  }
  await db.exec("set test.actor=''")
  await assert.rejects(save(key(),withLegacy,reduced,[target(1,1)]),/ログイン/)
  assert.equal((await db.query("select has_function_privilege('public','write_invoice_schedule(uuid,bigint,bigint,jsonb,bigint,integer,jsonb,jsonb,jsonb,jsonb,text)','execute') allowed")).rows[0].allowed,false)
  console.log('PASS: atomic schedule/contract/add/retire/audit, stable payer and occurrence, explicit overrides, full rollback, retry and stale guards')
  console.log(`PASS: complete-year coverage, leap dates, duplicate/unknown targets, immutable history, issued-year/legacy/auth guards; ${scheduleStorage} schedule conversion`)
  console.log('PASS: combined ownership/schedule/field choices, new next-round A/following B, whole-operation final-failure rollback and stable retry')
  console.log('Scope: isolated whole unissued invoice years only. No production, UI, cutover, same-year issued restructuring or multi-session verification.')
}finally{await db.close()}
}
