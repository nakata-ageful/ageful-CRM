import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
let sequence=0;const key=()=>`99999999-9999-4999-8999-${String(++sequence).padStart(12,'0')}`
for(const from of ['invoice','direct_debit'])for(const to of ['invoice','direct_debit']){
 const db=new PGlite()
 try{
  await db.exec(`create table customers(id bigint primary key,name text);create table projects(id bigint primary key,customer_id bigint,old_owner text);
   create table contracts(id bigint primary key,project_id bigint,billing_method text,ownership_transfer_date date,notes text);
   create table annual_records(id bigint primary key,contract_id bigint);create schema auth;
   create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
   insert into customers values(1,'A'),(2,'B');insert into projects values(1,1,null);`)
  await db.query('insert into contracts values(1,1,$1,null,$2)',[from==='invoice'?'請求書':'口座振替','Aの備考'])
  await db.transaction(async tx=>{await tx.exec("set local ageful.allow_draft_migration='yes'");for(const f of ['20260907_billing_ownership_foundation.sql','20260907_invoice_write_rpc.sql','20260907_transfer_detail_choices.sql','20260907_manual_billing_plan.sql','20260907_transfer_ownership_manual.sql','20260907_manual_debit_result.sql','20260907_create_manual_debit_plan.sql'])await tx.exec(readFileSync(new URL('../database/drafts/'+f,import.meta.url),'utf8'))})
  await db.query(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,original_method,collection_method,recipient_customer_id,planned_amount)
   values(1,1,'next',2026,$1,$1,1,82500)`,[from])
  await db.exec(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,original_method,collection_method,recipient_customer_id,
    lifecycle,received_on,collection_state,frozen_amount,frozen_line_items,frozen_at)
    values(1,1,'past',2025,'direct_debit','direct_debit',1,'received','2025-06-01','succeeded',82500,'[{"name":"保守料","amount":82500}]',now())`)
  const row=async(id)=>(await db.query('select to_jsonb(u) u from billing_units u where id=$1',[id])).rows[0].u
  const paid=await row(2), project=(await db.query('select to_jsonb(p) p from projects p')).rows[0].p,contract=(await db.query('select to_jsonb(c) c from contracts c')).rows[0].c
  const choice={unitId:'1',expectedRevision:0,recipientId:2,method:to==='invoice'?'請求書':'口座振替',scheduledDate:'2026-12-01',plannedAmount:82500,periodStart:null,periodEnd:null,note:'確認済み'}
  await db.query('select transfer_ownership_manual($1,1,2,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7)',[key(),'2025-09-01',JSON.stringify(project),JSON.stringify(contract),JSON.stringify({contract:{notes:{mode:'clear'}}}),JSON.stringify([choice]),'所有者変更'])
  assert.equal((await db.query('select customer_id from projects')).rows[0].customer_id,2)
  assert.equal((await row(1)).original_method,from);assert.equal((await row(1)).collection_method,to)
  if(to==='invoice'){
   await db.query("select write_invoice_unit($1,1,1,'issue',$2::jsonb)",[key(),JSON.stringify({recipient_customer_id:2,scheduled_date:'2026-12-01',frozen_amount:82500,frozen_line_items:[{name:'保守料',amount:82500}],issued_on:'2026-12-01',received_on:null,payment_due_on:null})])
   await db.query("select write_invoice_unit($1,1,2,'collection',$2::jsonb)",[key(),JSON.stringify({received_on:'2026-12-10'})])
  }else{
   await db.query("select record_manual_debit_result($1,1,1,'received',$2::jsonb,'入金確認')",[key(),JSON.stringify({received_on:'2026-12-01',amount:82500,line_items:[{name:'保守料',amount:82500}]})])
   await db.query("select record_manual_debit_result($1,1,2,'correction',$2::jsonb,'入金日訂正')",[key(),JSON.stringify({received_on:'2026-12-02',amount:82500,line_items:[{name:'保守料',amount:82500}]})])
  }
  assert.equal((await row(1)).lifecycle,'received');assert.equal((await row(1)).recipient_customer_id,2)
  assert.deepEqual(await row(2),paid)
  // Explicit new debit, failed save rollback, idempotency, duplicate month, then edit & receive.
  const createKey=key(),create=()=>db.query('select create_manual_debit_plan($1,1,1,2,2027,1,$2,100,$3,$4) u',[createKey,'2027-01-27','備考','追加確認'])
  await db.exec(`create function fail_created() returns trigger language plpgsql as $$begin if NEW.event_type='created' then raise exception 'created audit failure';end if;return NEW;end$$;
   create trigger fail_created before insert on billing_unit_events for each row execute function fail_created()`)
  await assert.rejects(create(),/created audit failure/)
  assert.equal((await db.query('select count(*)::int n from billing_units')).rows[0].n,2)
  await db.exec('drop trigger fail_created on billing_unit_events')
  const created=(await create()).rows[0].u;assert.deepEqual((await create()).rows[0].u,created)
  await assert.rejects(db.query('select create_manual_debit_plan($1,1,1,2,2027,1,$2,100,$3,$4)',[key(),'2027-01-27','備考','重複']),/すでに/)
  const edit={...choice,unitId:String(created.id),expectedRevision:0,method:'口座振替',scheduledDate:'2027-01-28',plannedAmount:120}
  await db.query('select write_manual_billing_plan($1,1,$2::jsonb,$3)',[key(),JSON.stringify([edit]),'予定変更'])
  await db.query("select record_manual_debit_result($1,$2,1,'received',$3::jsonb,'確認')",[key(),created.id,JSON.stringify({received_on:'2027-01-28',amount:120,line_items:[{name:'保守料',amount:120}]})])
  assert.equal((await row(created.id)).frozen_amount,120)
  assert.deepEqual(await row(2),paid)
  console.log(`PASS: ${from} → ${to}: ownership/contract/plan → actual, old payer retained, new debit creation/edit/receipt and creation rollback`)
 }finally{await db.close()}
}
