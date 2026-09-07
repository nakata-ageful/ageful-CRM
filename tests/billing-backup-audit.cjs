const assert = require('node:assert/strict')
const { auditBillingBackup: audit, hash } = require('../scripts/review-billing-backup.cjs')
const record = { id: 1, contract_id: 1, year: 2025, payments: null, status: '請求済',
  billing_scheduled_date: null, billing_date: '2025-06-01', received_date: null,
  payment_due_date: null, transfer_failed: false, line_items: null }
const data = { customers: [{ id: 1 }], projects: [{ id: 1, customer_id: 1 }],
  contracts: [{ id: 1, project_id: 1, billing_method: '請求書' }], annual_records: [record] }
const approval = { recordId: 1, contractId: 1, year: 2025, paymentIndex: null, seq: null,
  sourceRecordHash: hash(record), amount: 100, lineItems: [{ name: '保守料', amount: 100 }], basis: 'synthetic confirmation' }
async function main() {
  const original = JSON.stringify(data)
  assert.equal((await audit(data)).counts.unknownActualAmounts, 1)
  const result = await audit(data, [approval])
  assert.equal(result.counts.unknownActualAmounts, 0)
  assert.equal(result.knownActualAmount, 100)
  assert.equal(result.counts.actualWithoutScheduledDate, 1)
  assert.equal(result.rows[0].currentOwnerReferenceId, 1)
  assert.equal(result.rows[0].recipientConfirmed, false)
  assert.equal(result.readyToWrite, false)
  const recipientApproval={datasetHash:hash(data),mode:'existing_current_customer',basis:'Synthetic explicit user approval'}
  const withRecipient=await audit(data,[approval],recipientApproval)
  assert.equal(withRecipient.rows[0].confirmedRecipientId,1)
  assert.equal(withRecipient.counts.unconfirmedRecipients,0)
  assert.equal(withRecipient.knownActualAmount,100)
  assert.equal(withRecipient.counts.amountApprovalsApplied,1)
  assert.equal(withRecipient.readyToWrite,false)
  const changedOwner={...data,projects:[{...data.projects[0],customer_id:2}],customers:[{id:1},{id:2}]}
  await assert.rejects(audit(changedOwner,[approval],recipientApproval),/Recipient approval/)
  await assert.rejects(audit(data,[],{...recipientApproval,basis:''}),/Recipient approval/)
  const broken={...data,customers:[]}
  await assert.rejects(audit(broken,[],{...recipientApproval,datasetHash:hash(broken)}),/broken source/)
  assert.equal(JSON.stringify(data), original)
  await assert.rejects(audit(data, [{ ...approval, sourceRecordHash: '0'.repeat(64) }]), /source mismatch/)
  await assert.rejects(audit(data, [{ ...approval, seq: 2 }]), /matching actual/)
  await assert.rejects(audit(data, [{ ...approval, amount: 200 }]), /Invalid amount/)
  await assert.rejects(audit(data, [{ ...approval, basis: '' }]), /Invalid amount/)
  await assert.rejects(audit(data, [approval, approval]), /確認値/)
  await assert.rejects(audit({ ...data, annual_records: [record, record] }), /duplicate IDs/)
  assert.equal((await audit({ ...data, customers: [] })).counts.invalidSourceLinks, 1)
  const future = { ...record, billing_date: null, billing_scheduled_date: '2027-06-01' }
  await assert.rejects(audit({ ...data, annual_records: [future] }, [{ ...approval, sourceRecordHash: hash(future) }]), /matching actual/)
  console.log('PASS: read-only backup audit, approval fingerprints, no historical payer inference, missing links, future approval rejection')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
