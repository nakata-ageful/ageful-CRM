const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript')
const root=path.resolve(__dirname,'..')
function load(file){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:m.exports,require:n=>n.startsWith('.')?load(path.resolve(path.dirname(file),n)+'.ts'):require(n)});return m.exports}
const {MaintenancePeriodReview}=load(path.join(root,'src/components/MaintenancePeriodReview.tsx'))
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
const units=[{id:'1',serviceYear:2026,roundLabel:'保存済み単回記録',lifecycle:'received',scheduledDate:null,issuedOn:'2025-12-02',receivedOn:'2025-12-21',frozenAmount:165000,plannedAmount:null},
 {id:'2',serviceYear:2026,roundLabel:'第2回',lifecycle:'planned',scheduledDate:null,issuedOn:null,receivedOn:null,frozenAmount:null,plannedAmount:null}]
const before=JSON.stringify(units),html=renderToStaticMarkup(React.createElement(MaintenancePeriodReview,{startDate:'2022-01-14',units}))
assert.ok(html.includes('2026-01-14 ～ 2027-01-13'))
assert.ok(html.includes('2025-12-02'))
assert.ok(html.includes('回数未登録の記録'))
assert.ok(html.includes('第2回'))
assert.ok(html.includes('保存済みの予定'))
assert.equal((html.match(/<h4>/g)||[]).length,1,'Prepayment must remain in its stored service year')
assert.equal(JSON.stringify(units),before)
console.log('PASS: stored maintenance year grouping preserves prepayment dates and undated installment slots without guessing rounds')
