// Real presentation + alert functions, synthetic fixtures. No DB, auth, network or writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const root=path.resolve(__dirname,'..'),{renderToStaticMarkup}=require('react-dom/server')
function load(file,hooks){file=path.resolve(root,file);const m={exports:{}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Date,Map,Set,structuredClone,require:n=>{if(n==='react')return hooks??React;if(n==='react/jsx-runtime')return require(n);if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'),hooks)}});return m.exports}
const c={id:1,project_id:1,maintenance_start_date:'2025-07-01',billing_method:'請求書',billing_count:1,billing_schedule_days:['6月1日'],annual_maintenance_inc:165000}
const paid={id:'1',projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',lifecycle:'received',scheduledDate:'2026-06-01',issuedOn:'2026-06-01',receivedOn:'2026-06-30',recipientId:1,frozenAmount:165000,frozenAt:'2026-06-01T00:00:00Z',frozenLineItems:[{name:'保守料',amount:165000}],revision:1,periodStart:'2026-07-01',periodEnd:'2027-06-30'}
const history={units:[paid],recipients:[{id:1,name:'検証顧客'}],recipientName:()=> '検証顧客',projectName:()=> '検証発電所',plannedAmount:()=>null,managementEvents:[],cycleRules:[]}
const noSave=()=>{throw Error('Displaying or navigating may not save')},props={data:history,contract:c,projectId:1,currentRecipientId:1,maintenanceStartDate:c.maintenance_start_date,today:'2026-10-17',onSave:noSave,onAddSchedule:noSave,onAddRoutine:noSave}
const original=JSON.stringify(history),Detail=load('src/components/InvoiceLedgerDetail.tsx').InvoiceLedgerDetail
const html=renderToStaticMarkup(React.createElement(Detail,props))
for(const text of ['請求予定額','今回の予定を変更','毎年の予定登録は不要','自動表示の次回予定','2027-06-01','請求予定・入金記録','自動表示'])assert.ok(html.includes(text),text)
assert.ok(!html.includes('（参考）')&&!html.includes('参考額')&&!html.includes('>予定を登録<'))
assert.equal((html.match(/aria-label="自動表示の次回予定"/g)||[]).length,1)
assert.ok(html.includes('保存済み1期間・1件'),'An automatic display is not counted as a saved financial record')
const {inspectFutureBillingCoverage:coverage}=load('src/lib/billing-cutover-coverage.ts')
const row={project_id:1,project_name:'検証発電所',customer_name:'検証顧客',contract:c,records:[]}
assert.equal(coverage([row],new Map([[1,1]]),[],'2027-03',3).candidates.length,0)
for(const y of [2027,2028,2029])assert.equal(coverage([row],new Map([[1,1]]),[],`${y}-04`,3).candidates.find(x=>x.date===`${y}-06-01`).status,'missing','No yearly manual registration is required for reminders')
const state=[];let cursor=0
const hooks={...React,useEffect(){},useState(v){const i=cursor++;if(!(i in state))state[i]=typeof v==='function'?v():v;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v]}}
const Component=load('src/components/InvoiceLedgerDetail.tsx',hooks).InvoiceLedgerDetail
const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):e?.props?[...(p(e)?[e]:[]),...nodes(e.props.children,p)]:[]
const label=e=>Array.isArray(e)?e.map(label).join(''):e?.props?label(e.props.children):typeof e==='string'?e:''
const planned={...paid,id:'2',serviceYear:2027,lifecycle:'planned',issuedOn:null,receivedOn:null,frozenAmount:null,frozenAt:null,frozenLineItems:null,plannedAmount:165000,scheduledDate:'2027-06-01',periodStart:'2027-07-01',periodEnd:'2028-06-30'}
const p={...props,data:{...history,units:[paid,planned]}}
const render=()=>{cursor=0;return Component(p)}
let tree=render();assert.ok(label(tree).includes('今回・次回の請求'))
nodes(tree,e=>e.type==='button'&&e.props['aria-label']==='自動表示の次回予定を見る')[0].props.onClick();tree=render()
assert.ok(label(tree).includes('毎年の予定登録は不要'),'Automatic candidate must open even while an older saved plan is active')
assert.ok(label(tree).includes('2028-07-01 ～ 2029-06-30'))
assert.ok(!nodes(tree,e=>typeof e.type==='function'&&e.type.name==='BillingOccurrenceCreator').length,'Looking at the automatic plan must not open a save form')
nodes(tree,e=>e.type==='button'&&e.props.children==='今回の予定を変更')[0].props.onClick();tree=render()
const modal=nodes(tree,e=>typeof e.type==='function'&&e.type.name==='Modal')[0]
assert.equal(modal.props.title,'今回の予定を変更')
assert.equal(nodes(tree,e=>typeof e.type==='function'&&e.type.name==='BillingOccurrenceCreator')[0].props.purpose,'adjust')
modal.props.onClose();tree=render()
nodes(tree,e=>e.type==='button'&&String(e.key)==='2')[0].props.onClick();tree=render()
assert.ok(nodes(tree,e=>e.type==='button'&&e.props.children==='予定を変更').length,'Saved plan remains separately selectable and editable')
const persistedHtml=renderToStaticMarkup(React.createElement(Detail,p))
assert.ok(persistedHtml.includes('保存済み2期間・2件'))
const automaticSection=persistedHtml.match(/aria-label="自動表示の次回予定">([\s\S]*?)<\/section>/)[1]
assert.ok(automaticSection.includes('2028-07-01 ～ 2029-06-30')&&!automaticSection.includes('2027-07-01 ～ 2028-06-30'),'The saved occurrence is not duplicated as an automatic one')
assert.equal(JSON.stringify(history),original,'No amounts, history, states or storage can change during display')
console.log('PASS: ordinary wording, automatic right-hand preview, no fake saved count/duplicate, non-writing navigation, saved-plan editing and 3 annual reminder windows without registration')
