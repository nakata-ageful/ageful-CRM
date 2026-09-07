const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports
 const module={exports:{}};cache.set(file,module)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
 {module,exports:module.exports,require:name=>{if(!name.startsWith('.'))throw Error('External dependency forbidden');return load(path.resolve(path.dirname(file),name)+'.ts')}})
 return module.exports}
const {prepareInvoiceScheduleChange:prepare}=load('src/lib/invoice-schedule-change.ts')
const {canonicalJson}=load('src/lib/billing-json.ts'),plain=v=>JSON.parse(JSON.stringify(v))
const unit=(id,payer)=>({id,projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',scheduledDate:'2026-06-01',
 recipientId:payer,lifecycle:'planned',issuedOn:null,receivedOn:null,frozenAmount:null,frozenLineItems:null,frozenAt:null,revision:1})
const source=[unit('one',1),{...unit('two',2),roundLabel:'第2回',scheduledDate:'2026-12-01'},
 {...unit('paid',1),serviceYear:2025,lifecycle:'received',issuedOn:'2025-06-01',receivedOn:'2025-06-10',
 frozenAmount:82500,frozenLineItems:[{name:'保守料',amount:82500}],frozenAt:'2025-06-01T00:00:00Z'}]
const request={projectId:1,defaultRecipientId:2,expectedSourceSignature:canonicalJson(source),retire:[],targets:[
 {id:'two',sourceId:'two',serviceYear:2026,roundLabel:'第1回',scheduledDate:'2026-05-01'},
 {id:'one',sourceId:'one',serviceYear:2026,roundLabel:'第2回',scheduledDate:'2026-11-01'},
 {id:'new',sourceId:null,serviceYear:2027,roundLabel:'第1回',scheduledDate:'2027-06-01'}]}
const result=prepare(source,request)
assert.deepEqual(result.planned.map(x=>x.recipientId).join(','),'2,1,2')
assert.deepEqual(plain(result.unchangedHistory),[source[2]])
assert.equal(result.planned[0].revision,2)
assert.equal(result.planned[2].frozenAmount,null)
assert.equal(result.readyToWrite,false)
assert.equal(canonicalJson(source),request.expectedSourceSignature)
const removed=prepare(source,{...request,targets:[request.targets[0]],retire:[{id:'one',reason:'回数変更でこの予定を取りやめ'}]})
assert.equal(removed.retired[0].before.recipientId,1)
assert.throws(()=>prepare(source,{...request,targets:[request.targets[0]]}),/すべて/)
assert.throws(()=>prepare(source,{...request,retire:[{id:'one',reason:'二重指定'}]}),/すべて/)
assert.throws(()=>prepare(source,{...request,targets:[request.targets[0]],retire:[{id:'one',reason:''}]}),/理由/)
assert.throws(()=>prepare(source,{...request,targets:[...request.targets,{...request.targets[2],id:'paid'}]}),/未使用/)
assert.throws(()=>prepare(source,{...request,targets:[{...request.targets[0],id:'replaced'},...request.targets.slice(1)]}),/IDは変更/)
assert.throws(()=>prepare(source.map(u=>u.id==='one'?{...u,recipientId:3}:u),request),/変わっています/)
const debit=source.map(u=>u.id==='one'?{...u,method:'口座振替'}:u)
assert.throws(()=>prepare(debit,{...request,expectedSourceSignature:canonicalJson(debit)}),/請求書/)
const frozenPlan=source.map(u=>u.id==='one'?{...u,frozenLineItems:[]}:u)
assert.throws(()=>prepare(frozenPlan,{...request,expectedSourceSignature:canonicalJson(frozenPlan)}),/未発行/)
assert.throws(()=>prepare(source,{...request,targets:[{...request.targets[0],scheduledDate:'2026-02-30'},...request.targets.slice(1)]}),/予定日/)
result.unchangedHistory[0].frozenLineItems[0].amount=1
assert.equal(source[2].frozenLineItems[0].amount,82500)
console.log('PASS: explicit schedule correspondence, stable payer IDs, new default payer, frozen history, no silent deletion, retirement reasons and stale checks')
console.log('Scope: review preparation only. No contract update, cancellation, DB write or calendar generation.')
