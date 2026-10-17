// Actual createProspect/createCustomer with a recording DB stub; synthetic data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),ast=ts.createSourceFile('actions.ts',fs.readFileSync(path.join(root,'src/lib/actions.ts'),'utf8'),ts.ScriptTarget.Latest,true)
const names=new Set(['createProspect','createCustomer','toInt','toFloat']),source=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n')
const tables={customers:[{id:7,name:'既存 担当',name_kana:'キソン タントウ',company_name:'既存法人',company_name_kana:'キソンホウジン',is_corporate:true}],prospects:[],projects:[],contracts:[],invoice_units:[{id:11,frozen_amount:82500}]},writes=[]
function db(){return {from(table){assert.ok(['customers','prospects'].includes(table),'No unrelated tables may be accessed');let row=null,id=null;return {
 insert(p){assert.ok(table!=='prospects'||!('company_name_kana'in p),'Company kana must not be sent as a nonexistent prospects column');row={id:100+tables[table].length,...structuredClone(p)};tables[table].push(row);writes.push([table,'insert',structuredClone(p)]);return this},
 select(){return this},eq(_k,v){id=v;return this},update(p){throw Error('Existing customer must not be changed in these scenarios: '+JSON.stringify(p))},async single(){return {data:row??tables[table].find(x=>x.id===id),error:null}}
 }}}}
const ctx={exports:{},Date,hasSupabaseEnv:true,db,EMAIL_RE:/^[^\s@]+@[^\s@]+\.[^\s@]+$/,console,buildTaskMap:()=>({}),buildSubTaskMap:()=>({}),createProject:async p=>{const row={id:tables.projects.length+1,...structuredClone(p)};tables.projects.push(row);tables.contracts.push({project_id:row.id});return row}}
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,ctx)
const base={customer_name:'合成 担当',customer_name_kana:'ゴウセイ タントウ',company_name:'合成法人',company_name_kana:' ゴウセイホウジン ',is_corporate:true,project_name:'合成法人発電所',loan_company:'なし',equipment:'',land_cost:'',loan_amount:'',site_address:'',panel_kw:'',sales_company:'',referrer:'',lead_date:''}
;(async()=>{
 const originalExisting=JSON.stringify(tables.customers[0]),originalInvoices=JSON.stringify(tables.invoice_units)
 const pr=await ctx.exports.createProspect(base,'synthetic-key')
 const customer=tables.customers.find(c=>c.id===pr.converted_customer_id)
 assert.equal(customer.company_name,'合成法人');assert.equal(customer.company_name_kana,'ゴウセイホウジン');assert.equal(customer.name,'合成 担当');assert.equal(customer.name_kana,'ゴウセイ タントウ');assert.equal(customer.is_corporate,true)
 assert.equal(pr.customer_name,'合成 担当');assert.equal(pr.customer_name_kana,'ゴウセイ タントウ');assert.equal(tables.projects[0].customer_id,customer.id);assert.equal(tables.contracts.length,1)
 const person=await ctx.exports.createProspect({...base,is_corporate:false,company_name:'',company_name_kana:'残さない法人カナ',project_name:'合成個人発電所'},'person-key')
 assert.equal(tables.customers.find(c=>c.id===person.converted_customer_id).company_name_kana,null)
 const count=tables.customers.length,existing=await ctx.exports.createProspect({...base,existing_customer_id:7,company_name_kana:'上書きしてはいけないカナ',project_name:'既存法人の追加発電所'},'existing-key')
 assert.equal(existing.converted_customer_id,7);assert.equal(tables.customers.length,count);assert.equal(JSON.stringify(tables.customers[0]),originalExisting);assert.equal(JSON.stringify(tables.invoice_units),originalInvoices)
 assert.equal(tables.projects.length,3);assert.equal(tables.contracts.length,3);assert.equal(writes.filter(([t])=>t==='customers').length,2)
 console.log('PASS: corporate company/contact kana kept separate through real customer/prospect writers, no phantom prospects column, individual clearing, no existing-customer overwrite, one initial contract per project and unchanged invoices; no real DB')
})().catch(e=>{console.error(e);process.exitCode=1})
