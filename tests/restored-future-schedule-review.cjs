// Read-only 24-month schedule classification against a migrated local clone.
// Never reads .env and never connects over TCP/network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const {execFileSync}=require('node:child_process'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports
 const module={exports:{}};cache.set(file,module)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
  {module,exports:module.exports,require:name=>{if(!name.startsWith('.'))throw Error('External dependency forbidden');return load(path.resolve(path.dirname(file),name)+'.ts')}})
 return module.exports
}
const {inspectFutureBillingCoverage,legacyScheduleSetupReview}=load('src/lib/billing-cutover-coverage.ts')
const {billingUnitFromStorage}=load('src/lib/billing-unit-storage.ts')
const [backupFile,psql,socket,port='55432',database='ageful_new_candidate',startMonth='2026-09']=process.argv.slice(2)
if(!backupFile||!psql||!socket)throw Error('Usage: node tests/restored-future-schedule-review.cjs BACKUP PSQL SOCKET [PORT] [DATABASE] [START_MONTH]')
if(!path.resolve(socket).startsWith('/private/tmp/ageful-pg-tools.'))throw Error('Only a disposable local clone socket is allowed')
const query=sql=>JSON.parse(execFileSync(psql,[`--host=${socket}`,`--port=${port}`,`--dbname=${database}`,'--no-psqlrc','--tuples-only','--no-align','--set=ON_ERROR_STOP=1','--command',sql],{encoding:'utf8',maxBuffer:20_000_000}).trim())
const data=JSON.parse(fs.readFileSync(backupFile,'utf8'))
const units=query("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text from public.billing_units t")
const management=query("select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text from public.project_management_events t")
const recipients=new Map(data.projects.map(p=>[p.id,p.customer_id]))
const rows=data.projects.map(p=>{const contracts=data.contracts.filter(c=>c.project_id===p.id),contract=contracts[0]??null,customer=data.customers.find(c=>c.id===p.customer_id)
 return {project_id:p.id,project_name:p.project_name,customer_name:customer?.company_name??customer?.name??'-',company_name:customer?.company_name??null,
  contract,contract_count:contracts.length,records:contract?data.annual_records.filter(a=>a.contract_id===contract.id):[],currentYearRecord:null,currentYearRecords:[],currentYear:2026}
})
const safe=rows.filter(r=>r.contract_count===1)
const coverage=inspectFutureBillingCoverage(safe,recipients,units,startMonth,24,management)
const nearTerm=legacyScheduleSetupReview(rows,recipients,units.map(u=>billingUnitFromStorage(u)),`${startMonth}-20`)
const classifications=[]
for(const row of rows){
 const issue=row.contract_count!==1?{reason:'契約が複数または未設定'}:coverage.issues.find(i=>i.projectId===row.project_id)
 const candidates=coverage.candidates.filter(c=>c.projectId===row.project_id)
 const state=issue?'configuration_issue':candidates.some(c=>c.status==='review')?'review_required':candidates.some(c=>c.status==='missing')?'unsaved_expected':candidates.some(c=>c.status==='matches')?'saved_match':'no_billable_schedule'
 classifications.push({projectId:row.project_id,state,reason:issue?.reason??null,candidateCount:candidates.length})
}
assert.equal(classifications.length,data.projects.length)
assert.equal(new Set(classifications.map(x=>x.projectId)).size,data.projects.length)
assert.equal(coverage.candidates.length,coverage.summary.matching+coverage.summary.missing+coverage.summary.review)
const counts=classifications.reduce((r,x)=>(r[x.state]=(r[x.state]??0)+1,r),{})
const result={passed:true,scope:'read-only 24-month review of committed disposable local clone',startMonth,months:24,totalProjects:data.projects.length,
 classifiedProjects:classifications.length,projectStates:counts,candidateStates:coverage.summary,settingIssues:coverage.issues.length,
 undatedSavedPlans:coverage.undatedSavedPlans,nearTermVisibleItems:nearTerm.items.length,
 nearTermVisibleReviews:nearTerm.items.filter(i=>i.status==='review').length,nearTermConfigurationIssues:new Set(nearTerm.issues.map(i=>i.projectId)).size,
 hiddenReviewCandidates:false,guessedSchedulesCreated:false,authorizesPerpetualCoverage:false}
console.log(JSON.stringify(result,null,2))
