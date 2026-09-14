const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;const module={exports:{}};cache.set(file,module)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {module,exports:module.exports,Date,require:name=>{if(name==='react'||name==='react/jsx-runtime')return require(name);if(!name.startsWith('.'))throw Error('External module forbidden');const base=path.resolve(path.dirname(file),name);return load(base+(fs.existsSync(base+'.ts')?'.ts':'.tsx'))}});return module.exports}
const {managementActiveOn:active,validateManagementRequest:validate,managementEventFromStorage:decode}=load('src/lib/management-lifecycle.ts')
const {inspectFutureBillingCoverage:coverage}=load('src/lib/billing-cutover-coverage.ts')
const end={id:1,project_id:1,scope:'maintenance',action:'end',effective_date:'2026-08-15',reason:'終了'}
assert.equal(active([end],1,'maintenance','2026-08-15'),true)
assert.equal(active([end],1,'maintenance','2026-08-16'),false)
assert.equal(active([end],1,'all','2026-08-16'),true)
const allEnd={...end,id:2,scope:'all',effective_date:'2026-09-30'},resume={...allEnd,id:3,action:'resume',effective_date:'2027-03-01'}
assert.equal(active([end,allEnd,resume],1,'all','2027-02-28'),false)
assert.equal(active([end,allEnd,resume],1,'all','2027-03-01'),true)
assert.equal(active([end,allEnd,resume],1,'maintenance','2027-03-01'),false)
assert.throws(()=>decode({...end,effective_date:'2026-02-30'}),/確認できません/)
const unit={id:'1',projectId:1,lifecycle:'planned',revision:0,collectionState:'pending',method:'請求書',plannedAmount:170000,scheduledDate:'2027-06-15'}
const request={projectId:1,expectedLast:0,scope:'maintenance',action:'end',date:'2026-08-15',reason:'終了',choices:[{unitId:'1',expectedRevision:0,action:'amount',amount:70000}]}
const before=JSON.stringify(unit);validate(request,[],[unit]);assert.equal(JSON.stringify(unit),before)
assert.throws(()=>validate({...request,choices:[]},[],[unit]),/全件/)
assert.throws(()=>validate(request,[],[{...unit,collectionState:'failed'}]),/振替不能/)
assert.throws(()=>validate({...request,choices:[{...request.choices[0],amount:null}]},[],[unit]),/予定額/)
assert.throws(()=>validate({...request,action:'resume'},[],[unit]),/状態/)
const rows=[{project_id:1,records:[],contract:{billing_method:'請求書',billing_schedule_days:['6月15日'],annual_maintenance_inc:100000,land_cost_monthly:50000,insurance_fee:20000}}]
const fees=coverage(rows,new Map([[1,1]]),[],'2027-06',1,[end])
assert.equal(fees.candidates[0].amount,70000);assert.equal(fees.candidates[0].status,'review')
assert.equal(coverage(rows,new Map([[1,1]]),[],'2027-06',1,[end,allEnd]).candidates.length,0)
assert.equal(coverage(rows,new Map([[1,1]]),[],'2027-06',1,[end,allEnd,resume]).candidates[0].amount,70000)
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),Editor=load('src/components/ManagementLifecycleEditor.tsx').ManagementLifecycleEditor
const html=renderToStaticMarkup(React.createElement(Editor,{projectId:1,events:[end],units:[unit],onSave:async()=>{throw Error('SSR must not save')}}))
for(const label of ['保守だけ','すべての取引','そのまま残す','予定額を変更して残す','取りやめる','備考・確認内容'])assert.ok(html.includes(label),label)
console.log('PASS: inclusive last management day, restart boundary, independent maintenance/all states, no implicit proration, land/insurance continuity, plan coverage/revision/failure guards and editor SSR.')
