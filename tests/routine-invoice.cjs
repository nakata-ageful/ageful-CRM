// Real component handlers and synthetic fixtures only. No network or business data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..')
function load(file,hooks){file=path.resolve(root,file);const m={exports:{}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {module:m,exports:m.exports,Date,structuredClone,require:n=>{if(n==='react')return hooks??React;if(n==='react/jsx-runtime')return require(n);if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);if(/\/(actions|data|supabase)\.ts$/.test(p+'.ts'))throw Error('Business access forbidden');return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'),hooks)}});return m.exports}
const {routineInvoiceContext:context,exactRoutinePlan:exact,routineInvoiceKey:key}=load('src/lib/routine-invoice.ts')
const contract={id:1,project_id:1,maintenance_start_date:'2020-01-14',billing_method:'請求書',billing_count:2,billing_schedule_days:['6月1日','12月1日'],annual_maintenance_inc:165000}
const item={year:2026,round:2,date:'2026-12-01',periodStart:'2026-01-14',periodEnd:'2027-01-13',recipientId:1,amount:82500,method:'invoice'}
const data={units:[],recipients:[{id:1,name:'顧客A'},{id:2,name:'顧客B'}],recipientName:id=>id===1?'顧客A':'顧客B',projectName:()=> '通常発電所',plannedAmount:()=>null,managementEvents:[],ownershipChangedProjects:[],cycleRules:[],cycleRulesReady:true}
const c=context(contract,item,data,'2026-10-09');assert.ok(c);assert.equal(c.item.round,2);assert.equal(c.cycleRevision,0)
const joined={...contract,annual_records:[{id:99,year:2025}]}
assert.deepEqual(JSON.parse(JSON.stringify(context(joined,item,data,'2026-10-09').contract)),contract,'Overview RPC uses a bare contract row, not joined annual records')
assert.equal(joined.annual_records.length,1,'Do not mutate the display/read source')
for(const candidate of [{...item,reviewReason:'保存記録と対応不明'},{...item,date:'2026-10-01'},{...item,periodStart:null},{...item,amount:null},{...item,method:'direct_debit'},{...item,recipientId:99}])assert.equal(context(contract,candidate,data,'2026-10-09'),null)
assert.equal(context(contract,item,{...data,ownershipChangedProjects:[1]},'2026-10-09'),null)
assert.equal(context(contract,item,{...data,managementEvents:[{id:1,project_id:1,scope:'maintenance',action:'end',effective_date:'2026-06-01'}]},'2026-10-09'),null)
const saved={id:'10',projectId:1,serviceYear:2026,roundLabel:'第2回',scheduledDate:item.date,periodStart:item.periodStart,periodEnd:item.periodEnd,
 recipientId:1,method:'請求書',plannedAmount:82500,lifecycle:'planned',issuedOn:null,receivedOn:null,frozenAmount:null,frozenLineItems:null,frozenAt:null,revision:0}
assert.ok(exact(saved,c,item));assert.equal(context(contract,item,{...data,units:[saved]},'2026-10-09'),null)
for(const wrong of [{...saved,projectId:2},{...saved,serviceYear:2027},{...saved,roundLabel:'第1回'},{...saved,periodEnd:'2027-12-31'},{...saved,scheduledDate:'2026-11-01'},{...saved,recipientId:2},{...saved,method:'口座振替'},{...saved,lifecycle:'issued'},{...saved,plannedAmount:1}])assert.equal(exact(wrong,c,item),false)
assert.equal(key(1,item),key(1,{date:item.date,round:2,serviceYear:2026}))
const {BillingOverviewTable:Table}=load('src/components/BillingOverviewTable.tsx')
const candidate={projectId:1,projectName:'通常発電所',customerName:'顧客A',recipientId:1,method:'invoice',date:item.date,round:2,serviceYear:2026,periodStart:item.periodStart,periodEnd:item.periodEnd,amount:82500,status:'missing'}
const html=renderToStaticMarkup(React.createElement(Table,{data,candidates:[candidate],mode:'upcoming',today:'2026-10-09',canRecordCandidate:()=>true,onRecordCandidate:()=>{throw Error('Render may not write')}}))
for(const text of ['顧客A','発行時に確認','発行内容を記録','請求予定'])assert.ok(html.includes(text),text)
assert.ok(!html.includes('現在の顧客・請求先未確定')&&!html.includes('未保存・要確認'))
const exceptional=renderToStaticMarkup(React.createElement(Table,{data,candidates:[{...candidate,status:'review',reason:'保存済み記録の対応確認'}],mode:'review',today:'2026-10-09',canRecordCandidate:()=>false,onViewDetail:()=>{}}))
assert.ok(exceptional.includes('保存内容を確認')&&exceptional.includes('請求先・保守期間を確認')&&exceptional.includes('予定を確認'))
assert.ok(!exceptional.includes('発行内容を記録'))
console.log('PASS: ordinary payer display, exact clicked occurrence, exception/owner/overlap gates and exact creation response checks')

;(async()=>{
 const slots=[],refs=[];let pos=0,rpos=0,closed=false,creates=0,issues=[],failIssue=true,failCreate=false,wrongResponse=false
 const hooks={useState(initial){const i=pos++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]},useRef(initial){const i=rpos++;return refs[i]??(refs[i]={current:initial})}}
 const {RoutineInvoiceEditor:Editor}=load('src/components/RoutineInvoiceEditor.tsx',hooks)
 const props={context:c,recipients:data.recipients,onClose:()=>closed=true,
  onAdd:async(_context,selected,reason)=>{creates++;assert.ok(reason.includes('通常請求'));if(failCreate)throw Error('保存結果が未確認です');return {...saved,recipientId:selected.recipientId,...(wrongResponse?{projectId:2}:{})}},
  onSave:async request=>{issues.push(request);if(failIssue)throw Error('発行記録の保存失敗')}}
 const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
 const render=()=>{pos=0;rpos=0;return Editor(props)},text=(e)=>nodes(e,x=>x.type==='p').map(x=>String(x.props.children)).join(' ')
 const fill=(t,label,value)=>nodes(t,e=>e.type==='label'&&e.props.children?.[0]===label)[0].props.children[1].props.onChange({target:{value}})
 const submit=async()=>{const t=render();await nodes(t,e=>e.type==='form')[0].props.onSubmit({preventDefault(){}})}
 let tree=render();assert.equal(nodes(tree,e=>typeof e.type==='function'&&e.type.name==='CustomerPicker')[0].props.value,'1')
 await submit();assert.equal(creates,0,'Validate financial inputs before creating a plan')
 tree=render();fill(tree,'請求日','2026-12-02');fill(tree,'入金予定日','2026-12-31');fill(tree,'金額（税込）','82500')
 await submit();tree=render();assert.equal(creates,1);assert.equal(issues.length,1);assert.equal(closed,false)
 assert.ok(text(tree).includes('請求予定は保存済み'));assert.ok(nodes(tree,e=>e.type==='button'&&e.props.children==='発行内容の保存を再試行').length)
 assert.equal(nodes(tree,e=>typeof e.type==='function'&&e.type.name==='CustomerPicker')[0].props.disabled,true)
 assert.equal(nodes(tree,e=>e.type==='textarea')[0].props.disabled,true)
 failIssue=false;await submit();assert.equal(creates,1,'Never recreate after successful plan creation');assert.equal(issues.length,2)
 assert.equal(issues[0].unitId,10);assert.equal(issues[1].unitId,10);assert.equal(issues[1].value.frozen_amount,82500);assert.equal(closed,true)
 slots.length=0;refs.length=0;closed=false;creates=0;issues=[];wrongResponse=true
 tree=render();fill(tree,'請求日','2026-12-02');fill(tree,'金額（税込）','82500');await submit();await submit()
 assert.equal(creates,1,'An ambiguous creation response blocks new creation retries');assert.equal(issues.length,0);assert.equal(closed,false)
 slots.length=0;refs.length=0;wrongResponse=false;failCreate=true;creates=0;issues=[]
 tree=render();fill(tree,'請求日','2026-12-02');fill(tree,'金額（税込）','82500');await submit()
 assert.equal(creates,1);assert.equal(issues.length,0,'No issue after uncertain plan save');assert.equal(closed,false)
 assert.ok(text(render()).includes('保存結果が未確認'))
 console.log('PASS: one-form handlers, default payer, no mandatory note, validation-before-write, same-unit retry, locked payer, blocked ambiguous response and no issue after uncertain creation')
})().catch(e=>{console.error(e);process.exitCode=1})
