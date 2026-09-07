// Synthetic paginated responses only. No .env, DB calls or backup file writes.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const file = path.resolve(__dirname, '../src/lib/backup-reader.ts')
const mod = { exports: {} }
vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
} }).outputText, { module: mod, exports: mod.exports, Set, Map, require() { throw Error('External dependencies forbidden') } })
const { readBackupTables: read, checkBackupRelations: check, BACKUP_TABLES: tables } = mod.exports
const empty = () => Object.fromEntries(tables.map(t => [t, []]))
;(async () => {
  const source = empty()
  source.customers = Array.from({ length: 1203 }, (_, i) => ({ id: i + 1, name: '架空顧客' }))
  source.projects = [{ id: 1, customer_id: 1 }]
  source.contracts = [{ id: 1, project_id: 1 }]
  source.annual_records = [{ id: 1, contract_id: 1, payments: [{ seq: 1 }], line_items: [{ name: '保守料', amount: 100 }] }]
  source.prospects = [{ id: 1, converted_customer_id: null }]
  const calls = []
  const fetch = async (table, from, to) => {
    calls.push({ table, from, to })
    // Server cap smaller than requested page size must still fetch all rows.
    return { data: source[table].slice(from, Math.min(to + 1, from + 137)), count: source[table].length, error: null }
  }
  const result = await read(fetch)
  assert.equal(result.customers.length, 1203)
  assert.equal(result.customers.at(-1).id, 1203)
  assert.equal(calls.filter(c => c.table === 'customers').length, 9)
  assert.equal(result.annual_records[0].payments[0].seq, 1)
  check(result)
  check(empty())
  await assert.rejects(read(async () => ({ data: null, count: 0, error: 'denied' })), /取得に失敗/)
  await assert.rejects(read(async () => ({ data: [], count: null, error: null })), /取得に失敗/)
  await assert.rejects(read(async () => ({ data: [], count: 1, error: null })), /件数/)
  await assert.rejects(read(async () => ({ data: [{ id: 2 }, { id: 1 }], count: 2, error: null })), /ID順序/)
  await assert.rejects(read(async () => ({ data: [{ id: 1 }, { id: 1 }], count: 2, error: null })), /ID順序/)
  await assert.rejects(read(async (_table, from) => ({ data: [{ id: from + 1 }], count: from === 0 ? 2 : 3, error: null })), /途中で変わり/)
  await assert.rejects(read(async () => ({ data: [{ id: 1 }, { id: 2 }], count: 1, error: null })), /件数/)
  const bad = empty(); bad.projects = [{ id: 1, customer_id: 999 }]
  assert.throws(() => check(bad), /不足/)
  const badContract = { ...result, contracts: [{ id: 1, project_id: 999 }] }
  assert.throws(() => check(badContract), /不足/)
  const badAnnual = { ...result, annual_records: [{ id: 1, contract_id: 999 }] }
  assert.throws(() => check(badAnnual), /不足/)
  const badProspect = { ...result, prospects: [{ id: 1, converted_customer_id: 9999 }] }
  assert.throws(() => check(badProspect), /不足/)
  console.log('PASS: 1,203 rows across server-capped pages, nested JSON preserved, empty tables, API errors, missing counts, count drift, duplicate/order errors, missing relations.')
  console.log('Scope: synthetic response validation only. Not a consistent DB snapshot or a tested full restore.')
})().catch(error => { console.error(error); process.exitCode = 1 })
