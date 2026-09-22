const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const vm = require('node:vm')

const file = path.resolve(__dirname, '../src/lib/project-search.ts')
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const mod = { exports: {} }
vm.runInNewContext(output, { exports: mod.exports, require })
const { projectMatchesSearch } = mod.exports

const project = {
  id: 1,
  customer_id: 1,
  project_no: null,
  project_name: '旧案件名',
  plant_name: '度会郡',
  site_prefecture: '三重県',
  site_address: null,
  fit_period: null,
  handover_date: null,
  monitoring_system: null,
  subcontractor: null,
  maintenance_start_date: null,
  created_at: '2026-01-01',
  customer_name: '検索テスト顧客',
  company_name: null,
  search_text: '古い検索用データ',
}

assert.equal(projectMatchesSearch(project, '度会'), true, 'Visible plant name must be searched directly')
assert.equal(projectMatchesSearch(project, '度会郡'), true, 'Full visible plant name must match')
assert.equal(projectMatchesSearch(project, '渡会'), true, 'Common alternate kanji must match 度会')
assert.equal(projectMatchesSearch({ ...project, plant_name: '度\u200b会郡' }, '度会郡'), true, 'Invisible characters must not break search')
assert.equal(projectMatchesSearch(project, '伊勢市'), false, 'Unrelated text must not match')

console.log('PASS: project search covers visible plant name, partial text, and 度会/渡会 variants')
