// Read-only local JSON audit. Does not load .env or import application DB modules.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), { createHash, webcrypto } = require('node:crypto')
const root = path.resolve(__dirname, '..'), cache = new Map()
function load(file) {
  file = path.resolve(root, file)
  if (cache.has(file)) return cache.get(file).exports
  if (!/\/src\/lib\/(billing-migration-review|billing-migration-source|billing-json|billing-unit)\.ts$/.test(file)) {
    throw Error('Unapproved audit dependency')
  }
  const module = { exports: {} }; cache.set(file, module)
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText, { module, exports: module.exports, TextEncoder, crypto: webcrypto,
    require: name => {
      if (!name.startsWith('.')) throw Error('External dependency forbidden')
      return load(path.resolve(path.dirname(file), name) + '.ts')
    } })
  return module.exports
}
const { canonicalJson } = load('src/lib/billing-json.ts')
const { reviewBillingMigration } = load('src/lib/billing-migration-review.ts')
const { identifyBillingMigrationSource } = load('src/lib/billing-migration-source.ts')
const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex')

async function auditBillingBackup(data, approvals = []) {
  const tables = {}
  for (const key of ['customers', 'projects', 'contracts', 'annual_records']) {
    if (!Array.isArray(data[key])) throw Error('Missing backup table: ' + key)
    const rows = data[key]
    if (rows.some(r => !Number.isSafeInteger(r.id) || r.id <= 0)
      || new Set(rows.map(r => r.id)).size !== rows.length) throw Error('Invalid/duplicate IDs: ' + key)
    tables[key] = new Map(rows.map(r => [r.id, r]))
  }
  const datasetId = 'backup-sha256-' + hash(data)
  const raw = reviewBillingMigration(datasetId, data.annual_records)
  const confirmations = approvals.map(a => {
    if (!Number.isSafeInteger(a.amount) || a.amount < 0 || typeof a.basis !== 'string' || !a.basis.trim()
      || (a.lineItems !== undefined && (!Array.isArray(a.lineItems) || !a.lineItems.length
        || a.lineItems.some(i => !i || typeof i.name !== 'string' || !i.name.trim() || !Number.isSafeInteger(i.amount) || i.amount < 0)
        || a.lineItems.reduce((sum, i) => sum + i.amount, 0) !== a.amount))) {
      throw Error('Invalid amount approval: ' + a.recordId)
    }
    const r = tables.annual_records.get(a.recordId)
    if (!r || r.contract_id !== a.contractId || r.year !== a.year || hash(r) !== a.sourceRecordHash) {
      throw Error('Approval source mismatch: ' + a.recordId)
    }
    const c = raw.candidates.find(c => c.recordId === a.recordId && c.paymentIndex === a.paymentIndex && c.seq === a.seq)
    if (!c || !c.hasActivity) throw Error('Approval has no matching actual charge: ' + a.recordId)
    return { sourceKey: c.sourceKey, sourceSignature: c.sourceSignature, amount: a.amount,
      lineItems: a.lineItems, amountBasis: a.basis }
  })
  const review = reviewBillingMigration(datasetId, data.annual_records, confirmations)
  const rows = []
  for (const c of review.candidates) {
    const contract = tables.contracts.get(c.contractId)
    const project = contract && tables.projects.get(contract.project_id)
    const owner = project && tables.customers.get(project.customer_id)
    const identity = await identifyBillingMigrationSource(datasetId, c, tables.annual_records.get(c.recordId))
    rows.push({ recordId: c.recordId, contractId: c.contractId, year: c.year, seq: c.seq,
      originalPaymentIndex: c.paymentIndex, storageIndex: identity.columns.source_payment_index,
      actual: c.hasActivity, amount: c.amount, amountBasis: c.amountBasis,
      hasLineItems: !!c.lineItems?.length, hasScheduledDate: !!c.scheduledDate,
      hasIssuedDate: !!c.issuedOn, hasReceivedDate: !!c.receivedOn,
      // Reference only; never write this as historical recipient or method.
      currentOwnerReferenceId: owner?.id ?? null, currentMethodReference: contract?.billing_method ?? null,
      hasOldOwnerReference: !!project?.old_owner, transferDateReference: contract?.ownership_transfer_date ?? null,
      sourceLinksValid: !!(contract && project && owner),
      recipientConfirmed: c.recipientId !== null, issues: c.issues })
  }
  return {
    scope: 'Saved backup only; no live DB, no writes, no inferred historical payer/method',
    datasetId, exportedAt: data.exported_at ?? null, readyToWrite: false,
    counts: { ...review.counts, sourceIdentitiesChecked: rows.length,
      amountApprovalsApplied: confirmations.length, unknownActualAmounts: review.unknownActualCount,
      actualWithoutLineItems: rows.filter(r => r.actual && !r.hasLineItems).length,
      actualWithoutScheduledDate: rows.filter(r => r.actual && !r.hasScheduledDate).length,
      actualWithReceivedDate: rows.filter(r => r.actual && r.hasReceivedDate).length,
      actualIssuedWithoutReceivedDate: rows.filter(r => r.actual && r.hasIssuedDate && !r.hasReceivedDate).length,
      unconfirmedRecipients: rows.filter(r => !r.recipientConfirmed).length,
      invalidSourceLinks: rows.filter(r => !r.sourceLinksValid).length },
    knownActualAmount: review.knownActualAmount, recordIssues: review.recordIssues,
    retainedOnlyIds: review.retainedOnlyIds, rows,
  }
}
module.exports = { auditBillingBackup, hash }
if (require.main === module) {
  const [backupPath, approvalPath] = process.argv.slice(2)
  if (!backupPath) { console.error('Usage: node scripts/review-billing-backup.cjs BACKUP.json [AMOUNT_APPROVALS.json]'); process.exitCode = 1 }
  else auditBillingBackup(JSON.parse(fs.readFileSync(backupPath, 'utf8')),
    approvalPath ? JSON.parse(fs.readFileSync(approvalPath, 'utf8')) : [])
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
