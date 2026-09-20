const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports
 const module={exports:{}};cache.set(file,module)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
  {module,exports:module.exports,require:name=>{if(!name.startsWith('.'))throw Error('External dependency forbidden');return load(path.resolve(path.dirname(file),name)+'.ts')}})
 return module.exports
}
const {legacyScheduleSetupItems}=load('src/lib/billing-cutover-coverage.ts')
const plain=value=>JSON.parse(JSON.stringify(value))
const contract={project_id:1,billing_method:'請求書',billing_schedule_days:['9月25日','11月25日'],annual_maintenance_inc:120000,
 billing_item_flags:{annual_maintenance:true,land_cost:false,insurance:false,local_association:false,communication:false,other:false}}
const row={project_id:1,project_name:'設定待ち発電所',customer_name:'現在の顧客',company_name:null,contract,records:[],currentYearRecord:null,currentYearRecords:[],currentYear:2026}
const before=JSON.stringify(row),recipients=new Map([[1,10]])
const missing=legacyScheduleSetupItems([row],recipients,[],'2026-09-20')
assert.deepEqual(plain(missing.map(x=>[x.date,x.method,x.amount])),[['2026-09-25','invoice',60000],['2026-11-25','invoice',60000]])
const stored={id:'1',projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',scheduledDate:'2026-09-25',issuedOn:null,receivedOn:null,
 paymentDueOn:null,recipientId:10,lifecycle:'planned',frozenAmount:null,frozenLineItems:null,frozenAt:null,plannedAmount:60000,revision:0}
assert.deepEqual(plain(legacyScheduleSetupItems([row],recipients,[stored],'2026-09-20').map(x=>x.date)),['2026-11-25'])
const debit={...row,project_id:2,contract:{...contract,project_id:2,billing_method:'口座振替',billing_schedule_days:['15日']}}
assert.equal(legacyScheduleSetupItems([debit],new Map([[2,10]]),[],'2026-09-14').length,0,'Future bank execution is not claimed as a reminder')
const due=legacyScheduleSetupItems([debit],new Map([[2,10]]),[],'2026-09-20')
assert.deepEqual(plain(due.map(x=>[x.date,x.method])),[['2026-09-15','direct_debit']])
const handled={...debit,records:[{id:1,contract_id:1,year:2026,billing_scheduled_date:'2026-09-15',billing_date:null,payment_due_date:null,received_date:'2026-09-16',line_items:null,payments:null,maintenance_record:null,escort_record:null,transfer_failed:false,status:'入金済'}]}
assert.equal(legacyScheduleSetupItems([handled],new Map([[2,10]]),[],'2026-09-20').length,0)
assert.equal(JSON.stringify(row),before)
console.log('PASS: runtime keeps unmatched near-term invoice reminders visible, hides matched units, and shows only due unhandled debit checks without creating records')
