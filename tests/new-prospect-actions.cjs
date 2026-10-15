// Synthetic execution of the real actions. No DB, credentials or real customer data.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path')
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'src/lib/actions.ts'),'utf8')
const ast=ts.createSourceFile('actions.ts',source,ts.ScriptTarget.Latest,true)
const names=new Set(['toInt','toFloat','createUndecidedProspect','assignNewProspectCustomer','updateProspect','createProspect'])
const functions=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n')
function store(rows=[]){return {rows,getAll(){return this.rows},getById(id){return this.rows.find(r=>r.id===id)},create(v){const r={...v,id:this.rows.length+1};this.rows.push(r);return r},update(id,v){this.rows=this.rows.map(r=>r.id===id?{...r,...v}:r);return this.getById(id)}}}
const people=store([{id:1,name:'架空A',is_corporate:false},{id:2,name:'架空B',is_corporate:false}]),projects=store([{id:1,customer_id:1,project_name:'架空の既存発電所'}]),contracts=store([{id:1,project_id:1,billing_method:'請求書'}]),prospects=store()
let sync=0
const ctx={exports:{},hasSupabaseEnv:false,customerStore:people,projectStore:projects,contractStore:contracts,prospectStore:prospects,pendingDemoRequests:new Map(),Date,JSON,crypto:require('node:crypto').webcrypto,
 buildTaskMap:()=>({確認書:false}),buildSubTaskMap:()=>({}),isOwnershipProspect:p=>p.ownership_project_id!=null,syncProspectToCustomerProject:()=>sync++}
vm.createContext(ctx);vm.runInContext(ts.transpileModule(functions,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText+';globalThis.actions={createProspect,assignNewProspectCustomer,updateProspect}',ctx)
const plain=x=>JSON.parse(JSON.stringify(x))
;(async()=>{
 const original=plain({people:people.rows,project:projects.rows[0],contracts:contracts.rows})
 const input={customer_undecided:true,customer_name:'',customer_name_kana:'',project_name:'架空新規未定',equipment:'165,000',land_cost:'',loan_amount:'',panel_kw:'',loan_company:'',site_address:'',sales_company:'',referrer:'',lead_date:''}
 const pr=await ctx.actions.createProspect(input,'same-key'),p=projects.getById(pr.new_project_id)
 assert.equal(people.rows.length,2);assert.equal(projects.rows.length,2);assert.equal(contracts.rows.length,2);assert.equal(prospects.rows.length,1)
 assert.equal(p.customer_id,null);assert.equal(p.customer_pending,true);assert.equal(pr.converted_customer_id,null);assert.equal(pr.equipment,165000)
 await ctx.actions.createProspect(input,'same-key');assert.equal(projects.rows.length,2)
 await assert.rejects(ctx.actions.createProspect({...input,project_name:'別案件'},'same-key'),/別の内容/)
 await ctx.actions.updateProspect(pr.id,{apply_memo:'架空メモ'},1);assert.equal(sync,0)
 await assert.rejects(ctx.actions.updateProspect(pr.id,{converted_customer_id:2},1),/顧客を設定/)
 const updated=await ctx.actions.assignNewProspectCustomer(prospects.getById(pr.id),p,2,'assign-key')
 assert.equal(updated.converted_customer_id,2);assert.equal(projects.getById(p.id).customer_id,2);assert.equal(projects.getById(p.id).customer_pending,false)
 assert.equal(projects.rows.length,2);assert.equal(contracts.rows.length,2)
 assert.deepEqual(plain(people.rows),original.people);assert.deepEqual(plain(projects.rows[0]),original.project);assert.deepEqual(plain(contracts.rows[0]),original.contracts[0])
 const backupSource=fs.readFileSync(path.join(root,'src/lib/backup-reader.ts'),'utf8'),m={exports:{}}
 vm.runInNewContext(ts.transpileModule(backupSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module:m,exports:m.exports,Set,Map})
 const backup={customers:people.rows,projects:[{id:9,customer_pending:true,customer_id:null}],contracts:[],annual_records:[],maintenance_responses:[],periodic_maintenance:[],prospects:[{id:9,new_project_id:9,converted_customer_id:null}]}
 m.exports.checkBackupRelations(backup)
 assert.throws(()=>m.exports.checkBackupRelations({...backup,prospects:[]}),/顧客未定/)
 ctx.hasSupabaseEnv=true;ctx.db=()=>({rpc:async()=>({data:{prospectId:9},error:null}),from:()=>({select(){return this},eq(){return this},single:async()=>({data:null,error:{code:'42501',message:'read denied'}})})})
 await assert.rejects(ctx.actions.createProspect(input,'remote-key'),e=>!e.code&&/保存は完了/.test(e.message),'A read failure after committed RPC must remain uncertain, never be treated as a rejected insert')
 console.log('PASS: real actions create without customer, same-key retry, isolated metadata edits, initial assignment without duplicate project/contract, backup links and unrelated records preserved')
})().catch(e=>{console.error(e);process.exitCode=1})
