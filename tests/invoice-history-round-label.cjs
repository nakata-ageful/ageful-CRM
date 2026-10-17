// Actual detail component, synthetic fixtures only. No storage or external access.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const {renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Date,Map,Set,structuredClone,require:n=>{if(['react','react/jsx-runtime'].includes(n))return require(n);if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'))}});return m.exports}
const Detail=load('src/components/InvoiceLedgerDetail.tsx').InvoiceLedgerDetail
const base={id:'1',projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',lifecycle:'planned',scheduledDate:'2026-06-01',issuedOn:null,receivedOn:null,recipientId:1,frozenAmount:null,frozenAt:null,frozenLineItems:null,plannedAmount:165000,revision:1,periodStart:'2026-07-01',periodEnd:'2027-06-30'}
const contract={id:1,project_id:1,maintenance_start_date:'2025-07-01',billing_method:'請求書',billing_count:1,billing_schedule_days:['6月1日'],annual_maintenance_inc:165000}
const noWrite=()=>{throw Error('Display must not write')}
function render(units,c){const data={units,recipients:[{id:1,name:'検証顧客'}],recipientName:()=> '検証顧客',plannedAmount:()=>null,managementEvents:[],cycleRules:[]};const before=JSON.stringify({data,c});const html=renderToStaticMarkup(React.createElement(Detail,{data,projectId:1,contract:c,maintenanceStartDate:contract.maintenance_start_date,currentRecipientId:1,today:'2026-10-17',onSave:noWrite}));assert.equal(JSON.stringify({data,c}),before);return html}
const right=html=>html.match(/<aside class="card invoice-history-panel">([\s\S]*?)<\/aside>/)[1]
const saved=html=>right(html).match(/<div class="invoice-history-list">([\s\S]*?)<\/div><p class="invoice-history-help">/)[1]
const auto=html=>right(html).match(/aria-label="自動表示の次回予定">([\s\S]*?)<\/section>/)?.[1]??''
const hasRound=(html,n)=>html.includes(`<b>第${n}回</b>`)
let html=render([base],contract)
assert.ok(!hasRound(right(html),1),'One invoice per period needs no first-round label, including next automatic year')
assert.ok(html.includes('<h2>第1回</h2>'),'Left-hand detail is unchanged')
for(const text of ['未発行','¥165,000','2026-06-01','検証顧客','2026-07-01 ～ 2027-06-30'])assert.ok(saved(html).includes(text),text)
const second={...base,id:'2',roundLabel:'第2回',scheduledDate:'2026-12-01'}
html=render([base,second],contract)
assert.ok(hasRound(saved(html),1)&&hasRound(saved(html),2),'Actual historical rounds override a later single-invoice contract')
html=render([second],contract)
assert.ok(hasRound(saved(html),2),'A lone second round keeps its identity')
const split={...contract,billing_count:2,billing_schedule_days:['6月1日','12月1日']}
html=render([base],split)
assert.ok(hasRound(saved(html),1)&&hasRound(auto(html),2),'Partially saved two-round period keeps both labels across saved/automatic sections')
html=render([],split);assert.ok(hasRound(auto(html),1),'Automatic first round of a split invoice remains labeled')
const older={...base,id:'old',serviceYear:2025,periodStart:'2025-07-01',periodEnd:'2026-06-30',scheduledDate:'2025-06-01'}
html=render([older,base],contract);assert.ok(!hasRound(saved(html),1),'Two separate single-invoice periods do not create a fake multi-round period')
html=render([older,base],split)
const oldSection=saved(html).match(/aria-label="保守期間：2025-07-01 ～ 2026-06-30">([\s\S]*?)<\/section>/)[1]
assert.ok(!hasRound(oldSection,1),'Current contract count must not relabel an old single invoice period')
html=render([{...base,roundLabel:'保存済み単回記録'}]);assert.ok(saved(html).includes('<b>回数要確認</b>'),'Do not hide unresolved legacy warnings')
html=render([{...base,method:'口座振替'}]);assert.ok(saved(html).includes('<b>6月分（第1回）</b>'),'Keep meaningful monthly debit labels')
html=render([{...base,roundLabel:'8月分',method:'口座振替'}]);assert.ok(saved(html).includes('<b>8月分</b>'))
html=render([base,{...second,removedAt:'2026-10-01T00:00:00Z',removalReason:'検証'}]);assert.ok(!hasRound(saved(html),1),'Removed rows do not count as an active second round')
html=render([{...base,periodStart:null,periodEnd:null}]);assert.ok(!hasRound(saved(html),1),'Inferred single period is also compact')
html=render([base,{...second,projectId:2}]);assert.ok(!hasRound(saved(html),1),'Other plants must not affect numbering')
console.log('PASS: single vs split invoice labels, partial saved/automatic periods, historical periods, round 2 alone, monthly debit, warnings, removed/other-project rows; no writes or data mutation')
