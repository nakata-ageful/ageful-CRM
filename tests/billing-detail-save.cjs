// Execute the actual local save function against synthetic closure values only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
const source = fs.readFileSync(path.resolve(__dirname, '../src/views/BillingDetail.tsx'), 'utf8')
const start = source.indexOf('  async function handleSave() {')
const end = source.indexOf('  // 保守情報編集', start)
assert.ok(start > 0 && end > start)
const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
async function test({ fail = false, payments = [], currentRecord = { id: 1 } } = {}) {
  const writes = [], saving = [], messages = []
  const scope = { setSaving: value => saving.push(value), buildLineItems: () => [{ name: '保守料', amount: 100 }],
    billingCount: 2, payments, receivedDate: '', isTransfer: false, transferFailed: false, currentRecord,
    updateAnnualRecord: async (...args) => { if (fail) throw Error('synthetic failure'); writes.push(args) },
    createAnnualRecord: async (...args) => { if (fail) throw Error('synthetic failure'); writes.push(args) },
    currentYear: 2026, onReload: async () => {}, toast: value => messages.push(value),
    scheduledDate: '', billingDate: '', paymentDueDate: '', contract: { id: 1 },
  }
  const handle = new Function(...Object.keys(scope), `${code}\nreturn handleSave`)(...Object.values(scope))
  await handle()
  assert.deepEqual(saving, [true, false])
  return { writes, messages }
}
;(async () => {
  const p = { seq: 1, scheduled_date: '2026-12-01', billing_date: null, received_date: null }
  const draft = await test({ payments: [p] })
  assert.equal(draft.writes[0][1].status, '')
  assert.equal((await test({ payments: [p, { ...p, seq: 2, billing_date: '2026-12-01' }] })).writes[0][1].status, '請求済')
  assert.equal((await test({ payments: [{ ...p, received_date: '2026-12-01' }] })).writes[0][1].status, '入金済')
  assert.equal((await test({ payments: [] })).writes[0][1].status, '', 'Empty list cannot mean all paid')
  const failed = await test({ fail: true, payments: [p] })
  assert.equal(failed.writes.length, 0)
  assert.ok(failed.messages[0].includes('保存に失敗'))
  assert.ok(!failed.messages.includes('保存しました'))
  console.log('PASS: actual BillingDetail save classifies planned/issued/paid/empty and resets saving on rejected write. No DB calls.')
  console.log('The save handler keeps UI draft semantics; actions.ts applies the tested DB storage adapter separately.')
})().catch(error => { console.error(error); process.exitCode = 1 })
