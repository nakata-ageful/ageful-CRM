// Pure compatibility tests. No env, network, database or production writes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname, '../src/lib/annual-record-status-storage.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const scope = { exports: {} }
new Function('exports', compiled)(scope.exports)
const { toStoredAnnualRecordStatus: convert, annualRecordPayloadForStorage: adapt, annualRecordFromStorage: read, singleAnnualRecordId: selectId } = scope.exports
assert.equal(convert(''), '未入金')
for (const status of ['未入金', '請求済', '入金済']) assert.equal(convert(status), status)
for (const status of [null, undefined, false, 0, '未発行', ' 請求済']) assert.throws(() => convert(status))
const draft = Object.freeze({ status: '', billing_scheduled_date: '2027-06-01', billing_date: null })
assert.deepEqual(adapt(draft), { ...draft, status: '未入金' })
assert.equal(draft.status, '', 'Do not mutate caller input')
const partial = { received_date: '2027-06-15' }
assert.deepEqual(adapt(partial), partial)
assert.equal(Object.hasOwn(adapt(partial), 'status'), false, 'Partial updates must not reset status')
assert.throws(() => adapt({ status: undefined }))
assert.equal(Object.hasOwn(adapt(Object.create({ status: '' })), 'status'), false)
assert.deepEqual(read({ id: 1, status: '未入金' }), { id: 1, status: '' })
for (const status of ['', '請求済', '入金済']) assert.equal(read({ status }).status, status)
assert.throws(() => read({ status: 'unexpected' }))
assert.equal(selectId([]), null)
assert.equal(selectId([{ id: 42 }]), 42)
assert.throws(() => selectId([{ id: 42 }, { id: 43 }]), /複数/)
for (const id of [null, 0, -1, 1.5, '1']) assert.throws(() => selectId([{ id }]))
console.log('PASS: status storage mapping and single-record targeting reject invalid or ambiguous annual records.')
