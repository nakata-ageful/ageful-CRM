// Independent comparison of exported post-commit data. No DB/network connection.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path')
const {buildPlan,tables,canonical,hash}=require('./prepare-active-source-sync.cjs')
function verify(base,old,before,after){
 const plan=buildPlan(base,old,before);assert.equal(plan.conflicts.length,0)
 const same=(a,b,msg)=>assert.ok(canonical(a)===canonical(b),msg)
 const expected=structuredClone(before)
 for(const e of plan.updates)Object.assign(expected[e.table].find(r=>r.id===e.id),e.fields)
 for(const e of plan.inserts)expected[e.table].push(e.row)
 for(const t of tables.filter(t=>!['billing_units','billing_operations','billing_unit_events'].includes(t))){
  const ids=new Set(plan.updates.filter(e=>e.table===t).map(e=>e.id))
  const clean=rows=>rows.map(r=>ids.has(r.id)?Object.fromEntries(Object.entries(r).filter(([k])=>k!=='updated_at')):r).sort((a,b)=>canonical(a).localeCompare(canonical(b)))
  same(clean(after[t]),clean(expected[t]),`Unexpected table or field difference: ${t}`)
 }
 const oldUnits=new Map(before.billing_units.map(u=>[u.id,u])),newUnits=new Map(after.billing_units.map(u=>[u.id,u]))
 assert.equal(after.billing_units.length,before.billing_units.length+plan.external.length)
 for(const [id,u] of oldUnits){const r=plan.receipts.find(e=>e.unit.id===id),n=newUnits.get(id);assert.ok(n,`Missing existing invoice: ${id}`)
  if(!r){same(n,u,`Existing invoice changed: ${id}`);continue}
  const ignore=['received_on','lifecycle','collection_state','revision','updated_at'],clean=u=>Object.fromEntries(Object.entries(u).filter(([k])=>!ignore.includes(k)))
  same(clean(n),clean(u),`Receipt changed unrelated financial or period fields: ${id}`)
  assert.ok(n.received_on===r.source.received_date&&n.lifecycle==='received'&&n.collection_state==='succeeded'&&n.revision===u.revision+1,'Receipt mismatch')
 }
 for(const e of plan.external){const u=after.billing_units.find(u=>u.occurrence_key===e.occurrence);assert.ok(u,'Missing new source invoice')
  const wanted={project_id:e.projectId,contract_id:e.source.contract_id,recipient_customer_id:e.recipientId,service_year:e.source.year,
   frozen_amount:e.amount,frozen_line_items:e.source.line_items,scheduled_date:e.source.billing_scheduled_date,issued_on:e.source.billing_date,
   received_on:e.source.received_date,payment_due_on:e.source.payment_due_date,collection_method:'invoice',original_method:'invoice',lifecycle:'received',collection_state:'succeeded',
   period_start:null,period_end:null,round_number:null,source_snapshot_hash:hash(e.source),amount_basis:'source_record'}
  for(const [k,v] of Object.entries(wanted))same(u[k],v,`New source invoice mismatch: ${k}`)
  const event=after.billing_unit_events.find(ev=>ev.billing_unit_id===u.id&&ev.event_type==='created')
  assert.ok(event,'Missing provenance event');same(event.after_value,u,'Created event differs from stored invoice')
  same(event.before_value.source_record,e.source,'Original external source was not preserved')
 }
 for(const t of ['billing_operations','billing_unit_events']){const key=t==='billing_operations'?'operation_key':'id',m=new Map(after[t].map(r=>[r[key],r]))
  assert.equal(after[t].length,before[t].length+plan.external.length+plan.receipts.length)
  for(const r of before[t])same(m.get(r[key]),r,`Existing audit changed: ${t}`)
 }
 for(const r of plan.receipts){const event=after.billing_unit_events.find(e=>e.billing_unit_id===r.unit.id&&e.event_type==='collection_recorded'&&e.after_value?.received_on===r.source.received_date)
  assert.ok(event,'Missing receipt audit');same(event.before_value,r.unit,'Receipt before-image mismatch');same(event.after_value,newUnits.get(r.unit.id),'Receipt after-image mismatch')}
 return {verified:true,tables:tables.length,updatedContracts:plan.updates.filter(e=>e.table==='contracts').length,
  updatedMaintenance:plan.updates.filter(e=>e.table==='maintenance_responses').length,addedMaintenance:plan.inserts.length,
  updatedReceipts:plan.receipts.length,addedInvoices:plan.external.length,preservedCycleRules:after.billing_cycle_rules.length,
  preservedExistingInvoices:before.billing_units.length,counts:Object.fromEntries(tables.map(t=>[t,after[t].length])),
  beforeSha256:hash(before),afterSha256:hash(after),scope:'Application data JSON; not a full PostgreSQL/Auth/Storage backup'}
}
module.exports={verify}
if(require.main===module){const args=process.argv.slice(2),dir='/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups/'
 assert.ok(args.length===5&&args.every(f=>path.resolve(f).startsWith(dir)),'Private paths required')
 const result=verify(...args.slice(0,4).map(f=>JSON.parse(fs.readFileSync(f))))
 fs.writeFileSync(args[4],JSON.stringify(result,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(result))}
