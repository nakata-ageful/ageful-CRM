const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const assert=require('node:assert/strict'),root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){
  file=path.resolve(root,file)
  if(cache.has(file))return cache.get(file).exports
  const module={exports:{}};cache.set(file,module)
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
    {module,exports:module.exports,require:name=>{
      if(!name.startsWith('.'))throw Error('External dependency forbidden')
      return load(path.resolve(path.dirname(file),name)+'.ts')
    }})
  return module.exports
}
const {prepareOwnershipFields:prepare,contractFieldKinds:ck,projectFieldKinds:pk}=load('src/lib/ownership-field-selection.ts')
const project={...Object.fromEntries(Object.keys(pk).map(k=>[k,null])),id:1,customer_id:1,project_name:'架空発電所',old_owner:'以前の所有者',created_at:'2020-01-01'}
const contract={...Object.fromEntries(Object.keys(ck).map(k=>[k,null])),id:1,project_id:1,created_at:'2020-01-01',
  equipment_contract_date:'2020-06-01',sale_contract_date:'2020-06-01',annual_maintenance_inc:82500,
  billing_item_flags:{annual_maintenance:true},notes:'Aの記録'}
const plain=v=>JSON.parse(JSON.stringify(v)),original=JSON.stringify({project,contract})
const kept=prepare(project,contract)
assert.deepEqual(plain(kept.before),{project,contract})
assert.deepEqual(plain(kept.after),{project,contract})
assert.equal(Object.keys(ck).length,54)
assert.ok(Object.values(kept.decisions.contract).every(c=>c.mode==='keep'))
const selected=prepare(project,contract,{contract:{notes:{mode:'clear'},annual_maintenance_inc:{mode:'change',value:90000}},project:{sales_company:{mode:'change',value:'B販売会社'}}})
assert.equal(selected.after.contract.notes,null)
assert.equal(selected.before.contract.notes,'Aの記録')
assert.equal(selected.after.contract.annual_maintenance_inc,90000)
assert.equal(selected.before.contract.annual_maintenance_inc,82500)
assert.equal(selected.after.project.customer_id,1,'System owner change belongs to the transfer RPC')
selected.after.contract.billing_item_flags.annual_maintenance=false
assert.equal(contract.billing_item_flags.annual_maintenance,true)
assert.equal(selected.before.contract.billing_item_flags.annual_maintenance,true)
assert.equal(JSON.stringify({project,contract}),original)
assert.equal(selected.readyToWrite,false)
for(const [group,key] of [['project','customer_id'],['project','old_owner'],['contract','ownership_transfer_date'],['contract','id']]){
  assert.throws(()=>prepare(project,contract,{[group]:{[key]:{mode:'clear'}}}),/システム/)
}
assert.throws(()=>prepare({...project,new_column:'do not drop'},contract),/未分類/)
assert.throws(()=>prepare(project,contract,{contract:{annual_maintenance_inc:{mode:'change',value:'90000'}}}),/形式/)
assert.throws(()=>prepare(project,contract,{contract:{equipment_contract_date:{mode:'change',value:'2026-02-30'}}}),/形式/)
assert.throws(()=>prepare(project,contract,{project:{project_name:{mode:'clear'}}}),/空欄/)
assert.throws(()=>prepare(project,contract,{contract:{equipment_contract_date:{mode:'clear'}}}),/旧売買契約日/)
const cleared=prepare(project,contract,{contract:{equipment_contract_date:{mode:'clear'},sale_contract_date:{mode:'clear'}}})
assert.equal(cleared.after.contract.sale_contract_date,null)
assert.equal(cleared.before.contract.sale_contract_date,'2020-06-01')
// Optional absence stays absent, rather than being silently materialized as null.
const optional={...contract};delete optional.communication_fee
assert.equal(Object.hasOwn(prepare(project,optional).after.contract,'communication_fee'),false)
console.log(`PASS: ${Object.keys(ck).length} Contract / ${Object.keys(pk).length} Project fields, default keep, choices, snapshots, protected fields, unknown keys and legacy fallback guard`)
console.log('Scope: selection preparation only. No DB write or complete billing-condition validation.')
