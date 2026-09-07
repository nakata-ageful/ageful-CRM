// Read-only reconciliation of an approved saved backup with an exported isolated import.
// No .env, DB client, network, file writes or inferred historical billing method.
const fs=require('node:fs')
const {auditBillingBackup,hash,canonicalJson,isMaintenanceOnlyRecord}=require('./review-billing-backup.cjs')
const same=(a,b)=>a!==undefined&&b!==undefined&&hash(a)===hash(b)

async function reconcileBillingImport(data,amountApprovals,recipientApproval,imported){
  // Snapshot inputs before any async work, including caller-supplied approval records.
  const [source,amounts,payer,db]=JSON.parse(JSON.stringify([data,amountApprovals,recipientApproval,imported]))
  const audit=await auditBillingBackup(source,amounts,payer??undefined)
  for(const name of ['billing_units','invoice_import_evidence']){
    if(!Array.isArray(db[name]))throw Error('Missing import snapshot table: '+name)
  }
  const issues=[]
  const add=(code,recordId,unitId)=>issues.push({code,...(recordId===undefined?{}:{recordId}),...(unitId===undefined?{}:{unitId})})
  if(!source.annual_records.length)add('no_source_records')
  const expectedKeys=new Set(),matchedIds=new Set(),expectedByProject=new Map()
  const records=new Map(source.annual_records.map(r=>[r.id,r]))
  const contracts=new Map(source.contracts.map(c=>[c.id,c])),projects=new Map(source.projects.map(p=>[p.id,p]))
  const idSet=new Set()
  for(const u of db.billing_units){
    if(!Number.isSafeInteger(u.id)||u.id<=0||idSet.has(u.id))add('invalid_or_duplicate_unit_id',u.source_annual_record_id,u.id)
    idSet.add(u.id)
  }
  for(const c of audit.rows){
    const key=`${c.recordId}:${c.storageIndex}`;expectedKeys.add(key)
    const record=records.get(c.recordId),contract=contracts.get(c.contractId),project=contract&&projects.get(contract.project_id)
    if(!project){add('invalid_source_link',c.recordId);continue}
    const group=expectedByProject.get(project.id)??{projectId:project.id,expectedUnits:0,matchedUnits:0,expectedAmount:0}
    group.expectedUnits++;if(c.actual&&c.amount!==null)group.expectedAmount+=c.amount
    expectedByProject.set(project.id,group)
    if(!c.recipientConfirmed)add('recipient_not_confirmed',c.recordId)
    if(c.actual&&(c.amount===null||!c.hasLineItems))add('amount_or_items_not_confirmed',c.recordId)
    const matches=db.billing_units.filter(u=>`${u.source_annual_record_id}:${u.source_payment_index}`===key)
    if(matches.length!==1){add(matches.length?'duplicate_source_occurrence':'missing_unit',c.recordId);continue}
    const u=matches[0];matchedIds.add(u.id);group.matchedUnits++
    const part=c.originalPaymentIndex===null?{
      scheduled_date:record.billing_scheduled_date,billing_date:record.billing_date,received_date:record.received_date,
    }:record.payments[c.originalPaymentIndex]
    const state=part.received_date?'received':part.billing_date?'issued':c.actual?'review_required':'planned'
    if(u.project_id!==project.id||u.contract_id!==contract.id||u.service_year!==record.year||u.round_number!==c.seq
      ||u.source_snapshot_hash!==hash(record)||u.occurrence_key!==`legacy:${key}`)add('source_identity_mismatch',c.recordId,u.id)
    if(u.recipient_customer_id!==c.confirmedRecipientId||u.recipient_source!=='confirmed')add('recipient_mismatch',c.recordId,u.id)
    if(u.scheduled_date!==part.scheduled_date||u.issued_on!==part.billing_date||u.received_on!==part.received_date
      ||u.payment_due_on!==(c.originalPaymentIndex===null?record.payment_due_date:null))add('date_mismatch',c.recordId,u.id)
    if(u.lifecycle!==state||u.collection_state!==(part.received_date?'succeeded':'pending'))add('state_mismatch',c.recordId,u.id)
    if(u.original_method!=='invoice'||u.collection_method!=='invoice')add('outside_invoice_rehearsal_scope',c.recordId,u.id)
    const approval=amounts.find(a=>a.recordId===c.recordId&&a.paymentIndex===c.originalPaymentIndex&&a.seq===c.seq)
    const expectedItems=c.actual?(approval?approval.lineItems:(c.originalPaymentIndex===null?record.line_items:null)):null
    if(c.actual){
      if(!Number.isSafeInteger(u.frozen_amount)||u.frozen_amount<0||u.frozen_amount!==c.amount
        ||!expectedItems||!same(u.frozen_line_items,expectedItems)||typeof u.frozen_at!=='string'||!Number.isFinite(Date.parse(u.frozen_at)))
        add('amount_or_items_mismatch',c.recordId,u.id)
    }else if(u.frozen_amount!==null||u.frozen_line_items!==null||u.frozen_at!==null)add('planned_amount_frozen',c.recordId,u.id)
  }
  for(const u of db.billing_units){
    if(!expectedKeys.has(`${u.source_annual_record_id}:${u.source_payment_index}`))add('unexpected_unit',u.source_annual_record_id,u.id)
  }
  for(const record of source.annual_records){
    const expected=audit.rows.filter(r=>r.recordId===record.id)
    const maintenanceOnly=!expected.length&&isMaintenanceOnlyRecord(record)
    if(!expected.length&&!maintenanceOnly){add('retained_only_source_requires_review',record.id);continue}
    const entries=db.invoice_import_evidence.filter(e=>e.source_annual_record_id===record.id)
    if(entries.length!==1){add(entries.length?'duplicate_source_evidence':'missing_source_evidence',record.id);continue}
    const e=entries[0],contract=contracts.get(record.contract_id),project=contract&&projects.get(contract.project_id)
    if(!project||e.project_id!==project.id||!same(e.source_record,record)||e.source_snapshot_hash!==hash(record)
      ||e.source_signature!==canonicalJson(record)
      ||!same(e.project_snapshot,project)||!same(e.contract_snapshot,contract))add('source_evidence_mismatch',record.id)
    const actualIds=db.billing_units.filter(u=>u.source_annual_record_id===record.id).map(u=>u.id).sort((a,b)=>a-b)
    if(maintenanceOnly){
      if(e.receipt?.source_kind!=='maintenance_only'||!same(e.confirmed_payloads,[])||!same(e.receipt?.unit_ids,[])||actualIds.length)
        add('maintenance_preservation_mismatch',record.id)
      continue
    }
    if(e.receipt?.source_kind==='maintenance_only')add('billing_source_marked_maintenance',record.id)
    if(!Array.isArray(e.receipt?.unit_ids)||!same([...e.receipt.unit_ids].sort((a,b)=>a-b),actualIds)
      ||actualIds.length!==expected.length)add('receipt_mismatch',record.id)
    if(!Array.isArray(e.confirmed_payloads)||e.confirmed_payloads.length!==expected.length){add('confirmation_coverage_mismatch',record.id);continue}
    for(const c of expected){
      const confirmed=e.confirmed_payloads.filter(p=>p.row?.source_annual_record_id===record.id&&p.row?.source_payment_index===c.storageIndex)
      if(confirmed.length!==1){add('confirmation_coverage_mismatch',record.id);continue}
      const p=confirmed[0]
      const unit=db.billing_units.find(u=>u.source_annual_record_id===record.id&&u.source_payment_index===c.storageIndex)
      if(p.row.recipient_customer_id!==c.confirmedRecipientId||p.evidence?.recipientBasis!==c.recipientBasis
        ||p.row.frozen_amount!==(c.actual?c.amount:null)||p.evidence?.amountBasis!==c.amountBasis
        ||p.evidence?.datasetId!==audit.datasetId||!same(p.evidence?.sourceRecord,record))add('approval_evidence_mismatch',record.id)
      if(!unit||['project_id','contract_id','source_snapshot_hash','occurrence_key','service_year','round_number',
        'recipient_customer_id','recipient_source','scheduled_date','issued_on','received_on','payment_due_on',
        'lifecycle','collection_state','original_method','collection_method','frozen_amount','frozen_line_items']
        .some(key=>!same(p.row[key],unit[key])))add('confirmed_row_mismatch',record.id)
    }
  }
  for(const e of db.invoice_import_evidence)if(!records.has(e.source_annual_record_id))add('unexpected_source_evidence',e.source_annual_record_id)
  for(const i of audit.recordIssues)add('source_record_requires_review',i.recordId)
  for(const c of audit.rows)if(c.issues.some(i=>!['対象日・対象回要確認'].includes(i)))add('source_candidate_requires_review',c.recordId)
  const total=db.billing_units.reduce((n,u)=>n+(Number.isSafeInteger(u.frozen_amount)?u.frozen_amount:0),0)
  if(!Number.isSafeInteger(total)||total!==audit.knownActualAmount)add('total_amount_mismatch')
  return {
    scope:'承認済みバックアップと取込スナップショットの元対応・金額・請求先照合。過去方法の業務確認・本番切替許可ではありません。',
    datasetId:audit.datasetId,financialSourceChecksPassed:issues.length===0,cutoverReady:false,
    expected:{records:source.annual_records.length,maintenanceOnly:source.annual_records.filter(isMaintenanceOnlyRecord).length,
      units:audit.rows.length,actual:audit.counts.actual,planned:audit.counts.planned,amount:audit.knownActualAmount},
    imported:{units:db.billing_units.length,matchedUnits:matchedIds.size,amount:total},
    projects:[...expectedByProject.values()].sort((a,b)=>a.projectId-b.projectId),issues,
  }
}
module.exports={reconcileBillingImport}
if(require.main===module){
  const files=process.argv.slice(2)
  if(files.length!==4){console.error('Usage: node scripts/reconcile-billing-import.cjs BACKUP.json AMOUNTS.json RECIPIENT.json IMPORT_SNAPSHOT.json');process.exitCode=1}
  else reconcileBillingImport(...files.map(file=>JSON.parse(fs.readFileSync(file,'utf8'))))
    .then(report=>console.log(JSON.stringify(report,null,2))).catch(e=>{console.error(e.message);process.exitCode=1})
}
