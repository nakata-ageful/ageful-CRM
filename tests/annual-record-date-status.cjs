// Real save entry points, fake DB only. Never reads .env or connects to a service.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const root = path.resolve(__dirname, '..')
const writes = []
const original = { id: 7, contract_id: 1, year: 2025, billing_date: null, received_date: '2025-06-01',
  status: '入金済', line_items: [{ name: '保守料', amount: 82500 }], maintenance_record: '変更前' }
const client = { from(table) {
  assert.equal(table, 'annual_records')
  let payload
  const q = {
    update(p) { payload = p; writes.push(p); return q }, insert(p) { payload = p; writes.push(p); return q },
    select() { return q }, eq() { return q }, order() { return q },
    limit: async () => ({ data: [{ id: 7 }], error: null }),
    single: async () => ({ data: { ...original, ...payload }, error: null }),
  }
  return q
} }
const cache = new Map()
function load(name) {
  if (cache.has(name)) return cache.get(name)
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'src/lib', name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require: dep => {
    if (dep === './supabase') return { hasSupabaseEnv: true, supabase: client }
    if (['./annual-record-status', './annual-record-status-storage'].includes(dep)) return load(dep.slice(2))
    return {}
  } })
  cache.set(name, module.exports)
  return module.exports
}
;(async () => {
  const status = load('annual-record-status').statusFromBillingDates
  assert.equal(status({ received_date: '2025-06-01' }), '入金済')
  assert.equal(status({ billing_date: '2025-05-01' }), '請求済')
  assert.equal(status({}), '')
  const pay = date => ({ seq: 1, scheduled_date: null, billing_date: null, received_date: date })
  assert.equal(status({ received_date: '2025-06-01', payments: [pay('2025-06-01'), { ...pay(null), seq: 2 }] }), '請求済')
  assert.equal(status({ received_date: '2025-06-01', payments: [pay(null)] }), '')
  const actions = load('actions')
  const input = { ...original, billing_date: '', received_date: '2025-06-01', maintenance_record: 'メモだけ変更', escort_record: '' }
  const saved = await actions.saveAnnualRecord(input)
  assert.equal(saved.status, '入金済')
  assert.equal(saved.maintenance_record, 'メモだけ変更')
  assert.deepEqual(saved.line_items, original.line_items, 'Memo save must not clear the stored breakdown')
  assert.equal(Object.hasOwn(writes[0], 'line_items'), false)
  assert.equal((await actions.upsertAnnualRecord(input)).status, '入金済')
  assert.equal((await actions.createAnnualRecord(1, 2025, { received_date: '2025-06-01' })).status, '入金済')
  assert.equal((await actions.createAnnualRecord(1, 2025, { received_date: '2025-06-01',
    payments: [pay('2025-06-01'), { ...pay(null), seq: 2 }], status: '入金済' })).status, '請求済', 'Parent and accidental runtime status cannot override split activity')
  // Actual history-edit handler: received-only history must stay paid when editing its breakdown.
  const source = fs.readFileSync(path.join(root, 'src/views/BillingDetail.tsx'), 'utf8')
  const start = source.indexOf('  async function saveHistoryEdit(id: number) {')
  const end = source.indexOf('  async function handleDeleteRecord', start)
  const compiled = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const states = [], updates = []
  const scope = { setSaving: v => states.push(v), historyEdit: { billing_date: '', received_date: '2025-06-01', line_items: [{ name: '保守料', amount: '82500' }] },
    historyRecords: [original], updateAnnualRecord: async (id, payload) => updates.push({ id, payload }),
    setEditingHistoryId() {}, onReload: async () => {}, toast() {}, statusFromBillingDates: status }
  await new Function(...Object.keys(scope), compiled + '\nreturn saveHistoryEdit')( ...Object.values(scope))(7)
  assert.equal(updates[0].payload.status, '入金済')
  assert.deepEqual(states, [true, false])
  console.log('PASS: received-only memo save, create, upsert and actual history edit stay paid; split creation respects each round.')
})().catch(e => { console.error(e); process.exitCode = 1 })
