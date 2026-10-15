// Synthetic UI and real callback guards only; never loads a DB client or writes business data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const root=path.resolve(__dirname,'..'),cache=new Map(),state=[],refs=[]
let position=0,refPosition=0,forced={},navigated=[]
const location={hash:'#project-detail/125'}
const hooks={...React,useEffect(){},useMemo:fn=>fn(),
 useState(initial){const n=position++;if(!(n in state))state[n]=n in forced?forced[n]:typeof initial==='function'?initial():initial;return[state[n],value=>{state[n]=typeof value==='function'?value(state[n]):value}]},
 useRef(initial){const n=refPosition++;return refs[n]??(refs[n]={current:initial})},
}
const deny=()=>{throw Error('Business write or external interaction forbidden')}
function load(file){
 file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports
 if(file.endsWith('/lib/actions.ts'))return new Proxy({},{get:()=>deny})
 if(file.endsWith('/lib/data.ts'))return new Proxy({},{get:()=>deny})
 if(file.endsWith('/lib/supabase.ts'))return {hasSupabaseEnv:false,billingRuntimeEnabled:true}
 if(file.endsWith('/components/Toast.tsx'))return {useToast:()=>deny}
 const m={exports:{}};cache.set(file,m)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  module:m,exports:m.exports,window:{location,history:{replaceState(){}}},URLSearchParams,Date,Intl,Map,Set,
  confirm:deny,sessionStorage:{getItem:()=>null,setItem:deny},
  require:name=>{if(name==='react')return hooks;if(name==='react/jsx-runtime')return require(name);if(name.endsWith('.css'))return {};
   if(!name.startsWith('.'))throw Error('External import forbidden: '+name)
   const p=path.resolve(path.dirname(file),name);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'))},
 });return m.exports
}
const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
const text=e=>Array.isArray(e)?e.map(text).join(''):e?.props?text(e.props.children):typeof e==='string'?e:''
function reset(overrides={}){state.length=0;refs.length=0;position=0;refPosition=0;forced=overrides}
const archived={id:125,customer_id:1,project_name:'合成の重複発電所',plant_name:'合成の重複発電所',archived_at:'2026-10-15',archive_reason:'合成の重複保管',canonical_project_id:124,created_at:'2026-10-15'}
const active={...archived,id:124,archived_at:null,archive_reason:null,canonical_project_id:null}
const customer={id:1,name:'架空顧客',company_name:null,is_corporate:false}
const contract={id:100,project_id:125,archived_at:'2026-10-15',maintenance_contractor:'合成受託会社',plan_inspection:'年1回',maintenance_start_date:'2026-01-01'}
const history={units:[],recipients:[customer],managementEvents:[],recipientName:()=>customer.name,projectName:()=>archived.project_name}
const detail={project:archived,customer,contract,annualRecords:[],maintenanceResponses:[{id:31,status:'完了'}],periodicMaintenance:[{id:41,record_date:'2026-01-01',work_type:'点検',content:'保管した内容'}]}
const {ProjectDetailView}=load('src/views/ProjectDetail.tsx')
function renderDetail(tab='基本情報',input=detail,extra={}){
 reset(tab==='請求詳細'?{4:input}:{});location.hash=`#project-detail/${input.project.id}?tab=${encodeURIComponent(tab)}`
 return ProjectDetailView({detail:input,billingHistory:history,onBack(){},onReload:deny,onViewCustomer(){},onViewMaintenance:deny,
  onViewCanonicalProject:id=>navigated.push(id),canonicalProjectName:'合成の使用中発電所',onSaveInvoice:deny,onAddRoutine:deny,onRecordRemoval:deny,
  onSavePeriod:deny,onAddSchedule:deny,onOwnershipTransfer:deny,onAddDebit:deny,onSaveBillingPlan:deny,
  managementTools:React.createElement('div',null,'UNSAFE_MANAGEMENT'),billingCycleSettings:React.createElement('div',null,'UNSAFE_CYCLE'),...extra})
}
let tree=renderDetail()
assert.ok(text(tree).includes('保管中（重複登録）'));assert.ok(text(tree).includes('管理終了とは別'))
nodes(tree,e=>e.type==='button'&&text(e)==='使用中の合成の使用中発電所を開く')[0].props.onClick();assert.deepEqual(navigated,[124])
assert.equal(nodes(tree,e=>e.type==='button'&&text(e)==='編集').length,0)
assert.equal(nodes(tree,e=>e.type==='button'&&text(e)==='所有者を変更').length,0)
for(const tab of ['設備情報','契約情報','保守情報','請求情報','その他']){
 tree=renderDetail(tab);assert.equal(nodes(tree,e=>e.type==='button'&&text(e)==='編集').length,0,tab)
 assert.ok(!text(tree).includes('UNSAFE_CYCLE'))
}
tree=renderDetail('管理設定');assert.ok(!text(tree).includes('UNSAFE_MANAGEMENT'))
tree=renderDetail('保守対応')
for(const b of nodes(tree,e=>e.type==='button'&&(e.props.title==='編集'||e.props.title==='削除'||text(e).trim().startsWith('＋')))){
 assert.equal(b.props.disabled,true);b.props.onClick?.({stopPropagation(){}})
}
assert.equal(nodes(tree,e=>e.type==='tr'&&typeof e.props.onClick==='function').length,0,'Do not jump to an editable maintenance record')
tree=renderDetail('請求詳細')
const billing=nodes(tree,e=>typeof e.type==='function'&&e.type.name==='BillingDetailView')[0]
assert.ok(billing,'Archived invoice facts remain readable')
for(const key of ['onSaveInvoice','onRecordRemoval','onSavePeriod','onAddSchedule','onAddRoutine'])assert.equal(billing.props[key],undefined,key)
tree=renderDetail('基本情報',{...detail,contract:null});assert.ok(text(tree).includes('保管中（重複登録）'),'Empty contract is safe')
tree=renderDetail('基本情報',{...detail,project:active,contract:{...contract,archived_at:null}})
assert.ok(nodes(tree,e=>e.type==='button'&&text(e)==='編集').length,'Normal project editing remains available')
assert.ok(nodes(tree,e=>e.type==='button'&&text(e)==='所有者を変更').length)

// A stale caller cannot bypass local direct write guards, even if a hidden form's handler is invoked.
const source=fs.readFileSync(path.join(root,'src/views/ProjectDetail.tsx'),'utf8'),parsed=ts.createSourceFile('ProjectDetail.tsx',source,ts.ScriptTarget.Latest,true)
const names=['handleSaveProject','handleCreateMR','handleDeleteMR','handleSavePM','openPmEdit','openPmCreate','handleDeletePM','openArModal','handleUpsertAR','handleARStatusChange','handleDeleteAR','handleSaveContract','openSectionEdit','handleSaveSection']
const handlers=[];function visit(n){if(ts.isFunctionDeclaration(n)&&names.includes(n.name?.text))handlers.push(n);ts.forEachChild(n,visit)}visit(parsed)
assert.equal(handlers.length,names.length)
const writes={readOnly:true};vm.createContext(writes)
for(const handler of handlers)vm.runInContext(ts.transpileModule(handler.getText(parsed)+';globalThis.'+handler.name.text+'='+handler.name.text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,writes)

// Execute the actual App JSX prop construction instead of checking source substrings.
const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8'),appAst=ts.createSourceFile('App.tsx',app,ts.ScriptTarget.Latest,true)
let detailNode,readOnlyNode;function find(n){if(ts.isJsxSelfClosingElement(n)&&n.tagName.getText(appAst)==='ProjectDetailView')detailNode=n;if(ts.isVariableDeclaration(n)&&n.name.getText(appAst)==='projectReadOnly')readOnlyNode=n;ts.forEachChild(n,find)}find(appAst)
function appProps(project){
 const noComponent=()=>null,context={exports:{},projectDetail:{...detail,project},projectRows:[active],runtime:{units:[],managementEvents:[],cycleRules:[],transfers:[],events:[],ownershipWorkflowReady:true,recordRemovalReady:true,cycleRulesReady:true},billingHistory:history,prospects:[],
  ProjectDetailView:noComponent,BillingCycleSettings:noComponent,ProjectManagementActions:noComponent,OwnershipWorkflowHistory:noComponent,OwnershipTransferHistory:noComponent,
  navToProjectDetail:id=>navigated.push(id),navToCustomerDetail(){},navToMaintenanceDetail(){},navToProspectDetail(){},reloadProjectDetail(){},hasPendingBillingRuntime:deny,addRoutineInvoice:deny,
  require:name=>{assert.equal(name,'react/jsx-runtime');return require(name)}}
 const input='const '+readOnlyNode.getText(appAst)+';exports.props=('+detailNode.getText(appAst)+').props'
 vm.runInNewContext(ts.transpileModule(input,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,context)
 return context.exports.props
}
const provided=appProps(archived)
for(const key of ['onAddRoutine','onSaveInvoice','onRecordRemoval','onAddSchedule','onSavePeriod','onOwnershipTransfer','onAddDebit','onSaveBillingPlan','managementTools','billingCycleSettings'])assert.equal(provided[key],undefined,key)
provided.onViewCanonicalProject(124);assert.equal(navigated.at(-1),124)
const {Projects}=load('src/views/Projects.tsx'),{CustomerDetailView}=load('src/views/CustomerDetail.tsx')
reset();tree=Projects({projects:[active,archived],customers:[customer],onReload:deny,onViewDetail:id=>navigated.push(id)})
assert.equal(nodes(tree,e=>e.type==='tr'&&e.props.className==='clickable-row').length,1)
reset();tree=CustomerDetailView({detail:{customer,projects:[active,archived],attachments:[]},onBack(){},onReload:deny,onViewProject:id=>navigated.push(id)})
assert.equal(nodes(tree,e=>e.type==='tr'&&e.props.className==='clickable-row').length,1)
;(async()=>{for(const name of names)await writes[name]();console.log('PASS: archived detail banner/canonical link, hidden editing, direct handler denial, maintenance and invoice read-only, App write-prop removal, active-only project/customer lists and normal project edit controls')})().catch(e=>{console.error(e);process.exitCode=1})
