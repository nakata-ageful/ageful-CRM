// Synthetic contracts and ledger rows only. All external data access is denied.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const {renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Date,Map,Set,structuredClone,require:n=>{if(['react','react/jsx-runtime'].includes(n))return require(n);if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'))}});return m.exports}
const {detailPlanCandidate:detail}=load('src/lib/billing-detail-plan.ts'),{inspectFutureBillingCoverage:coverage}=load('src/lib/billing-cutover-coverage.ts')
const {invoiceOccurrenceYear,invoicePeriodChoiceRequired}=load('src/lib/invoice-occurrence.ts'),{routineInvoiceContext}=load('src/lib/routine-invoice.ts')
const Detail=load('src/components/InvoiceLedgerDetail.tsx').InvoiceLedgerDetail,Table=load('src/components/BillingOverviewTable.tsx').BillingOverviewTable
const contract={id:1,project_id:1,maintenance_start_date:'2019-01-01',billing_method:'請求書',billing_count:1,billing_schedule_days:['12月1日'],annual_maintenance_inc:55000}
const row={project_id:1,project_name:'合成発電所',customer_name:'検証顧客',contract,records:[],contract_count:1},pay=new Map([[1,1]])
const rule={id:1,project_id:1,effective_year:2027,mode:'calendar_prepaid',reason:'確認済み',recorded_at:'2026-10-17T00:00:00Z'}
const base={id:'1',projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',lifecycle:'received',scheduledDate:'2026-12-01',issuedOn:'2026-09-08',receivedOn:'2026-09-13',recipientId:1,frozenAmount:55000,frozenAt:'2026-09-08T00:00:00Z',frozenLineItems:[{name:'保守料',amount:55000}],revision:1,periodStart:'2026-01-01',periodEnd:'2026-12-31'}
const stored=u=>({project_id:u.projectId,service_year:u.serviceYear,recipient_customer_id:u.recipientId,collection_method:'invoice',round_number:u.roundLabel==='第1回'?1:null,scheduled_date:u.scheduledDate,lifecycle:u.lifecycle,planned_amount:u.plannedAmount??null,period_start:u.periodStart,period_end:u.periodEnd,removed_at:u.removedAt})
const noWrite=()=>{throw Error('Rendering must not write')},history=(units,rules)=>({units,cycleRules:rules,managementEvents:[],recipients:[{id:1,name:'検証顧客'}],recipientName:()=> '検証顧客',projectName:()=> '合成発電所',plannedAmount:()=>null})
let d=detail(contract,1,[],'2026-10-17'),a=coverage([row],pay,[],'2026-10',3).candidates[0]
assert.equal(d.date,'2026-12-01');assert.equal(a.date,d.date);assert.equal(d.periodChoiceRequired,true);assert.equal(a.periodChoiceRequired,true)
assert.equal(d.periodStart,null);assert.equal(a.periodStart,undefined);assert.equal(a.status,'review');assert.equal(a.reason,d.reviewReason)
assert.equal(routineInvoiceContext(contract,d,history([],[]),'2026-10-17'),null,'Do not authorize an issue with an unconfirmed service year')
let html=renderToStaticMarkup(React.createElement(Detail,{projectId:1,contract,currentRecipientId:1,data:history([],[]),today:'2026-10-17',onSave:noWrite,onAddSchedule:noWrite,onReviewPeriod:noWrite}))
assert.ok(html.includes('今年分か翌年分か要確認')&&html.includes('請求する年を設定'))
assert.ok(!html.includes('2026-01-01 ～ 2026-12-31')&&!html.includes('発行内容を記録')&&!html.includes('保守開始日未設定'),'No false period, issue shortcut or wrong missing-start guidance')
for(const startMonth of [1,5,8,12]){
 const c={...contract,maintenance_start_date:`2019-${String(startMonth).padStart(2,'0')}-01`}
 for(let year=2026;year<=2029;year++){
  const today=`${year}-10-17`,past=[]
  // Fill earlier identities without changing real history, so both surfaces describe the same outstanding next occurrence.
  for(let y=year-1;y<=year;y++)past.push({...base,id:String(y),serviceYear:y,roundLabel:'保存済み単回記録',scheduledDate:null,periodStart:null,periodEnd:null})
  d=detail(c,1,past,today,[],[rule]);a=coverage([{...row,contract:c}],pay,past.map(stored),`${year}-10`,3,[],[rule]).candidates[0]
  assert.equal(d.date,`${year}-12-01`);assert.equal(d.year,year+1);assert.equal(d.periodStart,`${year+1}-01-01`);assert.equal(d.periodEnd,`${year+1}-12-31`)
  assert.equal(a.date,d.date);assert.equal(a.serviceYear,d.year);assert.equal(a.periodStart,d.periodStart);assert.equal(a.periodEnd,d.periodEnd)
 }
}
const latest={...base,serviceYear:2027,periodStart:'2027-01-01',periodEnd:'2027-12-31',scheduledDate:'2026-12-01'}
for(const lifecycle of ['planned','issued','received']){
 const unit={...latest,lifecycle,...(lifecycle==='planned'?{issuedOn:null,receivedOn:null,frozenAmount:null,frozenAt:null,frozenLineItems:null,plannedAmount:55000}:lifecycle==='issued'?{receivedOn:null}:{})}
 const before=JSON.stringify(unit);d=detail(contract,1,[unit],'2026-10-17',[],[rule]);assert.equal(d.year,2028);assert.equal(d.date,'2027-12-01')
 a=coverage([row],pay,[stored(unit)],'2026-12',1,[],[rule]).candidates[0];assert.equal(a.serviceYear,2027);assert.equal(a.status,lifecycle==='planned'?'matches':'handled')
 assert.equal(JSON.stringify(unit),before,'Saved dates, years, amounts and status cannot change')
}
const before=JSON.stringify(base);d=detail(contract,1,[base],'2026-10-17',[],[rule]);a=coverage([row],pay,[stored(base)],'2026-12',1,[],[rule]).candidates[0]
assert.equal(d.year,2027);assert.ok(d.reviewReason.includes('別の保守期間'));assert.equal(a.status,'review','Same-date old-year record must not hide the next year')
assert.equal(a.serviceYear,d.year);assert.equal(a.periodStart,d.periodStart);assert.equal(a.periodEnd,d.periodEnd)
assert.equal(routineInvoiceContext(contract,d,history([base],[rule]),'2026-10-17'),null);assert.equal(JSON.stringify(base),before)
const legacy={...base,roundLabel:'保存済み単回記録',scheduledDate:null,periodStart:null,periodEnd:null}
d=detail(contract,1,[legacy],'2026-10-17');a=coverage([row],pay,[stored(legacy)],'2026-12',1).candidates[0]
assert.equal(d.date,a.date);assert.equal(d.periodChoiceRequired,true);assert.equal(a.periodChoiceRequired,true,'Legacy unknown rows must not make detail jump a year while the alert remains this December')
const anniversary={...rule,mode:'anniversary',effective_year:2026}
d=detail(contract,1,[],'2026-10-17',[],[anniversary]);a=coverage([row],pay,[],'2026-12',1,[],[anniversary]).candidates[0]
assert.equal(d.year,2026);assert.equal(d.periodStart,'2026-01-01');assert.equal(a.periodStart,d.periodStart);assert.ok(!d.periodChoiceRequired&&!a.periodChoiceRequired,'Explicit same-year billing is valid')
const august={...contract,maintenance_start_date:'2019-08-01',billing_schedule_days:['8月1日']}
assert.equal(coverage([{...row,contract:august}],pay,[],'2026-08',1,[],[rule]).candidates.length,1,'A future prepayment rule cannot erase an earlier anniversary reminder')
assert.equal(coverage([{...row,contract:august}],pay,[],'2027-08',1,[],[rule]).candidates.length,0,'No stale anniversary reminder after the new rule applies')
const twice={...contract,billing_count:2,billing_schedule_days:['6月1日','12月1日']}
assert.equal(invoicePeriodChoiceRequired(twice,2026),false);assert.equal(coverage([{...row,contract:twice}],pay,[],'2026-12',1).candidates[0].round,2)
assert.equal(invoiceOccurrenceYear(contract,'2026-12-01',1,[rule]),2027)
html=renderToStaticMarkup(React.createElement(Table,{data:history([],[]),candidates:[{...a,projectName:'合成発電所',customerName:'検証顧客'}],mode:'upcoming',today:'2026-10-17'}));assert.ok(!html.includes('保守：'));assert.ok(html.includes('title="保守期間：2026-01-01 ～ 2026-12-31'));assert.ok(html.includes(`class="billing-overview-date-value">${a.date}</td>`),'Overview shows only the scheduled date; period data remains intact')
console.log('PASS: shared service-year/date mapping, 16 rollover cases, explicit same-year/next-year rules, missing setup, immutable saved/legacy records, collision review, no hidden reminder and visible coverage dates')
