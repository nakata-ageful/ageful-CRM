// Synthetic local read adapter only. No DB, network, customer data, or writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const filename=path.resolve(__dirname,'../src/lib/data.ts'),source=fs.readFileSync(filename,'utf8')
const active={id:124,customer_id:1,project_name:'合成・使用中',archived_at:null,created_at:'2026-10-15'}
const archived={...active,id:125,project_name:'合成・保管中',archived_at:'2026-10-15',canonical_project_id:124}
const customer={id:1,name:'架空のお客様',company_name:null,project_count:2}
const contracts=[{id:99,project_id:124,archived_at:'2026-10-15',subcontractor:'保管した委託先'},
 {id:101,project_id:125,archived_at:'2026-10-15'}, {id:100,project_id:125,archived_at:'2026-10-15'},
 {id:98,project_id:124,archived_at:null,subcontractor:'使用中の委託先'}]
const year=new Date().getFullYear(),annual=[{id:1,contract_id:98,year,status:'未請求'},{id:2,contract_id:99,year,status:'未請求'},{id:3,contract_id:100,year,status:'未請求'}]
const maintenance=[{id:1,project_id:124,status:'対応中'},{id:2,project_id:125,status:'対応中'}]
const prospects=[{id:1,new_project_id:124},{id:2,new_project_id:125},{id:3,ownership_project_id:125},{id:4,converted_customer_id:1}]
const tables={customers:[customer],projects:[archived,active],contracts,annual_records:annual,maintenance_responses:maintenance,periodic_maintenance:maintenance,prospects,attachments:[]}
const stores={}
for(const [name,table]of Object.entries({customerStore:'customers',projectStore:'projects',contractStore:'contracts',annualRecordStore:'annual_records',maintenanceResponseStore:'maintenance_responses',periodicMaintenanceStore:'periodic_maintenance',prospectStore:'prospects',attachmentStore:'attachments'}))stores[name]={
 getAll:()=>tables[table],getById:id=>tables[table].find(r=>r.id===id)||null,
 getByCustomerId:id=>tables[table].filter(r=>r.customer_id===id),getByProjectId:id=>tables[table].filter(r=>r.project_id===id),getByContractId:id=>tables[table].filter(r=>r.contract_id===id),
}
function enrich(table,row){
 const value={...row}
 if(table==='projects'){value.customers=customer;value.contracts=contracts.filter(c=>c.project_id===row.id).map(c=>enrich('contracts',c))}
 if(table==='contracts'){value.annual_records=annual.filter(a=>a.contract_id===row.id);value.projects=tables.projects.find(p=>p.id===row.project_id)}
 if(table==='annual_records')value.contracts=enrich('contracts',contracts.find(c=>c.id===row.contract_id))
 if(table==='maintenance_responses'||table==='periodic_maintenance')value.projects={...tables.projects.find(p=>p.id===row.project_id),customers:customer}
 return value
}
const calls=[]
function query(table){
 const call={table,filters:[],select:null};calls.push(call)
 let max=Infinity,one=false,order=null,count=false
 const q={
 select(value,options){call.select=value;count=!!options?.count;return q},
 eq(key,value){call.filters.push(['eq',key,value]);return q},neq(key,value){call.filters.push(['neq',key,value]);return q},
 is(key,value){call.filters.push(['is',key,value]);return q},in(key,value){call.filters.push(['in',key,value]);return q},
 order(key,options){order=[key,options.ascending];return q},limit(n){max=n;return q},single(){one=true;return q},maybeSingle(){one=true;return q},
 then(resolve,reject){try{
  let data=tables[table].map(r=>enrich(table,r)).filter(row=>call.filters.every(([op,key,value])=>{
   const actual=key.split('.').reduce((v,k)=>v?.[k],row)
   return op==='is'?actual==null:op==='eq'?actual===value:op==='neq'?actual!==value:value.includes(actual)
  }))
  if(order)data.sort((a,b)=>(a[order[0]]>b[order[0]]?1:a[order[0]]<b[order[0]]?-1:0)*(order[1]?1:-1))
  const total=data.length;data=data.slice(0,max);return Promise.resolve(resolve({data:one?data[0]??null:data,error:null,count:count?total:null}))
 }catch(e){return reject(e)}},
 };return q
}
function load(hosted){const m={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
 module:m,exports:m.exports,Date,Set,Map,Error,require:name=>{
  if(name==='./supabase')return {hasSupabaseEnv:hosted,billingRuntimePreview:false,supabase:{from:query}}
  if(name==='./mock-store')return stores
  if(name==='./annual-record-status-storage')return {annualRecordFromStorage:r=>r}
  throw Error('Unexpected import '+name)
 },
 });return m.exports}
const ids=rows=>Array.from(rows,r=>r.id)
;(async()=>{
 for(const hosted of [false,true]){
  const api=load(hosted)
  const dash=await api.getDashboard();assert.equal(dash.totalProjects,1);assert.equal(dash.activeMaintenanceCount,1);assert.equal(dash.pendingBillingCount,1)
  assert.equal((await api.getCustomers())[0].project_count,1)
  const projects=await api.getProjects();assert.deepEqual(ids(projects),[124]);assert.equal(projects[0].subcontractor,'使用中の委託先')
  const c=await api.getCustomerDetail(1);assert.equal(c.customer.project_count,1);assert.deepEqual(ids(c.projects),[124]);assert.equal(c.projects[0].subcontractor,'使用中の委託先')
  assert.equal(await api.getProjectIdByCustomerId(1),124)
  const detail=await api.getProjectDetail(124);assert.equal(detail.contract.id,98)
  const old=await api.getProjectDetail(125);assert.equal(old.project.archived_at,'2026-10-15');assert.equal(old.contract.id,100);assert.equal(old.maintenanceResponses.length,1)
  const bill=await api.getBillingRows();assert.equal(bill.length,1);assert.equal(bill[0].project_id,124);assert.equal(bill[0].contract.id,98);assert.equal(bill[0].contract_count,1);assert.equal(bill[0].records.length,1)
  assert.equal((await api.getBillingDetail(124)).contract.id,98);assert.equal(await api.getBillingDetail(125),null)
  assert.deepEqual(ids(await api.getMaintenanceResponses()),[1]);assert.deepEqual(ids(await api.getPeriodicMaintenance()),[1])
  assert.equal(await api.getMaintenanceResponseById(2),null);assert.equal((await api.getMaintenanceResponseById(1)).id,1)
  assert.deepEqual(ids(await api.getProspects()),[1,4])
 }
 // Query-level parent exclusion and inner joins are required; JS contract filtering alone is insufficient for counts.
 assert.ok(calls.some(c=>c.table==='projects'&&c.filters.some(f=>f[0]==='is'&&f[1]==='archived_at')))
 for(const table of ['maintenance_responses','periodic_maintenance'])assert.ok(calls.some(c=>c.table===table&&c.select.includes('projects!inner')&&c.filters.some(f=>f[1]==='projects.archived_at')))
 const count=calls.find(c=>c.table==='annual_records'&&c.select.includes('contracts!inner'))
 assert.ok(count.filters.some(f=>f[1]==='contracts.archived_at'));assert.ok(count.filters.some(f=>f[1]==='contracts.projects.archived_at'))
 console.log('PASS: hosted/mock archive exclusions, customer/dashboard counts, active contract98 selection, preserved archive100 detail, maintenance direct denial, billing and linked prospects')
})().catch(e=>{console.error(e);process.exitCode=1})
