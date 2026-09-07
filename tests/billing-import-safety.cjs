// Executes production entry points with synthetic input and forbidden DB/store access.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const compile = file => ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const forbidden = () => { throw Error('Unexpected database/store/import access') }
const synthetic = { project_name: '架空発電所', billing_method: '請求書', years: [{ year: 2026, received_date: '' }] }
;(async () => {
  for (const connected of [true, false]) {
    const module = { exports: {} }
    vm.runInNewContext(compile('src/lib/actions.ts'), { module, exports: module.exports,
      require: name => name === './supabase'
        ? { hasSupabaseEnv: connected, supabase: { from: forbidden, rpc: forbidden } }
        : new Proxy({}, { get: () => forbidden }),
    })
    const before = JSON.stringify(synthetic)
    await assert.rejects(module.exports.bulkImportBilling([synthetic]), /請求CSVの取り込みは現在停止中/)
    await assert.rejects(module.exports.bulkImportBilling([]), /請求CSVの取り込みは現在停止中/)
    assert.equal(JSON.stringify(synthetic), before)
  }
  const React = require('react')
  const messages = [], changes = []
  let index = 0
  const module = { exports: {} }
  vm.runInNewContext(compile('src/views/CsvImport.tsx'), { module, exports: module.exports,
    require: name => {
      if (name === 'react') return { ...React, useRef: () => ({ current: null }), useState: initial => {
        const slot = index++
        const value = slot === 0 ? 'preview' : slot === 1 ? 'billing' : slot === 3 ? [synthetic]
          : typeof initial === 'function' ? initial() : initial
        return [value, next => changes.push(next)]
      } }
      if (name === 'react/jsx-runtime') return require(name)
      if (name === '../components/Toast') return { useToast: () => message => messages.push(message) }
      if (name === '../lib/export-fields') return { EXPORT_FIELD_DEFS: [] }
      if (name === '../lib/supabase') return { hasSupabaseEnv: true }
      if (name === '../lib/restore-safety') return { RESTORE_DISABLED_MESSAGE: '復元停止' }
      return new Proxy({}, { get: () => forbidden })
    },
  })
  const tree = module.exports.CsvImport({ onReload: forbidden })
  function buttons(node) {
    if (Array.isArray(node)) return node.flatMap(buttons)
    if (!node?.props) return []
    return [...(node.type === 'button' ? [node] : []), ...buttons(node.props.children)]
  }
  const button = buttons(tree).find(b => b.props.children === '請求CSVの取り込みは停止中')
  assert.ok(button, 'Preview must explain the stop at the import button')
  assert.equal(button.props.disabled, true)
  await button.props.onClick() // Simulates invocation even if the disabled UI is bypassed.
  assert.equal(changes.length, 0, 'No importing/success state on a blocked invocation')
  assert.match(messages[0], /現在停止中/)
  console.log('PASS: billing CSV entry rejects without DB/store access; preview button and actual handler both block writes.')
})().catch(error => { console.error(error); process.exitCode = 1 })
