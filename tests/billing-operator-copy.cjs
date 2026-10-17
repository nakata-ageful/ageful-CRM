// Actual React UI with synthetic fixtures only. External access and saves are forbidden.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const {renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..')
function load(file,hooks){file=path.resolve(root,file);const m={exports:{}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Date,Map,Set,structuredClone,require:n=>{
  if(n==='react')return hooks??React;if(n==='react/jsx-runtime')return require(n);if(n.endsWith('.css'))return {};if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);if(/\/(data|actions|supabase|mock-store)$/.test(p))throw Error('Business data access forbidden');return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'),hooks)
 }});return m.exports}
const noSave=()=>{throw Error('Rendering may not save')},render=(file,name,props)=>renderToStaticMarkup(React.createElement(load('src/components/'+file+'.tsx')[name??file],props))
const unit={id:'1',projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',lifecycle:'planned',recipientId:1,plannedAmount:82500,frozenAmount:null,frozenLineItems:null,frozenAt:null,scheduledDate:'2026-12-01',issuedOn:null,receivedOn:null,revision:1,periodStart:'2026-01-01',periodEnd:'2026-12-31'}
const common={unit,recipientName:()=> '検証顧客',onSave:noSave,onClose:noSave},before=JSON.stringify(unit)
const issue=render('InvoiceUnitEditor',null,common)
for(const s of ['発行内容を記録','請求予定額','発行内容を保存','請求書の作成・送信は行いません'])assert.ok(issue.includes(s),s)
assert.ok(!issue.includes('発行して保存')&&!issue.includes('保存予定額'))
const collection=render('InvoiceUnitEditor',null,{...common,unit:{...unit,lifecycle:'issued',issuedOn:'2026-12-01',frozenAmount:82500}})
for(const s of ['入金日を記録','入金日を保存','通帳などに記載された入金日'])assert.ok(collection.includes(s),s)
const plan=render('InvoicePlanEditor',null,{...common,unit:{...unit,plannedAmount:null},recipients:[{id:1,name:'検証顧客'}]})
for(const s of ['今回だけ','未発行の予定のまま','金額要確認','自動では変わりません'])assert.ok(plan.includes(s),s)
const debit=render('ManualDebitEditor',null,{...common,unit:{...unit,method:'口座振替'}})
assert.ok(debit.includes('振替予定額')&&!debit.includes('保存予定額'))
const removal=render('BillingRecordRemovalEditor',null,{...common,unit:{...unit,roundLabel:'保存済み単回記録'},mode:'remove',periodLabel:'2026-01-01 ～ 2026-12-31',onBusyChange:noSave})
for(const s of ['回数要確認','削除済み記録から復元できます','実際の請求書取消・返金・銀行処理は行いません'])assert.ok(removal.includes(s),s)
assert.ok(!removal.includes('保存済み単回記録'))
const owner={id:1,name:'検証顧客'},empty=render('OwnershipBillingPlanEditor',null,{projectId:1,oldOwner:owner,newOwner:owner,units:[],onSave:noSave,testOnly:false})
for(const s of ['保存済みの請求予定を変更','保存済みの未発行予定','自動の予定は「請求詳細」で確認','金額要確認'])assert.ok(empty.includes(s),s)
// Exercise the cycle confirmation without submitting it: no annual registration chore.
const state=[];let cursor=0;const hooks={...React,useRef:v=>({current:v}),useState(v){const i=cursor++;if(!(i in state))state[i]=typeof v==='function'?v():v;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v]}}
const Cycle=load('src/components/BillingCycleSettings.tsx',hooks).BillingCycleSettings
const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):e?.props?[...(p(e)?[e]:[]),...nodes(e.props.children,p)]:[]
const p={contract:{id:1,project_id:1,maintenance_start_date:'2024-01-01',billing_method:'請求書',billing_count:1,billing_schedule_days:['12月1日']},units:[],rules:[],onSave:noSave}
const draw=()=>{cursor=0;return Cycle(p)}
let tree=draw();nodes(tree,e=>e.type==='button'&&e.props.children==='繰り返し設定を変更')[0].props.onClick();tree=draw()
nodes(tree,e=>e.type==='textarea')[0].props.onChange({target:{value:'検証用の期間統一'}});tree=draw()
nodes(tree,e=>e.type==='button'&&e.props.children==='設定内容を確認')[0].props.onClick();tree=draw()
const note=nodes(tree,e=>e.props.role==='status').map(e=>e.props.children).join('')
assert.ok(note.includes('毎年の予定登録は不要です')&&note.includes('保存済みの請求先・金額・日付・保守期間は変更しません'),note)
assert.equal(JSON.stringify(unit),before)
console.log('PASS: operator wording, recording rather than sending, saved vs automatic scope, annual no-registration confirmation, unknown amounts and reversible-removal safeguards; no external access or data changes')
