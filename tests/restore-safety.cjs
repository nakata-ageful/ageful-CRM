// Pure safety test. No env, network, database or file restoration.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname, '../src/lib/restore-safety.ts'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
const scope = { exports: {} }
new Function('exports', compiled)(scope.exports)
assert.doesNotThrow(() => scope.exports.ensureLegacyRestoreAllowed(false))
assert.throws(() => scope.exports.ensureLegacyRestoreAllowed(true), /本番では実行できません/)

const actions = fs.readFileSync(path.join(__dirname, '../src/lib/actions.ts'), 'utf8')
const restoreStart = actions.indexOf('export async function restoreAllData(')
const firstRestoreWrite = actions.indexOf(".from('customers')", restoreStart)
const guard = actions.indexOf('ensureLegacyRestoreAllowed(hasSupabaseEnv)', restoreStart)
assert.ok(restoreStart >= 0 && guard > restoreStart && guard < firstRestoreWrite, 'Guard must run before the first restore DB write')

const view = fs.readFileSync(path.join(__dirname, '../src/views/CsvImport.tsx'), 'utf8')
assert.match(view, /disabled=\{hasSupabaseEnv\}/)
assert.match(view, /復元は現在停止中/)
console.log('PASS: legacy merge-style restore is blocked before writes and disabled in connected UI.')
