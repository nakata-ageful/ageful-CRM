// Pure/SSR tests. No .env, network, database or application data is loaded.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const cache = new Map()
function load(file) {
  file = path.resolve(root, file)
  if (cache.has(file)) return cache.get(file).exports
  if (/\/(supabase|actions|data|mock-store)\.ts$/.test(file)) throw Error('DB/data dependency forbidden')
  const module = { exports: {} }
  cache.set(file, module)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, Date, Map, Set,
    require: name => {
      if (['react', 'react/jsx-runtime'].includes(name)) return require(name)
      if (!name.startsWith('.')) throw Error('External dependency forbidden: ' + name)
      const base = path.resolve(path.dirname(file), name)
      return load(base + (fs.existsSync(base + '.ts') ? '.ts' : '.tsx'))
    },
  }, { filename: file })
  return module.exports
}
const plain = value => JSON.parse(JSON.stringify(value))
const billing = load('src/lib/billing.ts')
const domain = load('src/lib/billing-unit.ts')
const status = load('src/lib/billing-plan-status.ts')
const row = records => ({ project_id: 1, project_name: '架空発電所', customer_name: '架空顧客', records,
  contract: { id: 1, billing_method: '請求書', billing_schedule_days: ['6月1日', '12月1日'], annual_maintenance_inc: 200000 } })
const rec = changes => ({ id: 1, contract_id: 1, year: 2026, billing_scheduled_date: null, billing_date: null,
  received_date: null, transfer_failed: false, status: '', payments: null, ...changes })
const pay = (seq, date, changes = {}) => ({ seq, scheduled_date: date, billing_date: null, received_date: null, ...changes })
const window = new Map([[6, 2026], [12, 2026]])
const upcoming = records => billing.computeUpcomingInvoices([row(records)], window)

assert.equal(upcoming([]).length, 2)
const draft = rec({ billing_scheduled_date: '2026-12-01', status: '請求済' })
assert.equal(upcoming([draft]).length, 2, 'Saved date/legacy parent status is not issuance')
assert.equal(status.hasSavedInvoicePlanAt([draft], '2026-12-01'), true, 'Saved draft must not be inserted again')
assert.equal(upcoming([rec({ ...draft, billing_date: '2026-11-20' })]).length, 1)
assert.equal(upcoming([rec({ ...draft, received_date: '2026-12-10' })]).length, 1)
assert.equal(upcoming([rec({ ...draft, transfer_failed: true })]).length, 1)
const split = rec({ billing_scheduled_date: '2026-12-01', billing_date: '2026-06-01', received_date: '2026-06-10',
  payments: [pay(1, '2026-06-01', { billing_date: '2026-06-01', received_date: '2026-06-10' }), pay(2, '2026-12-01')] })
assert.deepEqual(plain(upcoming([split]).map(u => u.round)), [2], 'Parent activity must not hide unissued split round')
assert.equal(billing.computeUnpaidUnits([row([draft])], 2026).length, 0)
const splitIssued = rec({ ...split, payments: [split.payments[0], pay(2, '2026-12-01', { billing_date: '2026-12-01' })] })
assert.equal(upcoming([splitIssued]).length, 0)
assert.equal(upcoming([rec({ payments: [pay(9, '2026-12-01', { billing_date: '2026-12-01' })] })]).length, 1, 'Unique date remains handled after legacy round reordering')
assert.equal(billing.computeUnpaidUnits([row([splitIssued])], 2026).length, 1)
const sameDay = { ...row([rec({ payments: [pay(1, '2026-06-01', { billing_date: '2026-06-01' }), pay(2, '2026-06-01')] })]),
  contract: { ...row([]).contract, billing_schedule_days: ['6月1日', '6月1日'] } }
assert.deepEqual(plain(billing.computeUpcomingInvoices([sameDay], window).map(u => u.round)), [2])
assert.equal(billing.computeUpcomingInvoices([row([rec({ year: 2026, billing_scheduled_date: '2026-06-01', billing_date: '2026-06-01' })])], new Map([[6, 2027]]))[0].scheduledDateISO, '2027-06-01')
assert.equal(billing.computeUpcomingInvoices([{ ...row([]), contract: { ...row([]).contract, billing_method: '口座振替' } }], window).length, 0)
assert.equal(upcoming([rec({ billing_date: '2026-01-01' })]).length, 2, 'Unmapped historical activity must not consume future plans')
const januaryPaid = rec({ billing_date: '2026-01-15', received_date: '2026-01-20' })
const julyRow = { ...row([januaryPaid]), contract: { ...row([]).contract, billing_schedule_days: ['1月15日', '7月15日'] } }
assert.deepEqual(plain(billing.computeUpcomingInvoices([julyRow], new Map([[7, 2026], [8, 2026], [9, 2026]])).map(u => u.scheduledDateISO)), ['2026-07-15'])
assert.equal(status.hasSavedInvoicePlanAt([januaryPaid], '2026-07-15'), true, 'Unmapped same-year history requires detail review, not a second issue')
assert.equal(status.hasSavedInvoicePlanAt([januaryPaid], '2027-07-15'), false, 'Previous-year history does not block next year')
assert.equal(upcoming([rec({ billing_scheduled_date: '2026-03-01', billing_date: '2026-03-01' })]).length, 2, 'A removed schedule date must not consume another round')
assert.equal(upcoming([rec({ received_date: '2026-01-20' }), rec({ id: 2, transfer_failed: true })]).length, 2, 'Neither unknown received dates nor failed debits hide invoice plans')

const unit = changes => ({ id: 'unit-next', projectId: 1, serviceYear: 2027, roundLabel: '第1回', method: '請求書',
  scheduledDate: '2027-06-01', recipientId: 1, lifecycle: 'planned', issuedOn: null, receivedOn: null,
  frozenAmount: null, frozenLineItems: null, frozenAt: null, revision: 1, ...changes })
const next = unit({})
const saved = domain.saveInvoicePlan(next, 1, { recipientId: 2, scheduledDate: '2027-07-01' })
assert.equal(domain.upcomingInvoiceUnits([saved]).length, 1)
assert.equal(saved.id, next.id)
assert.equal(next.recipientId, 1, 'Input not mutated')
assert.throws(() => domain.saveInvoicePlan(saved, 1, { recipientId: 1, scheduledDate: '2027-07-01' }), /更新/)
assert.throws(() => domain.saveInvoicePlan(next, 1, { recipientId: 2, scheduledDate: '2027-02-30' }), /確認/)
assert.throws(() => domain.saveInvoicePlan(next, 1, { recipientId: 0, scheduledDate: '2027-07-01' }), /確認/)
assert.equal(domain.isBillingDate('2028-02-29'), true)
assert.equal(domain.isBillingDate('2027-02-29'), false)

const items = [{ name: '保守料', amount: 82500 }, { name: '再発行手数料', amount: 330 }]
const issued = domain.issueInvoiceUnit(saved, 2, { issuedOn: '2027-07-01', amount: 82830, lineItems: items, frozenAt: '2027-07-01T00:00:00Z' })
items[0].amount = 999999
assert.equal(issued.frozenLineItems[0].amount, 82500, 'Snapshot is a value copy')
assert.equal(domain.resolveUnitAmount(issued, () => { throw Error('Must not calculate history') }).amount, 82830)
assert.equal(domain.upcomingInvoiceUnits([issued]).length, 0)
assert.throws(() => domain.saveInvoicePlan(issued, issued.revision, { recipientId: 3, scheduledDate: '2027-07-01' }), /変更できません/)
assert.throws(() => domain.issueInvoiceUnit(issued, issued.revision, { issuedOn: '2027-07-01' }), /発行できません/)
assert.throws(() => domain.issueInvoiceUnit(next, 1, { issuedOn: '2027-06-01', amount: 10, lineItems: [{ name: '保守料', amount: 9 }], frozenAt: '2027-06-01T00:00:00Z' }), /明細合計/)
for (const amount of [0, 82500, 82830, 165000, 182500]) {
  assert.equal(domain.resolveUnitAmount(unit({ lifecycle: 'fixed', frozenAmount: amount }), () => 999999).amount, amount)
}
assert.equal(domain.resolveUnitAmount(unit({ lifecycle: 'fixed' }), () => { throw Error('No inferred past amount') }).basis, '金額要確認')
assert.equal(domain.issueInvoiceUnit(unit(), 1, { issuedOn: '2027-06-01', amount: 100, lineItems: [{ name: '保守料', amount: 100 }], frozenAt: '2027-06-01T00:00:00Z' }).lifecycle, 'issued')
assert.equal(domain.resolveUnitAmount(next, () => 120000).amount, null)
assert.equal(domain.resolveUnitAmount({...next,plannedAmount:120000}, () => 999999).amount, 120000)
assert.throws(() => domain.resolveUnitAmount({...next,plannedAmount:-1}), /不正/)
assert.throws(() => domain.resolveUnitAmount({...next,plannedAmount:1.5}), /不正/)

const later = unit({ id: 'unit-later', serviceYear: 2028, scheduledDate: '2028-06-01' })
const pastDebit = unit({ id: 'august', method: '口座振替', serviceYear: 2026, scheduledDate: '2026-08-25', lifecycle: 'fixed', frozenAmount: 10000 })
const plan = { projectId: 1, defaultRecipientId: 2, overrides: { [next.id]: 1 } }
assert.throws(() => domain.applyInvoiceRecipientPlan([next, later, issued], plan, { [next.id]: 1, [later.id]: 1 }), /重複/)
const historical = { ...issued, id: 'historical' }
const result = domain.applyInvoiceRecipientPlan([next, later, historical, pastDebit], plan, { [next.id]: 1, [later.id]: 1 })
assert.deepEqual(plain(result.map(u => u.recipientId)), [1, 2, 2, 1])
assert.equal(result[2], historical, 'Issued invoice not changed')
assert.equal(result[3], pastDebit, 'Unconfirmed old debit not changed')
assert.equal(domain.recipientForUnit(unit({ id: 'future-2029', serviceYear: 2029 }), plan), 2, 'Rule carries across years')
assert.equal(domain.recipientForUnit({ ...next, scheduledDate: '2027-08-01' }, plan), 1, 'Exception follows ID, not date')
assert.throws(() => domain.applyInvoiceRecipientPlan([next, later], plan, { [next.id]: 2, [later.id]: 1 }), /確認し直/)
assert.throws(() => domain.applyInvoiceRecipientPlan([next, later], plan, { [next.id]: 1 }), /確認し直/)
assert.throws(() => domain.applyInvoiceRecipientPlan([next, later], { ...plan, overrides: { missing: 1 } }, { [next.id]: 1, [later.id]: 1 }), /対象回/)
assert.throws(() => domain.recipientForUnit(unit({ projectId: 2 }), plan), /別の発電所/)
assert.equal(domain.recipientForUnit(unit({ method: '口座振替' }), plan), 1, 'No implicit debit freeze/cutoff decisions')

const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
const Table = load('src/components/BillingUnitTable.tsx').BillingUnitTable
const html = renderToStaticMarkup(React.createElement(Table, {
  units: [historical, {...next,plannedAmount:120000}, unit({ id: 'unknown', lifecycle: 'fixed', recipientId: null })],
  recipientName: id => id === 2 ? '顧客B<script>' : '顧客A', plannedAmount: () => 120000,
}))
for (const label of ['請求先', '確定額', '予定額', '金額要確認', '請求先要確認', '発行済・未入金', '未発行', '82,830']) assert.ok(html.includes(label), label)
assert.ok(html.includes('&lt;script&gt;'))
assert.ok(!html.includes('<script>'))

console.log('PASS: legacy draft visibility, handled exclusion, split parent isolation, same-day rounds, next-year dates, saved-draft guard.')
console.log('PASS: immutable invoice amount/recipient, zero vs unknown, confirmed amount examples, snapshot value copy, amount validation.')
console.log('PASS: next/later recipients, stable-ID exceptions, following-year generation, stale revision rejection, old debit protection, SSR labels.')
console.log('Scope: pure functions/SSR only. No DB migrations, production saves, RPC/concurrency or restore verification.')

// Execute the actual Billing event handlers with forbidden network and mocked writes.
async function testLegacyBillingButtons() {
  const calls = [], links = []
  const billingSource = fs.readFileSync(path.join(root, 'src/views/Billing.tsx'), 'utf8')
  const code = ts.transpileModule(billingSource, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  class DecemberDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-12-15T12:00:00+09:00'])) } }
  const module = { exports: {} }
  let stateIndex = 0
  vm.runInNewContext(code, { module, exports: module.exports, Date: DecemberDate, Map, Set,
    require: name => {
      if (name === 'react') return { ...React, useState: initial => {
        const index = stateIndex++
        return [index === 0 ? { '1-2027-01-01-1': { billing_date: '2026-12-20', payment_due_date: '' } } : initial, () => {}]
      } }
      if (name === 'react/jsx-runtime') return require(name)
      if (name === '../components/Toast') return { useToast: () => () => {} }
      if (name === '../lib/actions') return {
        createAnnualRecord: async (...args) => calls.push(args),
        updateAnnualRecord: () => { throw Error('Unexpected update') }, deleteAnnualRecord: () => { throw Error('Unexpected delete') },
      }
      if (name.startsWith('.')) {
        const base=path.resolve(root,'src/views',name)
        return load(base+(fs.existsSync(base+'.ts')?'.ts':'.tsx'))
      }
      throw Error('Forbidden dependency: ' + name)
    },
  })
  const target = { ...row([]), contract: { ...row([]).contract, billing_schedule_days: ['1月1日'] } }
  function buttons(node) {
    if (Array.isArray(node)) return node.flatMap(buttons)
    if (!node || !node.props) return []
    return [...(node.type === 'button' ? [node] : []), ...buttons(node.props.children)]
  }
  const render = records => {
    stateIndex = 0
    const view=module.exports.Billing({ rows: [{ ...target, records }], onReload() {}, onViewDetail: id => links.push(id) })
    return typeof view.type==='function'?view.type(view.props):view
  }
  const issue = buttons(render([])).find(b => b.props.children === '発行')
  assert.ok(issue)
  await issue.props.onClick()
  assert.equal(calls.length, 1)
  assert.equal(calls[0][1], 2027, 'Issue uses scheduled year, not today year')
  assert.equal(calls[0][2].billing_date, '2026-12-20')
  const check = buttons(render([rec({ year: 2027, billing_scheduled_date: '2027-01-01' })])).find(b => b.props.children === '請求詳細で確認')
  assert.ok(check)
  await check.props.onClick()
  assert.equal(calls.length, 1, 'Saved plan must not create another annual record')
  assert.deepEqual(links, [1])
  const unknown = buttons(render([rec({ year: 2027, billing_date: '2027-01-02' })])).find(b => b.props.children === '請求詳細で確認')
  assert.ok(unknown, 'An unbound historical invoice remains visible for review')
  await unknown.props.onClick()
  assert.equal(calls.length, 1, 'Unknown historical activity must not cause an automatic write')
  assert.deepEqual(links, [1, 1])
  console.log('PASS: actual Billing handlers use scheduled year and route saved plans to detail without writes (isolated mocks).')
}
testLegacyBillingButtons().catch(error => { console.error(error); process.exitCode = 1 })
