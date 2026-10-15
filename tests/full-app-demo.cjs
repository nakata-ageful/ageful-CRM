// The full App uses these fake stores only in operator-demo; no network/auth clients.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),cache=new Map(),location={hash:''}
function load(f){f=path.resolve(root,f);if(cache.has(f))return cache.get(f).exports;const m={exports:{}};cache.set(f,m)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:m,exports:m.exports,location,structuredClone,crypto:require('node:crypto').webcrypto,Date,Intl,Set,Map,console,require:n=>{if(!n.startsWith('.'))throw Error('External client forbidden: '+n);return load(path.resolve(path.dirname(f),n)+'.ts')}});return m.exports}
const demo=load('src/dev/full-demo-runtime.ts'),stores=load('src/lib/mock-store.ts')
;(async()=>{
 demo.seedFullDemo();const p=stores.projectStore.getAll()[0],c=stores.contractStore.getByProjectId(p.id),people=stores.customerStore.getAll()
 assert.equal(people.length,2);assert.equal(stores.projectStore.getAll().length,1);assert.equal(stores.prospectStore.getAll().length,0)
 assert.ok(people.every(c=>c.name.startsWith('練習用')));assert.equal(location.hash,`project-detail/${p.id}`)
 const reload=()=>demo.loadBillingRuntime(),write=(action,value)=>demo.saveBillingRuntime({action:'ownership_workflow',value:{action,value}},reload)
 await write('start',{projectId:p.id,customerId:null});const pr=stores.prospectStore.getAll()[0]
 assert.equal(pr.ownership_project_id,p.id);assert.equal(pr.candidate_customer_id,null);assert.equal(stores.projectStore.getById(p.id).customer_id,people[0].id)
 await write('candidate',{projectId:p.id,prospectId:pr.id,customerId:people[1].id});assert.equal(stores.prospectStore.getById(pr.id).candidate_customer_id,people[1].id)
 const before=(await reload()).units[0]
 const transfer={project:p,contract:c,newOwner:people[1].id,futureRecipient:people[1].id,date:'2026-10-15',fields:{contract:{}},procedureConfirmed:true,reason:'合成確認',choices:[{unitId:before.id,expectedRevision:before.revision,recipientId:people[1].id,method:'請求書',scheduledDate:'2026-12-01',plannedAmount:165000,periodStart:'2027-01-01',periodEnd:'2027-12-31',note:''}]}
 await write('complete',{projectId:p.id,prospectId:pr.id,transfer})
 assert.equal(stores.projectStore.getById(p.id).customer_id,people[1].id);assert.equal((await reload()).units[0].recipientId,people[1].id)
 assert.equal(stores.prospectStore.getById(pr.id).ownership_state,'completed');assert.equal(stores.projectStore.getAll().length,1)
 const isolation=fs.readFileSync(path.join(root,'src/dev/full-demo-supabase.ts'),'utf8');assert.ok(isolation.includes('supabase=null'));assert.ok(!isolation.includes('createClient'))
 const entry=fs.readFileSync(path.join(root,'src/dev/full-app-demo.tsx'),'utf8');assert.ok(entry.includes("import App from '../App'"));assert.ok(entry.includes("MODE==='operator-demo'"))
 console.log('PASS: real App entry, isolated synthetic stores, undecided→candidate→complete, payer update, no duplicate project and no network client')
})().catch(e=>{console.error(e);process.exitCode=1})
