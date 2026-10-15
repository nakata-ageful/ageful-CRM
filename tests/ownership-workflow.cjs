const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const root=path.resolve(__dirname,'..')
function load(file,hooks){file=path.resolve(root,file);const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Date,structuredClone,require:n=>n==='react'?(hooks??React):n==='react/jsx-runtime'?require(n):n.endsWith('.css')?{}:n.startsWith('.')?load(path.resolve(path.dirname(file),n)+(fs.existsSync(path.resolve(path.dirname(file),n)+'.ts')?'.ts':'.tsx'),hooks):(()=>{throw Error('External access forbidden: '+n)})()});return m.exports}
const plain=x=>JSON.parse(JSON.stringify(x)),render=(C,p)=>require('react-dom/server').renderToStaticMarkup(React.createElement(C,p))
const {assertOwnershipProspectEdit,prospectCustomerId}=load('src/lib/ownership-workflow.ts')
const p={id:1,ownership_project_id:1,candidate_customer_id:null,ownership_state:'open',converted_customer_id:null,customer_name:'引継ぎ先未定',project_name:'架空発電所'}
assert.equal(prospectCustomerId(p),null);assert.equal(prospectCustomerId({...p,candidate_customer_id:2}),2)
assertOwnershipProspectEdit(p,{equipment:200,apply_status:'通過'})
for(const k of ['customer_name','converted_customer_id','ownership_state','ownership_project_id','candidate_customer_id'])assert.throws(()=>assertOwnershipProspectEdit(p,{[k]:1}),/引継ぎ先/)
assert.throws(()=>assertOwnershipProspectEdit({...p,ownership_state:'completed'},{equipment:200}),/完了/)
const contract={id:1,project_id:1,billing_method:'請求書',billing_count:1,billing_schedule_days:['12月1日'],maintenance_start_date:'2020-01-01',annual_maintenance_inc:165000}
const row={project_id:1,project_name:'架空発電所',customer_name:'所有者未確認',contract_count:1,contract,records:[],currentYearRecords:[],currentYear:2026}
const {inspectFutureBillingCoverage}=load('src/lib/billing-cutover-coverage.ts')
const cov=inspectFutureBillingCoverage([row],new Map([[1,0]]),[],'2026-12',1)
assert.equal(cov.candidates.length,1);assert.equal(cov.candidates[0].date,'2026-12-01');assert.equal(cov.candidates[0].amount,165000)
assert.equal(cov.candidates[0].status,'review');assert(cov.candidates[0].reason.includes('請求先を選んでください'))
const data={units:[],recipients:[{id:2,name:'買主B'}],recipientName:id=>id===2?'買主B':'未確認',projectName:()=> '架空発電所',plannedAmount:()=>null,managementEvents:[],ownershipChangedProjects:[1]}
const noWrite=()=>{throw Error('Rendering must not write')}
const ledger=render(load('src/components/InvoiceLedgerDetail.tsx').InvoiceLedgerDetail,{data,projectId:1,contract,currentRecipientId:0,today:'2026-10-15',onSave:noWrite,onAddSchedule:noWrite,onAddRoutine:noWrite})
assert(ledger.includes('2026-12-01')&&ledger.includes('請求先を選んでください')&&ledger.includes('165,000'))
assert(!ledger.includes('発行内容を記録')&&!ledger.includes('請求先ID 0'))
const u={id:'1',projectId:1,lifecycle:'planned',revision:0,method:'請求書',scheduledDate:'2026-12-01',recipientId:1,collectionState:'pending',issuedOn:null,receivedOn:null,frozenAt:null,frozenAmount:null,frozenLineItems:null}
const choice={unitId:'1',expectedRevision:0,recipientId:2,method:'請求書',scheduledDate:'2026-12-01',plannedAmount:165000,periodStart:null,periodEnd:null,note:''}
const prepare=load('src/lib/ownership-billing-plan.ts').prepareOwnershipBillingPlan
assert.equal(prepare({projectId:1,oldOwnerId:0,newOwnerId:0,allowedRecipientIds:[1,2],units:[u],choices:[choice]}).changes.length,1)
assert.throws(()=>prepare({projectId:1,oldOwnerId:0,newOwnerId:0,units:[u],choices:[choice]}),/所有者/)
assert.throws(()=>prepare({projectId:1,oldOwnerId:0,newOwnerId:0,allowedRecipientIds:[0,2],units:[u],choices:[choice]}),/所有者/)
const panel=render(load('src/components/OwnershipWorkflowPanel.tsx').OwnershipWorkflowPanel,{project:{id:1,customer_id:1,project_name:'架空発電所'},customers:[{id:1,name:'A'},{id:2,name:'B'}],onSave:noWrite,onDirect:noWrite,onCreateCustomer:noWrite,onReloadCustomers:noWrite})
assert(panel.includes('見込み管理へ戻す')&&panel.includes('引継ぎ先未定')&&panel.includes('名前が分からない'))
const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8'),actions=fs.readFileSync(path.join(root,'src/lib/actions.ts'),'utf8')
assert(app.includes("filter(e=>e.action==='unknown')"),'Starting/cancelling a prospect must not disable normal billing')
assert(app.includes('onCreateCustomer={createOwnershipCustomer}')&&app.includes('setCustomers(list=>[...list.filter'))
assert(actions.includes("if(isOwnershipProspect(current))"))
// Execute the real prospect writer with an explicit legacy customerId: linked
// prospects still must not call the old customer/project/contract synchronizer.
const ast=ts.createSourceFile('actions.ts',actions,ts.ScriptTarget.Latest,true);let update
function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='updateProspect')update=n;ts.forEachChild(n,visit)}visit(ast)
let sync=0,writes=0
const query={select(){return this},eq(){return this},single:async()=>({data:p,error:null}),update(){writes++;return this}}
const context={exports:{},hasSupabaseEnv:true,db:()=>({from:table=>{if(table==='projects')return{select(){return this},eq(){return this},single:async()=>({data:{archived_at:null},error:null})};assert.equal(table,'prospects');return query}}),isOwnershipProspect:x=>x.ownership_project_id!=null,assertOwnershipProspectEdit,syncProspectToCustomerProject:()=>sync++}
vm.createContext(context);vm.runInContext(ts.transpileModule(update.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText+';globalThis.run=updateProspect',context)
;(async()=>{await context.run(1,{equipment:200},1);assert.equal(writes,1);assert.equal(sync,0)
 console.log('PASS: undecided identity, protected edits, null-owner dated alerts/detail, explicit payer selection, owner-independent plan edit, shared customer refresh, and real prospect writer isolates legacy sync')
})().catch(e=>{console.error(e);process.exitCode=1})
