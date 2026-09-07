// Synthetic fixtures only. No .env, filesystem writes, DB or network calls.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = path.resolve(__dirname, '..'), cache = new Map()
function load(file) {
  file = path.resolve(root, file)
  if (cache.has(file)) return cache.get(file).exports
  if (/\/(actions|data|supabase|mock-store)\.ts$/.test(file)) throw Error('DB dependency forbidden')
  const module = { exports: {} }; cache.set(file, module)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, Date, Map, Set,
    require: name => {
      if (!name.startsWith('.')) throw Error('External module forbidden: ' + name)
      return load(path.resolve(path.dirname(file), name) + '.ts')
    },
  })
  return module.exports
}
const { canonicalJson, copyJson } = load('src/lib/billing-json.ts')
const { executeLocalBillingCommand: execute, localCustomerBillingHistory: history } = load('src/lib/local-billing-ledger.ts')
const { reviewBillingMigration: review } = load('src/lib/billing-migration-review.ts')
const { recipientForUnit } = load('src/lib/billing-unit.ts')
const plain = value => JSON.parse(JSON.stringify(value))
const timestamp = '2026-09-05T12:00:00Z'
const unit = (id, changes = {}) => ({ id, projectId: 1, serviceYear: 2027, roundLabel: '第1回', method: '請求書',
  scheduledDate: '2027-06-01', recipientId: 1, lifecycle: 'planned', issuedOn: null, receivedOn: null,
  frozenAmount: null, frozenLineItems: null, frozenAt: null, revision: 1, ...changes })
const ledger = () => ({ current: { projectId: 1, ownerId: 1, revision: 1, customerIds: [1, 2, 3],
  contract: { id: 1, project_id: 1, annual_maintenance_inc: 100000, notes: '元の備考', future_field: { nested: ['全項目コピー'] } },
  plan: { projectId: 1, defaultRecipientId: 1, overrides: {} }, plannedAmount: 100000,
  units: [unit('past', { serviceYear: 2026, lifecycle: 'issued', issuedOn: '2026-06-01', frozenAmount: 100000,
    frozenAt: '2026-06-01T00:00:00Z', frozenLineItems: [{ name: '保守料', amount: 100000 }] }),
    unit('next'), unit('later', { serviceYear: 2028, scheduledDate: '2028-06-01' })],
}, events: [] })
const transfer = { kind: 'transfer', requestId: 'test-transfer-1', expectedRevision: 1, newOwnerId: 2,
  transferDate: '2026-09-05', plan: { projectId: 1, defaultRecipientId: 2, overrides: { next: 1 } }, expectedUnits: { next: 1, later: 1 } }
const before = ledger(), original = canonicalJson(before)
const first = execute(before, transfer, timestamp)
assert.equal(canonicalJson(before), original)
assert.equal(first.current.ownerId, 2)
assert.deepEqual(plain(first.current.units.map(u => u.recipientId)), [1, 1, 2])
assert.equal(first.events.length, 1)
assert.equal(first.events[0].before.ownerId, 1)
assert.equal(first.events[0].after.ownerId, 2)
assert.equal(first.events[0].before.contract.future_field.nested[0], '全項目コピー')
assert.equal(first.events[0].schemaVersion, 1)
assert.equal('diff' in first.events[0], false)
assert.equal(history(first, 1).length, 1, 'Old customer history independent of current owner')
assert.equal(history(first, 2).length, 0, 'Plans are not history')
assert.equal(recipientForUnit(unit('constructor'), first.current.plan), 2, 'No inherited-property recipient lookup')
assert.equal(execute(first, transfer, timestamp).events.length, 1, 'Retry not duplicated')
assert.throws(() => execute(first, { ...transfer, newOwnerId: 3 }, timestamp), /同じ操作ID/)
const changed = execute(first, { kind: 'change-estimate', requestId: 'estimate', expectedRevision: 2, amount: 120000 }, timestamp)
assert.equal(changed.events[0].after.plannedAmount, 100000, 'Old snapshot stays at old amount')
assert.equal(changed.events[0].after.contract.annual_maintenance_inc, 100000)
assert.equal(changed.current.contract.annual_maintenance_inc, 100000, 'Estimate preview cannot rewrite the contract snapshot')
assert.equal(changed.current.units[0].frozenAmount, 100000)
assert.equal(execute(changed, transfer, timestamp).current.revision, 3, 'Old retry must not rewind newer writes')
assert.throws(() => execute(changed, { ...transfer, requestId: 'stale', newOwnerId: 3 }, timestamp), /更新/)
const second = execute(changed, { ...transfer, requestId: 'test-transfer-2', expectedRevision: 3, newOwnerId: 3,
  plan: { projectId: 1, defaultRecipientId: 3, overrides: { next: 1 } }, expectedUnits: { next: 2, later: 2 } }, timestamp)
assert.equal(second.events[0].before.ownerId, 1)
assert.equal(second.events[0].after.ownerId, 2)
assert.equal(second.events[2].before.ownerId, 2)
assert.equal(second.events[2].after.ownerId, 3)
assert.equal(second.current.units[0].recipientId, 1)
assert.equal(history(second, 1).length, 1)

// Mutating any returned/input copy cannot change a previous snapshot or another ledger.
const altered = copyJson(second)
altered.current.contract.future_field.nested[0] = '変更'
assert.equal(altered.events[0].before.contract.future_field.nested[0], '全項目コピー')
first.current.units[0].frozenAmount = 999
assert.equal(second.current.units[0].frozenAmount, 100000)
assert.equal(before.current.units[0].frozenAmount, 100000)
const lateFailure = { ...transfer, extra: undefined }
assert.throws(() => execute(before, lateFailure, timestamp), /JSON以外/)
assert.equal(canonicalJson(before), original, 'Late serialization failure leaves all values/history untouched')
for (const newOwnerId of [1, 999]) assert.throws(() => execute(before, { ...transfer, newOwnerId }, timestamp), /所有者/)
assert.throws(() => execute(before, { ...transfer, plan: { ...transfer.plan, defaultRecipientId: 999 } }, timestamp), /請求先/)
assert.throws(() => execute(before, { ...transfer, transferDate: '2026-02-30' }, timestamp), /変更日/)
const debit = ledger(); debit.current.units.push(unit('august', { method: '口座振替', lifecycle: 'fixed', frozenAmount: 10000 }))
assert.equal(execute(debit, transfer, timestamp).current.units.at(-1).recipientId, 1)
debit.current.units.push(unit('future-debit', { method: '口座振替' }))
assert.throws(() => execute(debit, transfer, timestamp), /固定ルール/)
const issued = execute(second, { kind: 'issue', requestId: 'issue', expectedRevision: 4, unitId: 'next', expectedUnitRevision: 3, issuedOn: '2027-06-01' }, timestamp)
assert.equal(issued.current.units[1].frozenAmount, 120000)
assert.equal(issued.current.units[1].lifecycle, 'issued')
assert.equal(issued.current.units[1].recipientId, 1)
assert.equal(history(issued, 1).length, 2)
assert.equal(issued.current.plan.overrides.next, undefined)
assert.throws(() => execute(issued, { kind: 'issue', requestId: 'issue-again', expectedRevision: 5, unitId: 'next', expectedUnitRevision: 4, issuedOn: '2027-06-01' }, timestamp), /発行できません/)
const grown = execute(issued, { kind: 'add-plan', requestId: 'add', expectedRevision: 5, unit: unit('year2029', { serviceYear: 2029 }) }, timestamp)
assert.equal(grown.current.units.at(-1).recipientId, 3)

// Synthetic source structures reflect D-018 amounts; not copies of production rows/invoices.
const pay = (seq, year, active = true) => ({ seq, scheduled_date: active ? `${year}-${seq === 1 ? '06' : '12'}-01` : null,
  billing_date: active ? `${year}-${seq === 1 ? '06' : '12'}-01` : null, received_date: null })
const record = (id, contractId, year, payments) => ({ id, contract_id: contractId, year,
  billing_scheduled_date: payments ? null : `${year}-07-01`, billing_date: payments ? null : `${year}-07-15`,
  received_date: null, payment_due_date: null, line_items: null, payments,
  maintenance_record: '残す保守メモ', escort_record: '残す駆付記録', transfer_failed: false, status: '請求済' })
const records = [record(49, 39, 2025, [pay(1, 2025), pay(2, 2025)]), record(51, 39, 2026, null),
  record(47, 31, 2025, [pay(1, 2025), pay(2, 2025)]), record(52, 31, 2026, [pay(1, 2026), pay(2, 2026, false)]),
  record(4, 32, 2025, [pay(1, 2025), pay(2, 2025)]), record(53, 32, 2026, [pay(1, 2026), pay(2, 2026, false)])]
records[2].line_items = [{ name: '保守料', amount: 82500 }, { name: '再発行手数料', amount: 330 }]
const raw = review('synthetic-only', records)
assert.equal(raw.counts.records, 6)
assert.equal(raw.counts.actual, 9)
assert.equal(raw.counts.planned, 2)
assert.equal(raw.unknownActualCount, 9, 'Parent split details not distributed')
assert.equal(raw.candidates.find(c => c.recordId === 47 && c.seq === 1).amount, null)
assert.equal(raw.readyToWrite, false)
const confirmations = raw.candidates.filter(c => c.hasActivity).map(c => {
  const amount = c.contractId === 39 ? 165000 : c.contractId === 32 ? 82500 : c.seq === 1 ? 182500 : 82830
  const lineItems = c.contractId !== 31 ? [{ name: '保守料', amount }]
    : [{ name: '保守料', amount: 82500 }, { name: c.seq === 1 ? '土地代' : '再発行手数料', amount: c.seq === 1 ? 100000 : 330 }]
  return { sourceKey: c.sourceKey, sourceSignature: c.sourceSignature, amount, lineItems,
    amountBasis: 'D-018の金額を使った架空テスト', recipientId: 1, recipientBasis: '架空顧客Aをテストで明示' }
})
const reviewed = review('synthetic-only', records, confirmations)
assert.equal(reviewed.unknownActualCount, 0)
assert.equal(reviewed.knownActualAmount, 1190330)
assert.equal(reviewed.candidates.find(c => c.recordId === 47 && c.seq === 2).amount, 82830)
assert.equal(reviewed.candidates.find(c => c.recordId === 52 && c.seq === 2).amount, null)
assert.equal(reviewed.sourceRecords[2].line_items[1].amount, 330)
assert.equal(reviewed.sourceRecords[0].maintenance_record, '残す保守メモ')
reviewed.sourceRecords[0].maintenance_record = 'copy edit'
assert.equal(records[0].maintenance_record, '残す保守メモ')
const amountOnly = review('synthetic-only', records, confirmations.map(({ recipientId, recipientBasis, ...c }) => c))
assert.ok(amountOnly.candidates.every(c => c.recipientId === null), 'No current-owner fallback')
assert.ok(amountOnly.candidates.every(c => c.issues.includes('請求先要確認')))
const changedSource = plain(records); changedSource[2].payments.reverse()
const mismatch = review('synthetic-only', changedSource, confirmations)
assert.equal(mismatch.unmatchedConfirmations.length, 2, 'Reordered slots cannot reuse old confirmation')
changedSource[2].payments.reverse(); changedSource[2].payments[0].billing_date = '2025-06-02'
assert.ok(review('synthetic-only', changedSource, confirmations).candidates.find(c => c.recordId === 47).issues.includes('確認後に元データが変わっています'))
assert.equal(review('other-dataset', records, confirmations).unmatchedConfirmations.length, 9)
assert.throws(() => review('x', [records[0], records[0]]), /元レコードID/)
assert.throws(() => review('synthetic-only', records, [confirmations[0], confirmations[0]]), /確認値/)
const sameYear = [record(29, 39, 2024, null), record(31, 39, 2024, null)]
assert.equal(new Set(review('same-year', sameYear).candidates.map(c => c.sourceKey)).size, 2)
const notesOnly = { ...record(99, 88, 2026, null), billing_scheduled_date: null, billing_date: null, status: '', line_items: null }
assert.equal(review('notes', [notesOnly]).candidates.length, 0)
assert.deepEqual(plain(review('notes', [notesOnly]).retainedOnlyIds), [99])
const paidWithoutDate = { ...notesOnly, status: '入金済' }
assert.ok(review('notes', [paidWithoutDate]).recordIssues.some(i=>i.message.includes('入金済の状態と入金日')))
assert.ok(review('notes', [paidWithoutDate]).recordIssues.some(i=>i.message.includes('保守専用とは確定せず')))
const parentOnly = { ...records[0], billing_date: '2025-08-01' }
assert.equal(review('parents', [parentOnly]).candidates.length, 2, 'Parent never creates an extra third charge')
assert.equal(review('parents', [parentOnly]).recordIssues.length, 1)
const duplicateSeq = { ...records[0], payments: [pay(1, 2025), pay(1, 2025)] }
assert.ok(review('duplicate-seq', [duplicateSeq]).candidates.every(c => c.issues.includes('回番号重複・対応要確認')))
const zero = record(100, 100, 2026, null); zero.line_items = [{ name: '免除', amount: 0 }]
assert.equal(review('zero', [zero]).candidates[0].amount, 0)
assert.equal(canonicalJson({ b: 2, a: 1 }), canonicalJson({ a: 1, b: 2 }))
for (const value of [undefined, NaN, Infinity, new Date(), () => {}]) assert.throws(() => canonicalJson(value), /JSON以外/)
console.log('PASS: atomic local state return, retry idempotency, stale/invalid request rejection, A→B→C full snapshots, independent copies, payer-based history.')
console.log('PASS: synthetic 6 records/9 actual charges/2 future slots, confirmed amounts and one-off 330 yen, source identity/changes, original notes retained, unknown payers not inferred.')
console.log('Scope: local memory + synthetic review only. No DB transactions, production migration, durable storage, or authentication tested.')
