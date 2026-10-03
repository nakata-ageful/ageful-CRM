// Actual React components, synthetic fixtures and in-memory handlers. No DB/network access.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..')
function load(file,hooks){file=path.resolve(root,file);const module={exports:{}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {module,exports:module.exports,Date,structuredClone,require:n=>{if(n==='react')return hooks??React;if(n==='react/jsx-runtime')return require(n);if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);if(/\/(data|actions|supabase|mock-store)\.ts$/.test(p+'.ts'))throw Error('Business data access forbidden');return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'),hooks)}})
 return module.exports}
const {BillingOverviewPanel:Panel}=load('src/components/BillingOverviewPanel.tsx'),{BillingOverviewTable:Table}=load('src/components/BillingOverviewTable.tsx')
const noSave=()=>{throw Error('Rendering may not save')},render=(C,p)=>renderToStaticMarkup(React.createElement(C,p))
const base={id:'1',projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',scheduledDate:'2026-12-01',issuedOn:null,receivedOn:null,recipientId:1,lifecycle:'planned',plannedAmount:82500,frozenAmount:null,frozenLineItems:null,frozenAt:null,revision:3,periodStart:'2026-07-14',periodEnd:'2027-07-13'}
const paid={...base,id:'2',roundLabel:'第2回',recipientId:2,lifecycle:'received',issuedOn:'2026-09-01',receivedOn:'2026-09-20',frozenAmount:165000}
const unpaid={...paid,id:'3',projectId:2,lifecycle:'issued',receivedOn:null,paymentDueOn:'2026-10-01'}
const old={...unpaid,id:'4',serviceYear:2023,frozenAmount:0}
const unknown={...unpaid,id:'5',projectId:3,frozenAmount:null}
const history={units:[base,paid,unpaid,old,unknown],recipientName:id=>id===1?'旧所有者A':'新所有者B',projectName:id=>`検証発電所${id}`,plannedAmount:()=>999999,recipients:[{id:1,name:'旧所有者A'},{id:2,name:'新所有者B'}]}
const candidates=Array.from({length:24},(_,i)=>({projectId:10+i,projectName:`未保存発電所${i}`,customerName:'現在の顧客',recipientId:2,method:'invoice',date:i===0?'2026-11-01':'2026-12-01',round:1,amount:55000,status:'missing'}))
const props={data:history,today:'2026-10-03',setupItems:candidates,onViewDetail:noSave,onSave:noSave,
 setupIssues:[{projectId:50,projectName:'要設定発電所',category:'action_required',code:'other',reason:'予定日要確認'}],
 debitProjects:[{projectId:56,projectName:'常時振替発電所',customerName:'現在の顧客',days:'25日',amount:10110}]}
const before=JSON.stringify({units:history.units,candidates})
const html=render(Panel,props)
assert.ok(!html.includes('請求履歴')&&!html.includes('billing-history-summary'),'Detail/history panels must not recur in overview')
assert.ok(html.indexOf('未入金（2件）')<html.indexOf('今月・来月・再来月の請求予定（25件）'))
assert.equal((html.match(/data-candidate-key=/g)||[]).length,24,'No display truncation, including more than 12 on one date')
for(const title of ['口座振替（1件）','入金済（1件）','請求設定要確認（1件）']){
 const escaped=title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
 assert.ok(new RegExp('<details class="card billing-overview-section [^"]+"><summary><span>'+escaped+'</span>').test(html),
   'Secondary section must be an actual closed disclosure: '+title)
}
const setupOnly=render(Panel,{...props,setupIssues:[{projectId:51,projectName:'自社請求なし候補発電所',category:'no_billing_candidate',code:'other',reason:'他社保守の可能性'}]})
assert.ok(setupOnly.includes('<details class="card billing-overview-section amber"><summary><span>請求設定要確認（1件）</span>'),
 'Setup review remains collapsible even without action-required issues')
assert.ok(html.includes('要設定発電所')&&setupOnly.includes('自社請求なし候補発電所'),'Collapsing must preserve all issue contents')
assert.ok(html.includes('古い未入金（1件）')&&html.includes('¥0'),'Old unpaid is visible and zero remains a known actual')
for(const text of ['金額要確認','参考額','現在の顧客・請求先未確定','旧所有者A','新所有者B','82,500','165,000','入金日を記録','発行'])assert.ok(html.includes(text),text)
assert.ok(!html.includes('999,999'),'Contract fallback may not overwrite saved actual/plan amounts')
const upcoming=render(Table,{data:history,units:[base],candidates,mode:'upcoming',today:props.today})
assert.equal((upcoming.match(/<table /g)||[]).length,1)
assert.ok(upcoming.indexOf('未保存発電所0')<upcoming.indexOf('検証発電所1'),'Saved and unsaved rows share chronological order')
const laterPaid={...paid,id:'6',projectId:6,receivedOn:'2026-10-01'}
const received=render(Table,{data:history,units:[paid,laterPaid],mode:'received',today:props.today})
assert.ok(received.indexOf('検証発電所6')<received.indexOf('検証発電所1'),'Most recent receipt first')
assert.equal(JSON.stringify({units:history.units,candidates}),before)
const edits=[],nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
const tree=Table({data:history,units:[base,unpaid,paid],candidates,mode:'review',today:props.today,onEdit:e=>edits.push(e)})
const buttons=nodes(tree,e=>e.type==='button')
buttons.find(b=>b.props.children==='発行').props.onClick();buttons.find(b=>b.props.children==='入金日を記録').props.onClick()
assert.deepEqual(JSON.parse(JSON.stringify(edits)),[{unitId:'1',mode:'invoice'},{unitId:'3',mode:'invoice'}])
assert.equal(buttons.filter(b=>b.props.children==='発行').length,1,'Unconfirmed candidates and paid rows cannot be issued')
const source=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8'),billing=source.slice(source.indexOf("{view === 'billing'"))
assert.ok(billing.includes("onSaveInvoice={billingHistory?request=>saveRuntime({action:'invoice',value:request})"),'List uses the existing durable atomic writer')
const panelSource=fs.readFileSync(path.join(root,'src/components/BillingOverviewPanel.tsx'),'utf8')
assert.ok(panelSource.includes('<InvoiceUnitEditor')&&panelSource.includes('<InvoicePlanEditor')&&panelSource.includes('<ManualDebitEditor'))
assert.ok(!panelSource.includes('createAnnualRecord')&&!panelSource.includes('updateAnnualRecord'),'Never reintroduce legacy annual writers')
console.log('PASS: compact chronological cross-project tables, >12 same-date candidates, collapsed secondary sections, visible old debt, stored payer/zero/unknown amounts and exact-unit operational editor routing')
