const assert=require('node:assert/strict')
const {reconcileBillingImport:reconcile}=require('../scripts/reconcile-billing-import.cjs')
const {auditBillingBackup:audit,hash,canonicalJson}=require('../scripts/review-billing-backup.cjs')
const record={id:1,contract_id:1,year:2025,payments:null,status:'請求済',billing_scheduled_date:null,
  billing_date:'2025-06-01',received_date:null,payment_due_date:null,transfer_failed:false,line_items:null}
const second={...record,id:2,line_items:[{name:'保守料',amount:200}]}
const planned={...record,id:3,status:'未入金',billing_date:null,billing_scheduled_date:'2027-06-01'}
const backup={customers:[{id:1},{id:2}],projects:[{id:1,customer_id:1}],contracts:[{id:1,project_id:1,billing_method:'請求書'}],annual_records:[record,second,planned]}
const amounts=[{recordId:1,contractId:1,year:2025,paymentIndex:null,seq:null,sourceRecordHash:hash(record),amount:100,
  lineItems:[{name:'保守料',amount:100}],basis:'架空の確認額'}]
const recipient={datasetHash:hash(backup),mode:'existing_current_customer',basis:'架空の全件請求先確認'}
async function main(){
  const expected=await audit(backup,amounts,recipient)
  const snapshot={billing_units:[],invoice_import_evidence:[]}
  for(const c of expected.rows){
    const r=backup.annual_records.find(r=>r.id===c.recordId)
    const row={id:r.id,source_annual_record_id:r.id,source_payment_index:0,source_snapshot_hash:hash(r),
      project_id:1,contract_id:1,service_year:2025,round_number:null,occurrence_key:`legacy:${r.id}:0`,
      recipient_customer_id:1,recipient_source:'confirmed',scheduled_date:r.billing_scheduled_date,issued_on:r.billing_date,
      received_on:r.received_date,payment_due_on:null,original_method:'invoice',collection_method:'invoice',
      lifecycle:c.actual?'issued':'planned',collection_state:'pending',frozen_amount:c.amount,
      frozen_line_items:c.actual?(r.id===1?amounts[0].lineItems:r.line_items):null,frozen_at:c.actual?'2026-09-07T01:00:00.000Z':null}
    snapshot.billing_units.push(row)
    snapshot.invoice_import_evidence.push({source_annual_record_id:r.id,project_id:1,source_record:r,
      source_snapshot_hash:hash(r),source_signature:canonicalJson(r),project_snapshot:backup.projects[0],contract_snapshot:backup.contracts[0],
      receipt:{unit_ids:[r.id]},confirmed_payloads:[{row,evidence:{sourceRecord:r,datasetId:expected.datasetId,recipientBasis:c.recipientBasis,amountBasis:c.amountBasis,
        methodConfirmation:{originalMethod:'invoice',collectionMethod:'invoice'}}}]})
  }
  const initial=JSON.stringify([backup,amounts,recipient,snapshot])
  const result=await reconcile(backup,amounts,recipient,snapshot)
  assert.equal(result.financialSourceChecksPassed,true)
  assert.equal(result.cutoverReady,false)
  assert.equal(result.expected.units,3)
  assert.equal(result.imported.amount,300)
  assert.equal(result.projects[0].matchedUnits,3)
  assert.equal(JSON.stringify([backup,amounts,recipient,snapshot]),initial)
  const cases=[
    [s=>s.billing_units.pop(),'missing_unit'],
    [s=>s.billing_units.push({...s.billing_units[0],id:10}),'duplicate_source_occurrence'],
    [s=>{s.billing_units[0].frozen_amount=200;s.billing_units[1].frozen_amount=100},'amount_or_items_mismatch'],
    [s=>s.billing_units[0].recipient_customer_id=2,'recipient_mismatch'],
    [s=>s.billing_units[0].scheduled_date='2025-06-01','date_mismatch'],
    [s=>s.billing_units[0].contract_id=2,'source_identity_mismatch'],
    [s=>s.billing_units[0].lifecycle='received','state_mismatch'],
    [s=>s.billing_units[2].frozen_amount=100,'planned_amount_frozen'],
    [s=>s.invoice_import_evidence.pop(),'missing_source_evidence'],
    [s=>s.invoice_import_evidence[0].receipt.unit_ids=[],'receipt_mismatch'],
    [s=>s.invoice_import_evidence[0].project_snapshot={id:1,customer_id:2},'source_evidence_mismatch'],
    [s=>s.invoice_import_evidence[0].confirmed_payloads[0].evidence.recipientBasis='違う確認','approval_evidence_mismatch'],
    [s=>s.invoice_import_evidence[0].confirmed_payloads=[],'confirmation_coverage_mismatch'],
    [s=>s.invoice_import_evidence[0].confirmed_payloads[0].row={...s.billing_units[0],frozen_line_items:[{name:'別の明細',amount:100}]},'confirmed_row_mismatch'],
    [s=>s.billing_units.push({...s.billing_units[0],id:10,source_annual_record_id:999}),'unexpected_unit'],
  ]
  for(const [change,code] of cases){const altered=structuredClone(snapshot);change(altered)
    const report=await reconcile(backup,amounts,recipient,altered)
    assert.equal(report.financialSourceChecksPassed,false,code)
    assert.ok(report.issues.some(i=>i.code===code),code)
  }
  const empty=await reconcile(backup,amounts,recipient,{billing_units:[],invoice_import_evidence:[]})
  assert.equal(empty.issues.filter(i=>i.code==='missing_unit').length,3)
  await assert.rejects(reconcile({...backup,projects:[{id:1,customer_id:2}]},amounts,recipient,snapshot),/Recipient approval/)
  assert.equal((await reconcile(backup,[],recipient,snapshot)).financialSourceChecksPassed,false)
  const maintenance={...planned,id:4,billing_scheduled_date:null,maintenance_record:'保守点検',escort_record:'駆付対応'}
  const combined={...backup,annual_records:[...backup.annual_records,maintenance]}
  const combinedRecipient={...recipient,datasetHash:hash(combined)}
  const combinedAudit=await audit(combined,amounts,combinedRecipient)
  const combinedSnapshot=structuredClone(snapshot)
  for(const e of combinedSnapshot.invoice_import_evidence)for(const p of e.confirmed_payloads)p.evidence.datasetId=combinedAudit.datasetId
  combinedSnapshot.invoice_import_evidence.push({source_annual_record_id:4,project_id:1,source_record:maintenance,
    source_snapshot_hash:hash(maintenance),source_signature:canonicalJson(maintenance),project_snapshot:backup.projects[0],contract_snapshot:backup.contracts[0],
    receipt:{source_kind:'maintenance_only',unit_ids:[]},confirmed_payloads:[]})
  const combinedResult=await reconcile(combined,amounts,combinedRecipient,combinedSnapshot)
  assert.equal(combinedResult.financialSourceChecksPassed,true)
  assert.equal(combinedResult.expected.maintenanceOnly,1)
  assert.equal(combinedResult.expected.units,3)
  assert.equal(combinedResult.cutoverReady,false)
  for(const mutate of [e=>{e.source_record={...maintenance,escort_record:null}},e=>{e.receipt.unit_ids=[4]},
    e=>{e.confirmed_payloads=[{}]},e=>{delete e.receipt.source_kind}]){
    const changed=structuredClone(combinedSnapshot);mutate(changed.invoice_import_evidence[3])
    assert.equal((await reconcile(combined,amounts,combinedRecipient,changed)).financialSourceChecksPassed,false)
  }
  const only={...backup,annual_records:[maintenance]}
  assert.equal((await reconcile(only,[],{...recipient,datasetHash:hash(only)},
    {billing_units:[],invoice_import_evidence:[combinedSnapshot.invoice_import_evidence[3]]})).financialSourceChecksPassed,true)
  const suspicious={...maintenance,payment_due_date:'2027-06-01'}
  const suspiciousBackup={...only,annual_records:[suspicious]}
  assert.equal((await reconcile(suspiciousBackup,[],{...recipient,datasetHash:hash(suspiciousBackup)},
    {billing_units:[],invoice_import_evidence:[]})).financialSourceChecksPassed,false)
  console.log('PASS: mixed invoice/maintenance and maintenance-only reconciliation, no invented bill, changed notes or invalid preservation rejected')
  console.log('PASS: approved whole-backup import reconciliation, exact per-round amounts/payers/items/dates, missing/duplicate/extra units and immutable inputs')
  console.log('PASS: balanced total with swapped per-round amounts is rejected; clean comparison never authorizes production cutover')
}
main().catch(e=>{console.error(e);process.exitCode=1})
