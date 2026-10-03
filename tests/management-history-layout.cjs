// Synthetic rendering and real wrapper callbacks only. No network/authentication/DB writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..')
function load(file,hooks){file=path.resolve(root,file);const m={exports:{}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {module:m,exports:m.exports,Date,require:n=>{if(n==='react')return hooks??React;if(n==='react/jsx-runtime')return require(n);if(n.endsWith('.css'))return {};if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'),hooks)}});return m.exports}
const noSave=()=>{throw Error('Rendering must not save')},render=(C,p)=>renderToStaticMarkup(React.createElement(C,p))
const fixture={projectId:1,row:{project_id:1,contract:{maintenance_start_date:'2022-07-14'}},customers:[],units:[],events:[],onManagementSave:noSave,onScheduleSave:noSave}
const {ProjectManagementActions}=load('src/components/ProjectManagementActions.tsx'),{BillingExceptionActions}=load('src/components/BillingExceptionActions.tsx'),{OwnershipTransferHistory}=load('src/components/OwnershipTransferHistory.tsx')
const management=render(ProjectManagementActions,fixture)+render(BillingExceptionActions,{projectId:1,owner:{id:1,name:'検証顧客'},units:[],onAddDebit:noSave,onSavePlan:noSave})
for(const text of ['現在の管理状況','終了・再開を記録する','請求予定を追加する','振替予定を追加する','請求先・方法・予定額を変更する'])assert.ok(management.includes(text),text)
assert.ok(!management.includes('<details')&&!management.includes('<input')&&!management.includes('role="dialog"'),'Landing page must show actions, not inline forms/accordions')
const before={recipient_customer_id:1,planned_amount:100,period_start:'2026-07-14',round_number:2},after={...before,recipient_customer_id:2,planned_amount:0}
const props={transfers:[{id:1,recorded_at:'2026-10-02T00:00:00Z',transfer_date:'2026-08-01',from_customer_id:1,to_customer_id:2,contract_before:{billing_method:'請求書',notes:'当時の備考'},contract_after:{billing_method:'請求書',notes:'当時の備考'},field_decisions:{reason:'所有者変更確認'}}],events:[{id:1,event_type:'plan_changed',recorded_at:'2026-10-03T00:00:00Z',before_value:before,after_value:after}],managementEvents:[{id:1,project_id:1,scope:'maintenance',action:'end',effective_date:'2026-09-30',reason:'保守終了確認'}],recipientName:id=>'顧客'+id}
const original=JSON.stringify(props),html=render(OwnershipTransferHistory,props)
assert.ok(!html.includes('<details'));assert.equal((html.match(/class="history-entry"/g)||[]).length,3)
for(const text of ['請求予定を変更','所有者を変更','保守だけを終了','顧客1 → 顧客2','0円','第2回','詳細を見る','所有者変更確認','保守終了確認'])assert.ok(html.includes(text),text)
assert.ok(html.indexOf('請求予定を変更')<html.indexOf('所有者を変更'),'Order by recording date, not effective transfer date')
const {historyFields,historyValue,buildChangeHistory,historyDate}=load('src/lib/change-history-display.ts')
assert.deepEqual(Array.from(historyFields(before,after,'billing'),f=>f.key),['recipient_customer_id','planned_amount'])
assert.equal(historyFields({notes:'同じ',nested:{a:1,b:2}},{notes:'同じ',nested:{b:2,a:1}},'contract').length,0)
assert.equal(historyFields({future_field:'保存値'},{future_field:'保存値'},'contract',true)[0].after,'保存値','Future columns remain accessible')
assert.equal(historyValue('frozen_amount',0,props.recipientName),'0円');assert.equal(historyValue('planned_amount',null,props.recipientName),'未記入')
assert.equal(buildChangeHistory(props.transfers,props.events,props.managementEvents).length,3)
assert.ok(historyDate('2026-10-02T23:00:00Z').includes('2026/10/03'),'Japan date must not display a UTC previous day')
assert.equal(JSON.stringify(props),original,'Audit and frozen snapshots must remain immutable')
const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
function harness(file,name,props){const state=[];let cursor=0;const hooks={useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return [state[i],v=>state[i]=typeof v==='function'?v(state[i]):v]}};const C=load(file,hooks)[name];return ()=>{cursor=0;return C(props)}}
;(async()=>{
 let writes=[];const request={projectId:1,scope:'maintenance',action:'end',date:'2026-10-03',reason:'確認',choices:[],expectedLast:0}
 let reject=true;const subject=harness('src/components/ProjectManagementActions.tsx','ProjectManagementActions',{...fixture,onManagementSave:async r=>{writes.push(r);if(reject)throw Error('保存失敗')}})
 let tree=subject();nodes(tree,e=>e.type==='button'&&e.props.children==='終了・再開を記録する')[0].props.onClick();tree=subject()
 const editor=()=>nodes(tree,e=>typeof e.type==='function'&&e.type.name==='ManagementLifecycleEditor')[0]
 assert.ok(editor().props.expanded)
 const pending=editor().props.onSave(request);tree=subject();nodes(tree,e=>typeof e.type==='function'&&e.type.name==='Modal')[0].props.onClose();tree=subject();assert.ok(editor(),'Saving blocks modal dismissal')
 await assert.rejects(pending,/保存失敗/);tree=subject();assert.ok(editor(),'Rejected/unknown saves keep the editor open')
 reject=false;await editor().props.onSave(request);tree=subject();assert.ok(!editor(),'Only confirmed success closes the editor');assert.equal(writes[0],request)
 const debit={recipient:1,year:2026,month:10,date:'2026-10-25',amount:0,note:'検証',reason:'確認'},choices=[{unitId:'1',expectedRevision:4,recipientId:2}]
 for(const mode of ['debit','plan']){
   let fail=true,received=[]
   const actions=harness('src/components/BillingExceptionActions.tsx','BillingExceptionActions',{projectId:1,owner:{id:1,name:'検証'},units:[],onAddDebit:async v=>{received.push(v);if(fail)throw Error('不明')},onSavePlan:async(c,r)=>{received.push({c,r});if(fail)throw Error('不明')}})
   tree=actions();nodes(tree,e=>e.type==='button'&&e.props.children===(mode==='debit'?'振替予定を追加する':'請求先・方法・予定額を変更する'))[0].props.onClick();tree=actions()
   const child=()=>nodes(tree,e=>typeof e.type==='function'&&e.type.name===(mode==='debit'?'ManualDebitPlanCreator':'OwnershipBillingPlanEditor'))[0]
   const save=()=>mode==='debit'?child().props.onSave(debit):child().props.onSave(choices,'確認')
   await assert.rejects(save(),/不明/);tree=actions();assert.ok(child())
   fail=false;await save();tree=actions();assert.ok(!child());assert.equal(mode==='debit'?received[0]:received[0].c,mode==='debit'?debit:choices)
 }
 const history=harness('src/components/OwnershipTransferHistory.tsx','OwnershipTransferHistory',props);tree=history()
 nodes(tree,e=>e.type==='button'&&Array.isArray(e.props.children)&&e.props.children[0]==='所有者変更')[0].props.onClick();tree=history()
 assert.equal(nodes(tree,e=>e.type==='li').length,1)
 nodes(tree,e=>e.type==='button'&&e.props.children==='詳細を見る')[0].props.onClick();tree=history()
 assert.ok(nodes(tree,e=>typeof e.type==='function'&&e.type.name==='Modal').length)
 assert.ok(nodes(tree,e=>e.type==='p').some(e=>String(e.props.children).includes('変更された項目はありません')))
 nodes(tree,e=>e.type==='button'&&e.props.children==='保存された全項目を表示')[0].props.onClick();tree=history()
 assert.ok(nodes(tree,e=>e.type==='td').some(e=>e.props.children==='当時の備考'),'Unchanged full snapshot is still available')
 assert.equal(JSON.stringify(props),original)
 console.log('PASS: action-only management landing, modal routing/safe save closure, visible dated/filterable audit rows, zero/unknown amounts, immutable complete snapshots and read-only diff')
})().catch(e=>{console.error(e);process.exitCode=1})
