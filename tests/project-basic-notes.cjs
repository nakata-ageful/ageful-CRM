// Read-only tests of application modules in isolated memory. Never loads .env or connects to a DB.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function environment({ section = null, liveShape = false } = {}) {
  const cache = new Map()
  function load(file) {
    file = path.resolve(file)
    if (file === path.join(root, 'src/lib/supabase.ts')) return { hasSupabaseEnv: liveShape, supabase: null }
    if (cache.has(file)) return cache.get(file).exports
    const module = { exports: {} }
    cache.set(file, module)
    let source = fs.readFileSync(file, 'utf8')
    // Only inject the initial open modal for SSR assertions; application files are not modified.
    if (section && file.endsWith('/views/ProjectDetail.tsx')) {
      assert.ok(source.includes('useState<EditSectionKey | null>(null)'))
      source = source.replace('useState<EditSectionKey | null>(null)', `useState<EditSectionKey | null>(${JSON.stringify(section)})`)
    }
    const code = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText
    vm.runInNewContext(code, { module, exports: module.exports, Date, Map, Set, URLSearchParams, window: { location: { hash: '' } },
      require: name => {
        if (name === 'react' || name === 'react/jsx-runtime') return require(name)
        if (!name.startsWith('.')) throw Error('External module forbidden: ' + name)
        const base = path.resolve(path.dirname(file), name)
        return load(base + (fs.existsSync(base + '.ts') ? '.ts' : '.tsx'))
      },
    }, { filename: file })
    return module.exports
  }
  return { load, actions: load(path.join(root, 'src/lib/actions.ts')), notes: load(path.join(root, 'src/lib/project-basic-notes.ts')),
    store: load(path.join(root, 'src/lib/mock-store.ts')), fields: load(path.join(root, 'src/lib/export-fields.ts')) }
}
const plain = value => JSON.parse(JSON.stringify(value))
;(async () => {
  const a = environment()
  const keys = ['summary_notes', 'meti_notes', 'power_company_notes']
  assert.deepEqual(plain(a.notes.basicNotesPayload({})), {})
  assert.deepEqual(plain(a.notes.basicNotesPayload({ summary_notes: undefined })), {})
  assert.deepEqual(plain(a.notes.basicNotesPayload({ summary_notes: '', meti_notes: null })), { summary_notes: null, meti_notes: null })
  // Construct a full legacy form without putting any production data into tests.
  const ast = ts.createSourceFile('actions.ts', fs.readFileSync(path.join(root, 'src/lib/actions.ts'), 'utf8'), ts.ScriptTarget.Latest, true)
  const type = ast.statements.find(s => ts.isTypeAliasDeclaration(s) && s.name.text === 'ProjectInput')
  const input = Object.fromEntries(type.type.members.filter(m => !keys.includes(m.name.text)).map(m => [m.name.text, '']))
  Object.assign(input, { customer_id: 1, project_name: '備考テスト専用', plant_name: '備考テスト専用', has_4g: false })
  const values = { summary_notes: '概要の1行目\n2行目 <script>文字列</script>', meti_notes: '申請についてのメモ', power_company_notes: '電力会社への確認事項' }
  const created = await a.actions.createProject({ ...input, ...values })
  for (const key of keys) assert.equal(created[key], values[key])
  const updated = await a.actions.updateProject(created.id, { ...input, notes: 'その他は独立', panel_notes: 'パネルも独立' })
  for (const key of keys) assert.equal(updated[key], values[key], 'Legacy form must not erase new notes')
  assert.equal(updated.notes, 'その他は独立')
  assert.equal(updated.panel_notes, 'パネルも独立')
  const edited = await a.actions.updateProject(created.id, { ...input, notes: updated.notes, panel_notes: updated.panel_notes, meti_notes: '変更後\n複数行' })
  assert.equal(edited.summary_notes, values.summary_notes)
  assert.equal(edited.power_company_notes, values.power_company_notes)
  assert.equal(edited.meti_notes, '変更後\n複数行')
  const cleared = await a.actions.updateProject(created.id, { ...input, notes: updated.notes, panel_notes: updated.panel_notes, summary_notes: '' })
  assert.equal(cleared.summary_notes, null)
  assert.equal(cleared.meti_notes, edited.meti_notes)
  const all = plain(await a.actions.exportAllData())
  const row = all.projects.find(p => p.id === created.id)
  for (const key of keys) assert.equal(row[key], cleared[key])
  const fields = a.fields.EXPORT_FIELD_DEFS.find(t => t.key === 'projects').fields
  for (const key of keys) assert.equal(fields.filter(f => f.key === key).length, 1)
  const b = environment()
  const result = await b.actions.restoreAllData({ ...all, customers: all.customers.filter(c => c.id === 1), projects: [row], contracts: [], annual_records: [], maintenance_responses: [], periodic_maintenance: [], prospects: [] })
  assert.equal(result.success, true, JSON.stringify(result.errors))
  const restored = b.store.projectStore.getAll().find(p => p.project_name === input.project_name)
  for (const key of keys) assert.equal(restored[key], row[key])
  const React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  const detail = { project: { ...created, ...values }, customer: { id: 1, name: 'テスト顧客' }, contract: null,
    annualRecords: [], maintenanceResponses: [], periodicMaintenance: [] }
  const render = (env, project = detail.project) => renderToStaticMarkup(React.createElement(
    env.load(path.join(root, 'src/views/ProjectDetail.tsx')).ProjectDetailView,
    { detail: { ...detail, project }, onBack() {}, onReload() {}, onViewCustomer() {}, onViewMaintenance() {} }))
  const html = render(a)
  for (const title of ['概要', '経済産業省', '電力会社']) assert.ok(html.includes(title))
  assert.ok(html.includes('&lt;script&gt;文字列&lt;/script&gt;'))
  assert.ok(!html.includes('<script>文字列</script>'))
  for (const [i, section] of ['summary', 'meti', 'power-company'].entries()) {
    const editable = render(environment({ section }))
    assert.ok(editable.includes('<textarea'))
    assert.ok(!editable.includes('準備中'))
    assert.ok(editable.includes(values[keys[i]].split('\n')[0].replace('<', '&lt;')))
    const ready = render(environment({ section, liveShape: true }))
    assert.ok(!ready.includes('準備中'))
    const missingColumns = { ...detail.project }
    for (const key of keys) delete missingColumns[key]
    const guarded = render(environment({ section, liveShape: true }), missingColumns)
    assert.ok(guarded.includes('準備中'))
    assert.match(guarded, /<textarea[^>]*disabled=""/)
  }
  console.log('PASS: 3 independent notes, multiline text, legacy omission preserves values, explicit clearing, unrelated notes preserved, JSON export/new-project restore, export-field coverage.')
  console.log('PASS: server rendering of basic sections and 3 edit modals, text escaping, migrated/unmigrated DB-shape guards.')
  console.log('Scope: isolated mock store only. Live DB migration and browser interaction not tested here.')
})().catch(error => { console.error(error); process.exitCode = 1 })
