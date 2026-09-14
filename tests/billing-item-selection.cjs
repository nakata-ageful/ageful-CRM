// Synthetic, read-only module tests. Never opens .env or a real database.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),cache=new Map()
function load(name){const file=path.resolve(root,name);if(cache.has(file))return cache.get(file).exports
 const module={exports:{}};cache.set(file,module)
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
 vm.runInNewContext(code,{module,exports:module.exports,Date,require:name=>{if(name==='react'||name==='react/jsx-runtime')return require(name);if(!name.startsWith('.'))throw Error('External module forbidden');const base=path.resolve(path.dirname(file),name);return load(base+(fs.existsSync(base+'.ts')?'.ts':'.tsx'))}})
 return module.exports
}
const {billingItemSummary:summary,billingItemSelectionPatch:patch}=load('src/lib/billing-item-selection.ts')
const {invoiceAmount,annualBillableTotalInc}=load('src/lib/billing.ts')
const {resolveUnitAmount}=load('src/lib/billing-unit.ts')
const contract={id:1,annual_maintenance_inc:100000,land_cost_monthly:50000,insurance_fee:20000,billing_item_flags:{annual_maintenance:false},billing_amount_overrides:{'1':90000},has_issuance_fee:true,issuance_fee_inc:330}
const original=JSON.stringify(contract),s=summary(contract)
assert.equal(s.recordedTotal,170000);assert.equal(s.includedTotal,70000);assert.equal(s.excludedTotal,100000)
assert.equal(s.hasOverrides,true);assert.equal(s.hasFees,true);assert.equal(invoiceAmount(contract,1,1),90330)
const payload=patch({annual_maintenance:false});assert.deepEqual(Object.keys(payload),['billing_item_flags'])
assert.equal(payload.billing_item_flags.land_cost,true);assert.equal(payload.billing_item_flags.annual_maintenance,false)
assert.throws(()=>patch({unknown:true}),/項目/);assert.throws(()=>patch({land_cost:'false'}),/項目/)
assert.equal(JSON.stringify(contract),original)
const storedPlan={lifecycle:'planned',plannedAmount:82500},paid={lifecycle:'received',frozenAmount:165000}
assert.equal(resolveUnitAmount(storedPlan,()=>s.includedTotal).amount,82500)
assert.equal(resolveUnitAmount(paid,()=>s.includedTotal).amount,165000)
const Component=load('src/components/BillingItemSelection.tsx').BillingItemSelection
const html=renderToStaticMarkup(React.createElement(Component,{contract,onSave:async()=>{throw Error('SSR must not write')}}))
for(const text of ['対象外（記録のみ）','70,000','100,000','個別金額','手数料','保存済み予定は変更しません'])assert.ok(html.includes(text),text)
assert.equal((html.match(/type="checkbox"/g)||[]).length,6)
assert.ok(!html.includes('disabled=""'))
assert.ok(renderToStaticMarkup(React.createElement(Component,{contract})).includes('disabled=""'))
// Execute the actual export function without rendering or loading the app and its services.
const source=fs.readFileSync(path.join(root,'src/views/CsvImport.tsx'),'utf8'),ast=ts.createSourceFile('CsvImport.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
const names=new Set(['KINGAKU_COLS','colLetter','buildKingakuCsv','csvEscape'])
const snippets=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)||ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>names.has(d.name.getText(ast)))).map(n=>n.getText(ast)).join('\n')
const exported={};vm.runInNewContext(ts.transpileModule(snippets+'\nexports.build=buildKingakuCsv',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:exported,billingItemSummary:summary,annualBillableTotalInc})
const tables={customers:[{id:1,name:'テスト顧客'}],projects:[{id:1,customer_id:1,plant_name:'テスト発電所'}],contracts:[{...contract,project_id:1}]}
const before=JSON.stringify(tables),csv=exported.build(tables),lines=csv.split('\n')
assert.ok(lines[0].includes('自社請求対象額'));assert.ok(lines[0].includes('年次保守料：自社請求対象'))
assert.ok(lines[1].includes('70000,対象外（記録のみ）,対象,対象,対象,対象,対象,100000,'))
assert.ok(lines[2].includes('=SUM(S2:S2)'));assert.equal(JSON.stringify(tables),before)
assert.ok(exported.build({}).includes('自社請求対象額'))
console.log('PASS: maintenance excluded while land/insurance remain billable; flags-only patch, stored plan/actual amounts retained, override/fee warnings, SSR migration gate and real export columns/totals.')
