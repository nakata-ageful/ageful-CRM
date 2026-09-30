// Execute the actual handlers with isolated dependencies. No real DB/network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=path.resolve(__dirname,'..');
function fn(file,name){const source=ts.createSourceFile(file,fs.readFileSync(path.join(root,file),'utf8'),ts.ScriptTarget.Latest,true);let node;
 function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)node=n;ts.forEachChild(n,visit)}visit(source);assert(node,name);
 return ts.transpileModule(node.getText(source).replace(/^export /,''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;}
function load(file){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports});return module.exports;}
const {contractSectionPatch,contractSectionKeys}=load('src/lib/contract-section-patch.ts');
async function main(){
 const original={billing_method:'口座振替',billing_count:12,billing_schedule_days:['10日'],billing_amount_overrides:{2:100},billing_item_flags:{insurance:false},
  ownership_transfer_date:'2026-09-01',subcontract_notes:'変更前',subcontract_billing_day:'12月1日',notes:'請求の備考'};
 for(const section of Object.keys(contractSectionKeys)){
  let saved;const form=new Proxy({...original,billing_count:'12',subcontract_notes:'備考だけ変更'},{get:(t,k)=>k in t?t[k]:''});
  const context={editSection:section,PROJECT_SECTIONS:[],CONTRACT_SECTIONS:Object.keys(contractSectionKeys),projForm:{},contractForm:form,contract:{id:1},
   contractSectionPatch,setSaving(){},setErr(e){if(e)throw Error(e)},setEditSection(){},onReload(){},toast(){},updateContract:async(id,p)=>{assert.equal(id,1);saved=p}};
  vm.createContext(context);vm.runInContext(fn('src/views/ProjectDetail.tsx','handleSaveSection')+';globalThis.run=handleSaveSection',context);await context.run();
  assert.deepEqual(Object.keys(saved).sort(),[...contractSectionKeys[section]].sort());
  if(section!=='billing')for(const k of ['billing_method','billing_schedule_days','billing_count','billing_item_flags','billing_amount_overrides','notes'])assert(!Object.hasOwn(saved,k),`${section} resubmitted ${k}`);
  else assert.deepEqual(JSON.parse(JSON.stringify(saved.billing_schedule_days)),['10日']);
  assert(!Object.hasOwn(saved,'ownership_transfer_date'));
  const merged={...original,...saved};assert.deepEqual(JSON.parse(JSON.stringify(merged.billing_schedule_days)),['10日']);
 }
 assert.throws(()=>contractSectionPatch('__proto__',{}),/区分/);
 let request;const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const failure={code:'P0001',message:'contract insert failed'};
 const context={hasSupabaseEnv:true,projectPayload:()=>({project_name:'架空案件',billing_schedule_days:undefined}),db:()=>({
  from(){throw Error('Two separate writes must not be used')},rpc:async(name,args)=>{request={name,args};return{data:null,error:failure}}})};
 vm.createContext(context);vm.runInContext(fn('src/lib/actions.ts','createProject')+';globalThis.run=createProject',context);
 await assert.rejects(context.run({customer_id:123},id),e=>e===failure);
 assert.equal(request.name,'create_project_with_contract');assert.equal(request.args.p_key,id);assert.equal(request.args.p_customer_id,123);
 assert(!Object.hasOwn(request.args.p_project,'customer_id'));
 context.db=()=>({rpc:async()=>({data:{id:456,customer_id:123,project_name:'架空案件'},error:null})});
 assert.equal((await context.run({customer_id:123},id)).id,456);
 context.db=()=>({rpc:async()=>({data:null,error:null})});await assert.rejects(context.run({customer_id:123},id),/保存結果/);
 console.log('PASS: actual section handlers isolate all six contract sections, preserve non-25 debit day/overrides/ownership date; actual createProject uses one atomic RPC and propagates failures.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
