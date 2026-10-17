const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),cache=new Map(),location={hash:''}
function load(f){f=path.resolve(root,f);if(cache.has(f))return cache.get(f).exports;const m={exports:{}};cache.set(f,m)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:m,exports:m.exports,location,structuredClone,crypto:require('node:crypto').webcrypto,Date,Intl,Set,Map,console,require:n=>{if(!n.startsWith('.'))throw Error('Network/client forbidden: '+n);return load(path.resolve(path.dirname(f),n)+'.ts')}});return m.exports}
const demo=load('src/dev/full-demo-runtime.ts'),stores=load('src/lib/mock-store.ts'),plain=x=>JSON.parse(JSON.stringify(x))
;(async()=>{
 demo.seedFullDemo();demo.seedManagementDemo()
 const projects=stores.projectStore.getAll().filter(p=>p.project_name.startsWith('練習①')||p.project_name.startsWith('練習②')||p.project_name.startsWith('練習③'))
 assert.equal(projects.length,3)
 const reload=()=>demo.loadBillingRuntime(),save=(action,value)=>demo.saveBillingRuntime({action,value},reload),year=new Date().getFullYear(),owner=stores.customerStore.getAll()[0].id
 let snapshot=await reload(),projectId=projects[0].id,own=snapshot.units.filter(u=>u.projectId===projectId),paid=plain(own.find(u=>u.lifecycle==='received')),planned=own.find(u=>u.lifecycle==='planned')
 await save('management',{projectId,expectedLast:0,scope:'maintenance',action:'end',date:`${year}-10-01`,reason:'練習で保守終了',choices:[{unitId:planned.id,expectedRevision:planned.revision,action:'cancel',amount:null}]})
 snapshot=await reload();assert.equal(snapshot.units.find(u=>u.id===planned.id).lifecycle,'cancelled');assert.deepEqual(plain(snapshot.units.find(u=>u.id===paid.id)),paid)
 await save('management',{projectId,expectedLast:1,scope:'maintenance',action:'resume',date:`${year}-10-02`,reason:'練習で再開',choices:[]})
 snapshot=await reload();assert.equal(snapshot.managementEvents.length,2);assert.equal(snapshot.units.find(u=>u.id===planned.id).lifecycle,'cancelled','Resume never revives a cancelled plan')
 projectId=projects[1].id;const contract=stores.contractStore.getByProjectId(projectId),item={year,round:1,method:'invoice',date:`${year}-12-01`,periodStart:`${year}-01-01`,periodEnd:`${year}-12-31`,recipientId:owner,amount:165000}
 const req={projectId,contract,items:[item],reason:'練習で追加'}
 await save('future_schedule',req);const before=JSON.stringify(await reload());await assert.rejects(save('future_schedule',req),/保存済み/);assert.equal(JSON.stringify(await reload()),before,'Failed duplicate never changes demo state')
 snapshot=await reload();const u=snapshot.units.find(u=>u.projectId===projectId&&u.lifecycle==='planned')
 await save('plan',{projectId,reason:'予定額変更の練習',choices:[{unitId:u.id,expectedRevision:u.revision,recipientId:owner,method:'請求書',scheduledDate:u.scheduledDate,plannedAmount:123000,periodStart:u.periodStart,periodEnd:u.periodEnd,note:'練習'}]})
 snapshot=await reload();assert.equal(snapshot.units.find(v=>v.id===u.id).plannedAmount,123000)
 await save('debit_add',{projectId:projects[2].id,recipient:owner,year:year+1,month:1,date:`${year+1}-01-25`,amount:10000,note:'練習',reason:'振替予定追加の練習'})
 snapshot=await reload();assert(snapshot.units.some(u=>u.projectId===projects[2].id&&u.roundLabel==='1月分'&&u.method==='口座振替'));assert.equal(snapshot.events.length,4)
 assert(stores.projectStore.getAll().every(p=>p.project_name.startsWith('練習')))
 assert(fs.readFileSync(path.join(root,'src/dev/full-demo-supabase.ts'),'utf8').includes('supabase=null'))
 console.log('PASS: isolated real-App practice seed, end/cancel/resume without revival, unchanged paid history, add/duplicate rollback, planned amount changes, debit month creation and audit entries')
})().catch(e=>{console.error(e);process.exitCode=1})
