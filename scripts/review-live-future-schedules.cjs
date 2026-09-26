// Reads a private snapshot obtained through the real owner's inspection RPC.
// Candidate dates are calendar reminders, NOT confirmed maintenance periods/claims.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),cache=new Map();
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file);const module={exports:{}};cache.set(file,module.exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports,require:name=>{if(!name.startsWith('.'))throw Error('External dependency');return load(path.resolve(path.dirname(file),name)+'.ts')}});return module.exports;}
const input=process.argv[2],today=process.argv[3]||'2026-09-26',dir='/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups/';
if(!input||!path.resolve(input).startsWith(dir))throw Error('Private snapshot required');
const s=JSON.parse(fs.readFileSync(input)),sourceBefore=JSON.stringify(s);
assert.equal(s.mode,'read_only_inspection');assert.equal(s.future_schedule_coverage_verified,false);
const customers=new Map(s.customers.map(c=>[c.id,c])),byProject=new Map();
for(const c of s.contracts){const list=byProject.get(c.project_id)||[];list.push(c);byProject.set(c.project_id,list);}
const rows=s.projects.map(p=>{const cons=byProject.get(p.id)||[],contract=cons.length===1?cons[0]:null,records=contract?s.annual_records.filter(a=>a.contract_id===contract.id):[],year=Number(today.slice(0,4)),current=records.filter(a=>a.year===year);return {project_id:p.id,project_name:p.project_name,customer_name:customers.get(p.customer_id)?.name||'',company_name:null,contract,contract_count:cons.length,records,currentYear:year,currentYearRecord:current[0]||null,currentYearRecords:current};});
const {billingUnitFromStorage}=load('src/lib/billing-unit-storage.ts'),{managementEventFromStorage}=load('src/lib/management-lifecycle.ts'),{inspectFutureBillingCoverage,legacyScheduleSetupReview}=load('src/lib/billing-cutover-coverage.ts');
const recipients=new Map(s.projects.map(p=>[p.id,p.customer_id])),units=s.units.map(billingUnitFromStorage),events=s.management_events.map(managementEventFromStorage);
const setup=legacyScheduleSetupReview(rows,recipients,units,today,undefined,events),coverage=inspectFutureBillingCoverage(rows.filter(r=>r.contract_count===1),recipients,s.units,today.slice(0,7),24,events);
const groups=Object.fromEntries([...new Set(setup.issues.map(i=>i.code))].map(code=>[code,setup.issues.filter(i=>i.code===code).length]));
assert.equal(new Set(setup.issues.map(i=>i.projectId)).size,setup.issues.length);
assert.equal(JSON.stringify(s),sourceBefore);assert.equal(s.units.length,32);assert.equal(s.units.reduce((n,u)=>n+Number(u.frozen_amount||0),0),4177465);
console.log(JSON.stringify({scope:'real Auth read-only snapshot; calendar reminders only',today,projects:rows.length,storedUnits:units.length,setupIssues:setup.issues.length,issueGroups:groups,calendar24Months:coverage.summary,invoiceCandidates:coverage.candidates.filter(c=>c.method==='invoice').length,debitReminderCandidates:coverage.candidates.filter(c=>c.method==='direct_debit').length,undatedSavedPlans:coverage.undatedSavedPlans,nearTermInvoiceReminders:setup.items.filter(i=>i.method==='invoice').length,allReviewCandidatesVisible:coverage.candidates.filter(c=>c.status==='review').every(c=>!!c.reason),authorizesCutover:false,rowsWritten:0}));
