// Execute real action bodies with synthetic stores; no live customer data or DB.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path')
const source=fs.readFileSync(path.join(__dirname,'../src/lib/actions.ts'),'utf8'),ast=ts.createSourceFile('actions.ts',source,ts.ScriptTarget.Latest,true)
const names=new Set(['createProspect','convertProspectToCustomer','createContract'])
const code=ts.transpileModule(ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const projects=[],contracts=[],prospects=[],customers=[{id:1,name:'架空の顧客'}]
const ctx={exports:{},hasSupabaseEnv:false,crypto:require('node:crypto').webcrypto,
 customerStore:{getById:id=>customers.find(c=>c.id===id)},
 projectStore:{getById:id=>projects.find(p=>p.id===id)},
 contractStore:{getAll:()=>contracts,create:v=>{const c={...v,id:contracts.length+1};contracts.push(c);return c},update:(id,v)=>Object.assign(contracts.find(c=>c.id===id),v)},
 prospectStore:{create:v=>{const p={...v,id:prospects.length+1};prospects.push(p);return p}},
 createCustomer:async v=>{const c={...v,id:customers.length+1};customers.push(c);return c},
 createProject:async v=>{const p={...v,id:projects.length+1};projects.push(p);contracts.push({id:contracts.length+1,project_id:p.id});return p},
 updateProspect:async(id,v)=>Object.assign(prospects.find(p=>p.id===id),v),isOwnershipProspect:p=>p.ownership_project_id!=null,
 toInt:v=>v?Number(v):null,toFloat:v=>v?Number(v):null,buildTaskMap:()=>({}),buildSubTaskMap:()=>({})}
vm.createContext(ctx);vm.runInContext(code+';globalThis.actions={createProspect,convertProspectToCustomer,createContract}',ctx)
;(async()=>{
 const input={customer_name:'架空A',project_name:'架空発電所',existing_customer_id:1}
 await ctx.actions.createProspect(input)
 assert.equal(projects.length,1);assert.equal(contracts.length,1,'known customer prospect must not insert another contract')
 await ctx.actions.createProspect({...input,existing_customer_id:undefined,customer_name:'架空B'})
 assert.equal(projects.length,2);assert.equal(contracts.length,2,'new customer prospect must create exactly one contract')
 const legacy={id:3,customer_name:'架空C',project_name:'架空C発電所',sale_contract_date:'2026-10-01',loan_company:'架空ローン',loan_amount:100000}
 prospects.push(legacy)
 const converted=await ctx.actions.convertProspectToCustomer(legacy)
 assert.equal(projects.length,3);assert.equal(contracts.length,3,'conversion updates the initial contract instead of inserting')
 assert.equal(contracts[2].sale_contract_date,'2026-10-01');assert.match(contracts[2].notes,/架空ローン/)
 assert.equal(await ctx.actions.convertProspectToCustomer(legacy),converted);assert.equal(projects.length,3,'already converted prospect cannot create again')
 await assert.rejects(ctx.actions.createContract(1,{}),/登録済み/)
 projects.push({id:4,archived_at:'2026-10-15T00:00:00Z'})
 await assert.rejects(ctx.actions.createContract(4,{}),/保管中/)
 // Remote conversion may update exactly one active contract; never INSERT.
 ctx.hasSupabaseEnv=true;let updates=0,inserts=0
 ctx.createCustomer=async()=>({id:99});ctx.createProject=async()=>({id:99});ctx.updateProspect=async()=>{}
 ctx.db=()=>({from:table=>{assert.equal(table,'contracts');const q={select(){return q},eq(){return q},is(k,v){assert.equal(k,'archived_at');assert.equal(v,null);return q},single:async()=>({data:{id:99},error:null}),then:resolve=>resolve({data:[{id:99}],error:null}),update(v){updates++;assert.equal(v.project_id,99);return q},insert(){inserts++;throw Error('No extra contract insert')}};return q}})
 await ctx.actions.convertProspectToCustomer({...legacy,id:4,converted_customer_id:null})
 assert.equal(updates,1);assert.equal(inserts,0)
 console.log('PASS: real known/new customer prospect creation and legacy conversion create exactly one contract; repeat conversion, duplicate contract insert and archived project are protected; remote conversion uses UPDATE only')
})().catch(e=>{console.error(e);process.exitCode=1})
