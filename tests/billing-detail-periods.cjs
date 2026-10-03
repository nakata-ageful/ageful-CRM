// Isolated rendering and event handlers. No network, authentication or business writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..')
function load(file,hooks){file=path.resolve(root,file);const m={exports:{}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {module:m,exports:m.exports,Date,structuredClone,require:n=>{if(n==='react')return hooks??React;if(n==='react/jsx-runtime')return require(n);if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'),hooks)}});return m.exports}
const json=v=>JSON.parse(JSON.stringify(v)),noSave=()=>{throw Error('Rendering may not save')}
const {billingDetailPeriods:group}=load('src/lib/billing-detail-periods.ts')
const {detailPlanCandidate:candidate,validateDetailPlan:validate}=load('src/lib/billing-detail-plan.ts')
const {InvoiceLedgerDetail}=load('src/components/InvoiceLedgerDetail.tsx')
const contract={id:53,project_id:56,maintenance_start_date:'2025-01-01',billing_method:'口座振替',billing_schedule_days:['25日'],billing_count:null,
 annual_maintenance_inc:237600,land_cost_monthly:120000,billing_item_flags:{annual_maintenance:false},has_transfer_fee:true,transfer_fee_inc:110,notes:'初年度現金回収で計上(6/18)'}
const base={id:'1',projectId:56,serviceYear:2026,roundLabel:'第1回',method:'請求書',scheduledDate:'2025-12-01',issuedOn:'2025-12-02',receivedOn:'2025-12-20',recipientId:7,lifecycle:'received',frozenAmount:82500,frozenLineItems:[{name:'保守料',amount:82500}],frozenAt:'2025-12-02T00:00:00Z',revision:1,periodStart:'2026-07-14',periodEnd:'2027-07-13'}
const second={...base,id:'2',roundLabel:'第2回',scheduledDate:'2027-01-14',issuedOn:'2027-01-15',receivedOn:null,lifecycle:'issued'}
const units=[base,second],before=JSON.stringify(units)
let groups=group(units,'2022-07-14')
assert.equal(groups.length,1);assert.equal(groups[0].units.length,2)
assert.equal(groups[0].label,'2026-07-14 ～ 2027-07-13')
assert.equal(groups[0].inferred,false,'Saved coverage wins over invoice date and contract')
groups=group([base,{...second,periodStart:null,periodEnd:null}],'2022-07-14')
assert.equal(groups.length,1);assert.equal(groups[0].inferred,true)
groups=group([base,{...second,periodStart:'2026-10-27',periodEnd:'2027-12-31'}],'2022-07-14')
assert.equal(groups.length,2,'Explicit exceptions must not be merged by year')
assert.ok(groups.some(g=>g.label==='2026-10-27 ～ 2027-12-31'))
assert.equal(group([{...base,periodStart:null,periodEnd:null}],null)[0].start,null)
assert.equal(group([{...base,periodStart:'2026-07-14',periodEnd:null}],'2022-07-14')[0].label,'保守期間要確認')
assert.equal(group([{...base,periodStart:null,periodEnd:null}], '2024-02-29')[0].label,'2026-02-28 ～ 2027-02-27')
assert.equal(JSON.stringify(units),before)
const reference=candidate(contract,7,[],'2026-10-03')
assert.equal(reference.amount,10110);assert.equal(reference.date,'2026-10-25');assert.equal(reference.round,10)
assert.equal(reference.periodStart,'2026-01-01');assert.equal(reference.periodEnd,'2026-12-31')
const history={units:[],recipientName:()=> '山﨑 真佑子',projectName:()=> '西予市新城⑨',plannedAmount:()=>999999,recipients:[{id:7,name:'山﨑 真佑子'}]}
const html=renderToStaticMarkup(React.createElement(InvoiceLedgerDetail,{data:history,projectId:56,contract,currentRecipientId:7,maintenanceStartDate:contract.maintenance_start_date,onAddSchedule:noSave,onSave:noSave,today:'2026-10-03'}))
for(const text of ['10,110','2026-10-25','2026-01-01 ～ 2026-12-31','契約からの参考額','未登録','予定を登録','振替結果を記録','初年度現金回収','保存済みの請求・入金記録はありません'])assert.ok(html.includes(text),text)
assert.ok(!html.includes('999,999')&&!html.includes('357,600'),'Excluded maintenance must not become a billable reference')
const groupedHtml=renderToStaticMarkup(React.createElement(InvoiceLedgerDetail,{data:{...history,units},projectId:56,maintenanceStartDate:'2022-07-14',onSave:noSave}))
assert.equal((groupedHtml.match(/class="invoice-period-group"/g)||[]).length,1)
for(const text of ['第1回','第2回','2025-12-02','2027-01-15','2026-07-14 ～ 2027-07-13','2件','入金日を記録'])assert.ok(groupedHtml.includes(text),text)
const saved={...base,method:'口座振替',roundLabel:'第10回',scheduledDate:'2026-10-25',periodStart:'2026-01-01',periodEnd:'2026-12-31'}
assert.equal(candidate(contract,7,[saved],'2026-10-03').round,11)
assert.equal(candidate(contract,7,[{...saved,lifecycle:'cancelled'}],'2026-10-03').round,11,'Cancellation cannot resurrect an occurrence')
const july={...contract,maintenance_start_date:'2025-07-14'}
assert.equal(candidate(july,7,[],'2026-10-03').round,4)
assert.equal(candidate(july,7,[],'2027-01-03').year,2026)
assert.equal(candidate({...contract,maintenance_start_date:null},7,[],'2026-10-03').periodStart,null)
assert.equal(candidate({...contract,billing_schedule_days:[]},7,[],'2026-10-03').date,'')
assert.equal(candidate({...contract,billing_schedule_days:['32日']},7,[],'2026-10-03').date,'','Invalid day must not become a guessed date')
assert.equal(candidate(contract,7,[],'2026-10-03',[{id:1,project_id:56,scope:'all',action:'end',effective_date:'2025-12-31',reason:'終了'}]),null)
const invoice={...july,billing_method:'請求書',billing_count:2,billing_schedule_days:['7月14日','1月14日']}
assert.equal(candidate(invoice,7,[{...base,periodStart:null,periodEnd:null}],'2026-10-03').date,'2027-01-14')
const item={...json(reference),date:'2026-10-25'}
assert.doesNotThrow(()=>validate(item,[],56,'設定を確認'))
assert.throws(()=>validate(item,[saved],56,'設定を確認'),/対応確認/)
assert.throws(()=>validate(item,[{...saved,roundLabel:'9月分'}],56,'設定を確認'),/対応確認/)
assert.throws(()=>validate(item,[],56,''),/確認/)
assert.throws(()=>validate({...item,date:'2026-02-30'},[],56,'確認'),/確認/)
assert.doesNotThrow(()=>validate({...item,date:'2025-12-01'},[],56,'翌期分の前払い'),'Billing date does not decide service year')
assert.throws(()=>validate({...item,year:2027,periodStart:'2027-01-01',periodEnd:'2027-12-31'},[{...base,periodEnd:'2027-07-13'}],56,'確認','2022-07-14'),/重複/)
assert.throws(()=>validate({...item,round:11,periodStart:'2026-02-01',periodEnd:'2027-01-31'},[saved],56,'確認','2025-01-01'),/保守期間/)
const missingAnchorHtml=renderToStaticMarkup(React.createElement(InvoiceLedgerDetail,{data:history,projectId:56,contract:{...contract,maintenance_start_date:null},currentRecipientId:7,onAddSchedule:noSave,today:'2026-10-03'}))
assert.ok(missingAnchorHtml.includes('保守開始日未設定')&&!missingAnchorHtml.includes('予定を登録'),'Do not offer a save the RPC will reject for a missing anchor')
console.log('PASS: service-period grouping, two rounds/prepayments, preserved exceptions, unconfirmed periods, contract-only reference and duplicate safety')

;(async()=>{
 const state=[],refs=[];let cursor=0,refCursor=0,closed=false;const writes=[]
 const hooks={useState(initial){const slot=cursor++;if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial;return [state[slot],v=>{state[slot]=typeof v==='function'?v(state[slot]):v}]},useRef(initial){const slot=refCursor++;return refs[slot]??(refs[slot]={current:initial})}}
 const {BillingOccurrenceCreator:Creator}=load('src/components/BillingOccurrenceCreator.tsx',hooks)
 const props={candidate:reference,contract,units:[],recipients:history.recipients,onSave:async(i,r)=>writes.push({i,r}),onClose:()=>{closed=true}}
 const render=()=>{cursor=0;refCursor=0;return Creator(props)}
 const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
 const button=(t,text)=>nodes(t,e=>e.type==='button'&&e.props.children===text)[0]
 let tree=render()
 nodes(tree,e=>e.type==='form')[0].props.onSubmit({preventDefault(){}});tree=render()
 assert.ok(!button(tree,'確認した予定を保存'),'Reason is required')
 nodes(tree,e=>e.type==='textarea')[0].props.onChange({target:{value:'保守期間・振替日・土地代・手数料を確認'}});tree=render()
 nodes(tree,e=>e.type==='form')[0].props.onSubmit({preventDefault(){}});tree=render()
 assert.ok(button(tree,'確認した予定を保存'));assert.equal(writes.length,0,'Review must not write')
 nodes(tree,e=>e.type==='input'&&e.props.inputMode==='numeric')[0].props.onChange({target:{value:'0'}});tree=render()
 assert.ok(!button(tree,'確認した予定を保存'),'Amount change invalidates confirmation')
 nodes(tree,e=>e.type==='form')[0].props.onSubmit({preventDefault(){}});tree=render()
 await button(tree,'確認した予定を保存').props.onClick();await new Promise(r=>setImmediate(r))
 assert.equal(writes.length,1);assert.equal(writes[0].i.amount,0);assert.equal(closed,true)
 assert.equal(writes[0].i.periodStart,'2026-01-01');assert.equal(writes[0].i.round,10)
 state.length=0;refs.length=0;closed=false
 props.onSave=async()=>{throw Error('保存結果が未確認です')}
 tree=render()
 nodes(tree,e=>e.type==='textarea')[0].props.onChange({target:{value:'確認'}});tree=render()
 nodes(tree,e=>e.type==='form')[0].props.onSubmit({preventDefault(){}});tree=render()
 await button(tree,'確認した予定を保存').props.onClick();await new Promise(r=>setImmediate(r));tree=render()
 assert.equal(closed,false,'Failed/unknown save must not close or advance to actual recording')
 assert.ok(nodes(tree,e=>e.props.role==='alert').some(e=>String(e.props.children).includes('保存結果が未確認です')))
 nodes(tree,e=>e.type==='select'&&e.props.value==='10')[0].props.onChange({target:{value:'11'}});tree=render()
 assert.equal(nodes(tree,e=>e.type==='input'&&e.props.inputMode==='numeric')[0].props.value,'','Changing occurrence must not retain the old round/month amount')
 assert.ok(!button(tree,'確認した予定を保存'))
 assert.equal(JSON.stringify(units),before)
 console.log('PASS: real creator handlers require review/reconfirmation, preserve zero, send one occurrence and do not mutate historical financials')
})().catch(e=>{console.error(e);process.exitCode=1})
