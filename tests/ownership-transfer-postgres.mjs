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
function transfer(op,before,owner=2,defaultRecipient=2,overrides={'1':1},date='2025-09-01',choices={}){
  const plan=before.billing_recipient_plans.find(p=>p.retired_at===null)
  const versions=Object.fromEntries(before.billing_units.filter(u=>u.lifecycle==='planned').map(u=>[u.id,u.revision]))
  return db.query('select transfer_ownership_inherit($1,1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb) as result',
    [op,owner,date,JSON.stringify(before.projects[0]),JSON.stringify(before.contracts[0]),plan?.id??null,plan?.revision??null,
      JSON.stringify(versions),defaultRecipient,JSON.stringify(overrides),JSON.stringify(choices)])
}
try{
  await db.exec(`create table customers(id bigint primary key,name text not null);
    create table projects(id bigint primary key,customer_id bigint references customers(id),old_owner text,notes text,extra jsonb,sales_price bigint default 100000);
    create table contracts(id bigint primary key,project_id bigint references projects(id),billing_method text,
      ownership_transfer_date date,equipment_contract_date date,annual_maintenance_inc bigint,notes text,extra jsonb,
      sale_contract_date date default '2020-01-01',billing_count integer default 2,
      billing_schedule_days jsonb default '["6月1日","12月1日"]',billing_amount_overrides jsonb,
      billing_item_flags jsonb,has_issuance_fee boolean,issuance_fee_inc bigint);
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
      '20260907_invoice_recipient_plan_rpc.sql','20260907_transfer_detail_choices.sql','20260907_invoice_schedule_rpc.sql','20260907_transfer_ownership_inherit_rpc.sql']){
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
  const choices={project:{notes:{mode:'change',value:'C向けの現場情報'},sales_price:{mode:'change',value:200000}},contract:{notes:{mode:'clear'},
    annual_maintenance_inc:{mode:'change',value:90000},
    billing_amount_overrides:{mode:'change',value:{'2':50000}},
    equipment_contract_date:{mode:'clear'},sale_contract_date:{mode:'clear'}}}
  const invalidChoices=[
    [{project:{customer_id:{mode:'change',value:999}}},/選択できない/],
    [{contract:{billing_method:{mode:'change',value:'口座振替'}}},/追加検証/],
    [{contract:{billing_amount_overrides:{mode:'change',value:{'3':100}}}},/個別金額/],
    [{contract:{billing_amount_overrides:{mode:'change',value:{'2':-1}}}},/個別金額/],
    [{contract:{billing_item_flags:{mode:'change',value:{unknown:true}}}},/フラグ/],
    [{contract:{has_issuance_fee:{mode:'change',value:true}}},/発行手数料/],
    [{contract:{equipment_contract_date:{mode:'clear'}}},/旧売買契約日/],
    [{contract:{equipment_contract_date:{mode:'change',value:'2025-02-30'}}},/out of range/],
    [{project:{notes:{mode:'change',value:123}}},/文字列/],
    [{project:{sales_price:{mode:'change',value:-1}}},/金額/],
    [{project:{sales_price:{mode:'change',value:'200000'}}},/金額/],
    [{project:{notes:{mode:'clear',value:'ignored'}}},/不正/],
    [{project:{'notes = NULL; --':{mode:'clear'}}},/選択できない/],
    [{other:{}},/対象が不正/],
  ]
  for(const [selection,message] of invalidChoices)await assert.rejects(transfer(key(),before,2,2,{},'2025-09-01',selection),message)
  const validate=(c,selection)=>db.query('select prepare_transfer_detail_choices($1::jsonb,$2::jsonb,$3::jsonb)',
    [JSON.stringify(before.projects[0]),JSON.stringify(c),JSON.stringify({contract:selection})])
  await assert.rejects(validate({...before.contracts[0],billing_count:3},{annual_maintenance_inc:{mode:'change',value:90000}}),/回数/)
  await assert.rejects(validate({...before.contracts[0],billing_schedule_days:['2月30日','12月1日']},{annual_maintenance_inc:{mode:'change',value:90000}}),/out of range/)
  await assert.rejects(validate({...before.contracts[0],issuance_fee_inc:9007199254740991,has_issuance_fee:true},
    {annual_maintenance_inc:{mode:'change',value:90000}}),/範囲/)
  await validate(before.contracts[0],{annual_maintenance_inc:{mode:'change',value:0},
    billing_item_flags:{mode:'change',value:{annual_maintenance:false}},billing_amount_overrides:{mode:'clear'}})
  assert.deepEqual(await snapshot(),before)
  // Final history insert fails after both owner and contract update + entire child plan operation.
  await db.exec(`create function test_fail_transfer() returns trigger language plpgsql as $$begin
    raise exception 'synthetic transfer audit failure'; end$$;
    create trigger fail_transfer before insert on ownership_transfers for each row execute function test_fail_transfer();`)
  await assert.rejects(transfer(key(),before,2,2,{},'2025-09-01',choices),/synthetic transfer audit failure/)
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
  await assert.rejects(transfer(firstOp,before,2,2,{'1':1},'2025-09-01',choices),/同じ操作ID/)
  await transfer(key(),first,3,3,{},'2025-10-01',choices)
  const second=await snapshot()
  assert.equal(second.projects[0].customer_id,3)
  assert.equal(second.projects[0].old_owner,'架空B')
  assert.equal(second.projects[0].notes,'C向けの現場情報')
  assert.equal(second.projects[0].sales_price,200000)
  assert.equal(second.contracts[0].notes,null)
  assert.equal(second.contracts[0].equipment_contract_date,null)
  assert.equal(second.contracts[0].sale_contract_date,null)
  assert.equal(second.contracts[0].annual_maintenance_inc,90000)
  assert.deepEqual(second.contracts[0].billing_amount_overrides,{'2':50000})
  assert.equal(second.billing_units.find(u=>u.id===3).frozen_amount,82500,'Contract changes never recalculate paid history')
  const chosenTransfer=second.ownership_transfers.find(t=>t.to_customer_id===3)
  assert.deepEqual(chosenTransfer.contract_before,first.contracts[0])
  assert.deepEqual(chosenTransfer.contract_after,second.contracts[0])
  assert.deepEqual(chosenTransfer.field_decisions.choices,choices)
  assert.equal(chosenTransfer.validation_result.field_edits_applied,true)
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
  assert.equal((await db.query("select has_function_privilege('public','transfer_ownership_inherit(uuid,bigint,bigint,date,jsonb,jsonb,bigint,integer,jsonb,bigint,jsonb,jsonb,jsonb)','execute') as allowed")).rows[0].allowed,false)
  console.log('PASS: inherit-all atomic A→B→C, next A/later B and immediate C, full snapshots, frozen past, unchanged prospect, retry/stale/legacy/access guards')
  console.log('PASS: limited detail changes/clear, original snapshots, strict server allowlist, date/fallback/type/system guards and atomic failure rollback')
  console.log('PASS: unchanged-schedule amount/override edits, count/date/key/flag/fee/overflow validation and frozen past amount preservation')
  console.log('Scope: isolated invoice-only with no legacy records. Method/count/schedule changes, real triggers/RLS, migration and concurrent sessions not verified.')
}finally{await db.close()}
