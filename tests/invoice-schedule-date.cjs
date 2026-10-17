// Synthetic date correspondence only. No authentication, network or business writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file);const m={exports:{}};cache.set(file,m.exports)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:m,exports:m.exports,Date,Map,Set,structuredClone,require:n=>{if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);return load(p+'.ts')}});cache.set(file,m.exports);return m.exports}
const {invoiceScheduleDate:date,invoiceServiceYear:year}=load('src/lib/invoice-schedule-date.ts'),{detailPlanCandidate:candidate}=load('src/lib/billing-detail-plan.ts')
const {inspectFutureBillingCoverage:coverage}=load('src/lib/billing-cutover-coverage.ts'),{reviewFutureSchedule:review}=load('src/lib/future-schedule-review.ts')
const c={id:1,project_id:1,maintenance_start_date:'2025-07-01',billing_method:'請求書',billing_count:1,billing_schedule_days:['6月1日'],annual_maintenance_inc:199820}
assert.equal(date(c,2027,1),'2027-06-01');assert.equal(year(c,'2027-06-01',1),2027)
const paid={id:'1',projectId:1,serviceYear:2026,roundLabel:'保存済み単回記録',method:'請求書',lifecycle:'received',issuedOn:'2026-06-04',receivedOn:'2026-08-27',scheduledDate:null,frozenAmount:199820}
assert.equal(candidate(c,1,[paid],'2026-10-17').date,'2027-06-01')
const wood={...c,maintenance_start_date:'2022-12-23',billing_schedule_days:['11月1日']}
assert.equal(candidate(wood,1,[{...paid,serviceYear:2025}],'2026-10-17').date,'2026-11-01')
for(const days of [['5月1日','11月1日'],['7月14日','1月14日'],['11月1日','5月1日'],['12月1日','12月1日'],['12月31日','1月1日','6月1日']]){
 const contract={...c,billing_count:days.length,billing_schedule_days:days}
 for(let y=2025;y<=2029;y++)for(let round=1;round<=days.length;round++){
  const iso=date(contract,y,round);assert.equal(year(contract,iso,round),y)
  const row={project_id:1,project_name:'合成',customer_name:'合成',contract,records:[]}
  const alert=coverage([row],new Map([[1,1]]),[],iso.slice(0,7),1).candidates.find(x=>x.round===round)
  assert.equal(alert.serviceYear,y);assert.equal(alert.date,iso);assert.equal(alert.periodStart,`${y}-07-01`)
 }
}
assert.equal(date({...c,billing_schedule_days:['7月14日','1月14日']},2026,2),'2027-01-14')
for(let month=1;month<=12;month++)for(let startMonth=1;startMonth<=12;startMonth++){
 const contract={...c,billing_schedule_days:[`${month}月1日`],maintenance_start_date:`2025-${String(startMonth).padStart(2,'0')}-15`}
 assert.equal(date(contract,2027,1),`2027-${String(month).padStart(2,'0')}-01`)
}
for(const days of [[],['13月1日'],['2月30日'],['7月1日',''],['x','1月1日']])assert.equal(date({...c,billing_schedule_days:days},2026,days.length||1),null)
assert.equal(date({...c,billing_schedule_days:['2月29日']},2027,1),null)
assert.equal(date({...c,billing_schedule_days:['2月29日']},2028,1),'2028-02-29')
const rule={id:1,project_id:1,effective_year:2027,mode:'calendar_prepaid'}
assert.equal(candidate(c,1,[paid],'2026-10-17',[],[rule]).date,'2026-12-01','Explicit prior-December rules retain precedence')
const saved={...paid,id:'2',roundLabel:'第1回',serviceYear:2027,scheduledDate:'2027-06-01',lifecycle:'planned',issuedOn:null,receivedOn:null,frozenAmount:null,plannedAmount:199820}
assert.ok(review([{projectId:1,date:'2026-12-01',round:1,serviceYear:2027,method:'invoice'}],[saved])[0].exclusion,'Review uses service year, not issue year')
const original=JSON.stringify([paid,saved]);candidate(c,1,[paid,saved],'2026-10-17');assert.equal(JSON.stringify([paid,saved]),original)
console.log('PASS: prepaid same-year dates, ordered installment rollover, 144 anchor/month combinations, alert/detail identity, leap/invalid dates, explicit cycle priority and immutable saved records')
