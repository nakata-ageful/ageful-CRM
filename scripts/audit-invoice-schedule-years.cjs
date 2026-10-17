// Read-only local backup audit. Prints IDs/date correspondence, never contacts, credentials or amounts.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),input=process.argv[2],today=process.argv[3]
if(!input||!/^\d{4}-\d{2}-\d{2}$/.test(today??''))throw Error('Usage: node scripts/audit-invoice-schedule-years.cjs <private-backup.json> <YYYY-MM-DD>')
const backup=JSON.parse(fs.readFileSync(input,'utf8')),original=JSON.stringify(backup),caches=[new Map(),new Map()]
function load(file,old=false){file=path.resolve(root,file);const cache=caches[Number(old)];if(cache.has(file))return cache.get(file);const m={exports:{}}
 const source=old?cp.execFileSync('git',['show',`756f0a1:${path.relative(root,file)}`],{cwd:root,encoding:'utf8'}):fs.readFileSync(file,'utf8')
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:m,exports:m.exports,Date,Map,Set,structuredClone,require:n=>{if(!n.startsWith('.'))throw Error('External dependency forbidden');return load(path.resolve(path.dirname(file),n)+'.ts',old)}});cache.set(file,m.exports);return m.exports}
const unitFrom=load('src/lib/billing-unit-storage.ts').billingUnitFromStorage
const units=backup.billing_units.map(unitFrom),rules=backup.billing_cycle_rules,events=backup.project_management_events
const candidate=load('src/lib/billing-detail-plan.ts').detailPlanCandidate,oldCandidate=load('src/lib/billing-detail-plan.ts',true).detailPlanCandidate
const {invoiceScheduleDate:date}=load('src/lib/invoice-schedule-date.ts')
const {reviewScheduleDateChanges:review}=load('src/lib/billing-schedule-change.ts')
const result={activeProjects:0,invoiceContracts:0,changedReferences:[],savedPlannedDifferences:[],ambiguousContracts:[],errors:[]}
for(const p of backup.projects.filter(p=>!p.archived_at)){
 result.activeProjects++
 const contracts=backup.contracts.filter(c=>c.project_id===p.id&&!c.archived_at)
 if(contracts.length!==1){result.ambiguousContracts.push(p.id);continue}
 const c=contracts[0];if(c.billing_method!=='請求書')continue
 result.invoiceContracts++
 try{
  const before=oldCandidate(c,p.customer_id??0,units,today,events,rules),after=candidate(c,p.customer_id??0,units,today,events,rules)
  if(before?.date!==after?.date)result.changedReferences.push({projectId:p.id,year:after?.year,round:after?.round,before:before?.date,after:after?.date,periodStart:after?.periodStart,periodEnd:after?.periodEnd})
  for(const u of units.filter(u=>u.projectId===p.id&&u.lifecycle==='planned'&&!u.removedAt&&u.method==='請求書')){
   const round=/^第(\d+)回$/.exec(u.roundLabel)?.[1]
   if(!round)continue
   const explicit=load('src/lib/billing-cycle.ts').cycleInvoiceDate(c,u.serviceYear,rules)
   const expected=explicit??date(c,u.serviceYear,Number(round))
   if(expected&&u.scheduledDate!==expected)result.savedPlannedDifferences.push({projectId:p.id,unitId:u.id,year:u.serviceYear,saved:u.scheduledDate,basicSetting:expected,editable:(review(c,c,units,today,rules,events)?.editable??[]).some(x=>x.unit.id===u.id)})
  }
 }catch(e){result.errors.push({projectId:p.id,message:e.message})}
}
if(JSON.stringify(backup)!==original)throw Error('Audit mutated source data')
console.log(JSON.stringify(result,null,2));if(result.errors.length)process.exitCode=1
