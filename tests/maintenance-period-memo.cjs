// Synthetic records only. No network, credentials or production writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const root=path.resolve(__dirname,'..'),cache=new Map(),plain=x=>JSON.parse(JSON.stringify(x))
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports
 const m={exports:{}};cache.set(file,m)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Intl,Date,require:n=>{
  if(n==='react')return React;if(n==='react/jsx-runtime')return require(n)
  if(!n.startsWith('.'))throw Error('External access forbidden')
  const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'))
 }});return m.exports}
const {maintenanceMemoPayload:patch,maintenanceMemoReady:ready}=load('src/lib/maintenance-period-memo.ts')
const original={id:1,project_id:1,maintenance_start_date:'2023-08-01',maintenance_period_start_memo_date:null,maintenance_contract_date:'2023-07-01',maintenance_contractor:'架空受託会社',annual_maintenance_ex:150000,annual_maintenance_inc:165000,maintenance_contract_notes:'保持する備考',billing_method:'請求書',billing_count:1,billing_schedule_days:['12月1日']}
const before=JSON.stringify(original),key='maintenance_period_start_memo_date'
assert.equal(ready(original),true);assert.equal(ready({id:1}),false)
assert.deepEqual(plain(patch(original,'2027-01-01')),{[key]:'2027-01-01'})
assert.deepEqual(plain(patch({...original,[key]:'2027-01-01'},'')),{[key]:null})
assert.deepEqual(plain(patch(original,'')),{});assert.deepEqual(plain(patch({id:1},'')),{})
assert.throws(()=>patch(original,'2027-02-30'),/日付/);assert.throws(()=>patch({id:1},'2027-01-01'),/未準備/)
assert.equal(JSON.stringify(original),before)
const {futureMaintenancePeriod,cycleInvoiceDate}=load('src/lib/billing-cycle.ts')
const {detailPlanCandidate}=load('src/lib/billing-detail-plan.ts')
const {invoiceAmount,withdrawalAmount}=load('src/lib/billing.ts')
const {inspectFutureBillingCoverage}=load('src/lib/billing-cutover-coverage.ts')
for(const memo of [null,'2001-02-03','2027-01-01','2199-12-31']){
 const edited={...original,[key]:memo}
 assert.deepEqual(plain(futureMaintenancePeriod(edited,2027)),plain(futureMaintenancePeriod(original,2027)))
 assert.equal(cycleInvoiceDate(edited,2027),cycleInvoiceDate(original,2027))
 assert.deepEqual(plain(detailPlanCandidate(edited,1,[],'2026-10-26')),plain(detailPlanCandidate(original,1,[],'2026-10-26')))
 assert.equal(invoiceAmount(edited,1,1),invoiceAmount(original,1,1));assert.equal(withdrawalAmount(edited,1),withdrawalAmount(original,1))
 const row=c=>[{project_id:1,project_name:'合成発電所',customer_name:'合成顧客',contract:c,records:[]}]
 assert.deepEqual(plain(inspectFutureBillingCoverage(row(edited),new Map([[1,1]]),[],'2026-10',3)),plain(inspectFutureBillingCoverage(row(original),new Map([[1,1]]),[],'2026-10',3)))
}
for(const f of ['billing.ts','billing-cycle.ts','billing-cutover-coverage.ts','billing-detail-plan.ts','maintenance-schedule.ts','maintenance-period-label.ts','invoice-schedule-date.ts'])assert.ok(!fs.readFileSync(path.join(root,'src/lib',f),'utf8').includes(key),`Memo must not become a calculation input in ${f}`)
const {renderToStaticMarkup:render}=require('react-dom/server'),{MaintenancePeriodMemoField}=load('src/components/MaintenancePeriodMemoField.tsx')
assert.match(render(React.createElement(MaintenancePeriodMemoField,{value:'2027-01-01',ready:true,onChange(){}})),/計算には使いません/)
assert.match(render(React.createElement(MaintenancePeriodMemoField,{value:'',ready:false,onChange(){}})),/disabled/)
// Execute the real maintenance-section save handler; merge its patch into a fake row.
const source=ts.createSourceFile('ProjectDetail.tsx',fs.readFileSync(path.join(root,'src/views/ProjectDetail.tsx'),'utf8'),ts.ScriptTarget.Latest,true)
let handler;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='handleSaveSection')handler=n;ts.forEachChild(n,visit)}visit(source)
const {contractSectionPatch}=load('src/lib/contract-section-patch.ts')
const form={...Object.fromEntries(Object.entries(original).map(([k,v])=>[k,v==null?'':typeof v==='number'?String(v):v])),[key]:'2027-01-01'}
let saved
const context={readOnly:false,editSection:'maintenance-contract',PROJECT_SECTIONS:[],CONTRACT_SECTIONS:['maintenance-contract'],projForm:{},contractForm:new Proxy(form,{get:(t,k)=>k in t?t[k]:''}),contract:original,
 contractSectionPatch,maintenanceMemoPayload:patch,sectionSaveLock:{current:false},scheduleFailure:'',billingHistory:undefined,ScheduleChangeSaveError:class extends Error{},setScheduleReview(){},setSaving(){},setErr(e){if(e)throw Error(e)},setEditSection(){},onReload(){},toast(){},updateContract:async(id,p)=>{assert.equal(id,1);saved=plain(p)}}
vm.createContext(context);vm.runInContext(ts.transpileModule(handler.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+';globalThis.run=handleSaveSection',context)
context.run().then(()=>{
 assert.ok(saved);const merged={...original,...saved},expected={...original,[key]:'2027-01-01'}
 assert.deepEqual(merged,expected,'Memo edit must leave original contract and invoice inputs unchanged')
 for(const k of ['billing_count','billing_schedule_days','billing_method'])assert.ok(!Object.hasOwn(saved,k))
 const text=fs.readFileSync(path.join(root,'src/views/ProjectDetail.tsx'),'utf8')
 assert.match(text,/保守契約開始日<\/span>.*maintenance_start_date/)
 assert.match(text,/保守期間開始日<\/span>.*maintenance_period_start_memo_date/)
 assert.equal(JSON.stringify(original),before)
 console.log('PASS: memo set/clear/readiness/invalid date, rendered field, real section save, unchanged invoice/debit/date/period calculation and original records')
}).catch(e=>{console.error(e);process.exitCode=1})
