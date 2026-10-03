// Synthetic fixtures only: no credentials, network, DB writes or customer data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
const root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Date,require:n=>n.startsWith('.')?load(path.resolve(path.dirname(file),n)+(fs.existsSync(path.resolve(path.dirname(file),n)+'.ts')?'.ts':'.tsx')):require(n)});return m.exports}
const {inspectCandidatePeriod:assess}=load('src/lib/billing-period-coverage.ts'),{detailPlanCandidate:next}=load('src/lib/billing-detail-plan.ts'),{legacyScheduleSetupReview:alerts,inspectFutureBillingCoverage:coverage}=load('src/lib/billing-cutover-coverage.ts'),{buildBillingOverview:overview}=load('src/lib/billing-overview.ts'),{validateCycleRule}=load('src/lib/billing-cycle.ts')
const c={id:1,project_id:1,maintenance_start_date:'2023-10-27',billing_method:'請求書',billing_count:1,billing_schedule_days:['12月1日'],annual_maintenance_inc:165000}
const paid={id:'1',projectId:1,serviceYear:2026,roundLabel:'保存済み単回記録',method:'請求書',recipientId:1,lifecycle:'received',scheduledDate:null,issuedOn:'2026-09-08',receivedOn:'2026-09-13',frozenAmount:165000,frozenLineItems:[{name:'保守料',amount:165000}],frozenAt:'2026-09-08T00:00:00Z',revision:0,periodStart:'2026-10-27',periodEnd:'2027-12-31'}
const rule={id:1,project_id:1,effective_year:2028,mode:'calendar_prepaid',reason:'合成検証',recorded_at:'2026-10-03T00:00:00Z'},rules=[rule],row={project_id:1,project_name:'長期移行の検証発電所',customer_name:'検証顧客',contract:c,records:[],contract_count:1},recipients=new Map([[1,1]])
const history=[{...paid,id:'old',serviceYear:2025,periodStart:null,periodEnd:null},paid]
const baseline=JSON.stringify({c,paid,rule,row})
validateCycleRule(c,[paid],2028,'calendar_prepaid','確認')
assert.throws(()=>validateCycleRule(c,[paid],2027,'calendar_prepaid','確認'),/重な/)
const p=next(c,1,history,'2026-10-03',[],rules)
assert.equal(p.year,2028);assert.equal(p.date,'2027-12-01');assert.equal(p.periodStart,'2028-01-01');assert.equal(p.periodEnd,'2028-12-31');assert.equal(p.reviewReason,undefined)
const partial={periodStart:'2027-10-27',periodEnd:'2028-10-26'}
assert.equal(assess(c,2027,partial,[paid],rules).superseded,true)
for(const lifecycle of ['planned','fixed','cancelled','review_required']){const result=assess(c,2027,partial,[{...paid,lifecycle}],rules);assert.equal(result.superseded,false);assert.match(result.reason,/確認/)}
for(const changed of [{...paid,periodEnd:'2027-11-30'},{...paid,periodEnd:null},{...paid,method:'口座振替'}])assert.equal(assess(c,2027,partial,[changed],rules).superseded,false)
assert.equal(assess({...c,billing_count:2},2027,partial,[paid],rules).superseded,false)
assert.equal(assess(c,2027,partial,[paid,{...paid,id:'2',serviceYear:2027,lifecycle:'planned'}],rules).superseded,false)
assert.equal(assess(c,2027,partial,[paid],[]).superseded,false)
assert.equal(assess(c,2027,partial,[paid],[{...rule,effective_year:2029}]).superseded,false)
assert.match(next(c,1,history,'2026-10-03').reviewReason,/重な/)
const shortContract={...c,maintenance_start_date:'2023-08-01'},short={...paid,periodStart:'2026-08-01',periodEnd:'2026-12-31'},shortRule={...rule,effective_year:2027}
const shortNext=next(shortContract,1,[short],'2026-10-03',[],[shortRule])
assert.equal(shortNext.year,2027);assert.equal(shortNext.date,'2026-12-01');assert.equal(shortNext.periodStart,'2027-01-01')
assert.equal(assess({...c,billing_count:2},2027,partial,[paid],rules).superseded,false,'Two invoices are not waived merely by a long paid period')
// Scan three complete years: no anniversary claim inside the confirmed transition,
// and every December prepayment remains until its matching occurrence is registered.
for(let offset=0;offset<36;offset++){
 const date=new Date(Date.UTC(2026,offset,3)),today=date.toISOString().slice(0,10),y=date.getUTCFullYear(),m=date.getUTCMonth()+1
 const result=alerts([row],recipients,[paid],today,undefined,[],rules)
 const expected=Array.from({length:3},(_,i)=>new Date(Date.UTC(y,m-1+i,1))).filter(d=>d.getUTCMonth()===11&&d.getUTCFullYear()>=2027).map(d=>`${d.getUTCFullYear()}-12-01`)
 assert.deepEqual(Array.from(result.items,x=>x.date),expected,`Missing/extraneous alert in ${today}`)
}
const saved={...paid,id:'2',serviceYear:2028,roundLabel:'第1回',lifecycle:'planned',periodStart:'2028-01-01',periodEnd:'2028-12-31',scheduledDate:'2027-12-01',issuedOn:null,receivedOn:null,frozenAmount:null,frozenLineItems:null,frozenAt:null,plannedAmount:165000}
assert.equal(alerts([row],recipients,[paid,saved],'2027-11-03',undefined,[],rules).items.length,0)
assert.equal(overview([paid,saved],'2027-11-03').upcoming.length,1,'Saved planned prepayment stays in the real work list')
const issued={...saved,lifecycle:'issued',issuedOn:'2027-12-01',plannedAmount:null,frozenAmount:165000,frozenLineItems:[{name:'保守料',amount:165000}],frozenAt:'2027-12-01T00:00:00Z'}
const moved={...saved,scheduledDate:'2027-11-15'}
assert.equal(alerts([row],recipients,[paid,moved],'2027-11-03',undefined,[],rules).items[0].status,'review')
assert.equal(overview([moved],'2027-11-03').upcoming.length,1,'Changing a due date must keep the real saved plan visible')
assert.equal(overview([issued],'2027-12-02').unpaid.length,1,'Next-year service must not vanish after issuing in December')
assert.equal(overview([{...issued,lifecycle:'fixed'}],'2027-12-02').unpaid.length,1)
assert.equal(overview([{...issued,lifecycle:'received',receivedOn:'2027-12-02'}],'2027-12-03').received.length,1)
assert.equal(alerts([row],recipients,[paid,saved],'2028-01-03','2027-09-01',[],rules).items.some(x=>x.date==='2027-12-01'),false,'Matching saved plan remains in the overdue saved-plan list instead')
assert.equal(overview([saved],'2028-01-03').overduePlans.length,1)
assert.equal(alerts([row],recipients,[paid],'2028-01-03','2027-09-01',[],rules).items.some(x=>x.date==='2027-12-01'),true,'Unregistered prior December stays overdue in January')
const stored={project_id:1,service_year:2028,recipient_customer_id:1,collection_method:'invoice',scheduled_date:'2027-12-01',lifecycle:'received',planned_amount:null,round_number:1,period_start:'2028-01-01',period_end:'2028-12-31'}
for(const bad of [{...stored,service_year:2027},{...stored,collection_method:'direct_debit'},{...stored,period_end:'2028-10-26'},{...stored,period_start:null,period_end:null},{...stored,lifecycle:'cancelled'}])assert.equal(coverage([row],recipients,[bad],'2027-12',1,[],rules).candidates[0].status,'review')
assert.equal(coverage([row],recipients,[stored,stored],'2027-12',1,[],rules).candidates[0].status,'review')
const legacyRecord={year:2027,billing_scheduled_date:'2027-12-01',billing_date:'2027-12-01',received_date:'2027-12-02',payments:null}
assert.equal(coverage([{...row,records:[legacyRecord]}],recipients,[],'2027-12',1,[],[]).candidates[0].status,'review','Old date-only evidence cannot hide an unproven period')
const {BillingOverviewPanel}=load('src/components/BillingOverviewPanel.tsx'),{InvoiceLedgerDetail}=load('src/components/InvoiceLedgerDetail.tsx')
const data={units:history,recipients:[{id:1,name:'検証顧客'}],recipientName:()=> '検証顧客',projectName:()=>row.project_name,plannedAmount:()=>null}
const review=alerts([row],recipients,[paid],'2026-11-03')
const html=renderToStaticMarkup(React.createElement(BillingOverviewPanel,{data,today:'2026-11-03',setupItems:review.items}))
assert.ok(html.includes('保存済みの保守期間と重なります'));assert.ok(html.includes('<h3><span>未保存・要確認の請求予定'))
const detail=renderToStaticMarkup(React.createElement(InvoiceLedgerDetail,{data,contract:c,projectId:1,currentRecipientId:1,maintenanceStartDate:c.maintenance_start_date,today:'2026-10-03',onAddSchedule:()=>{throw Error('Render must not write')}}))
assert.ok(detail.includes('保守期間要確認'));assert.ok(detail.includes('予定を確認・調整'));assert.ok(!detail.includes('請求内容を入力して発行'))
assert.equal(JSON.stringify({c,paid,rule,row}),baseline)
console.log('PASS: 36-month long/short transition coverage, no hidden ambiguous/cancelled/moved-date claims, stored-plan and prepayment unpaid continuity, visible review warnings; fixtures unchanged')
