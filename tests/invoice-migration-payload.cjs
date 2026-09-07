// Synthetic only. Full row acceptance is not a production migration or cutover test.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const ts=require('typescript'),{webcrypto}=require('node:crypto')
const root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports
  const module={exports:{}};cache.set(file,module)
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
    {module,exports:module.exports,TextEncoder,crypto:webcrypto,require:name=>{
      if(!name.startsWith('.'))throw Error('External dependency forbidden')
      return load(path.resolve(path.dirname(file),name)+'.ts')
    }})
  return module.exports
}
const {reviewBillingMigration:review}=load('src/lib/billing-migration-review.ts')
const {identifyBillingMigrationSource:identify}=load('src/lib/billing-migration-source.ts')
const {prepareInvoiceMigrationPayload:prepare}=load('src/lib/invoice-migration-payload.ts')
const plain=x=>JSON.parse(JSON.stringify(x))
const single={id:1,contract_id:1,year:2025,status:'入金済',payments:null,billing_scheduled_date:null,
  billing_date:null,received_date:'2025-06-10',payment_due_date:null,transfer_failed:false,line_items:[{name:'保守料',amount:100}]}
const split={...single,id:2,year:2026,status:'未入金',received_date:null,payments:[
  {seq:1,scheduled_date:'2026-06-01',billing_date:'2026-06-01',received_date:null},
  {seq:2,scheduled_date:'2027-12-01',billing_date:null,received_date:null},
]}
const other={...single,id:3,billing_date:'2025-06-01',received_date:null,status:'請求済'}
async function main(){
  const records=[single,split,other],initial=review('fixture',records)
  const confirmations=initial.candidates.map(c=>({sourceKey:c.sourceKey,sourceSignature:c.sourceSignature,
    recipientId:1,recipientBasis:'架空の請求先確認',...(c.recordId===2&&c.hasActivity?{
      amount:110,lineItems:[{name:'保守料',amount:100},{name:'再発行',amount:10}],amountBasis:'架空の各回確認'}:{})}))
  const candidates=review('fixture',records,confirmations).candidates,contexts=[]
  for(const c of candidates){
    const source=await identify('fixture',c,records.find(r=>r.id===c.recordId))
    contexts.push({projectId:1,contractId:1,importedAt:'2026-09-07T01:00:00.000Z',methodConfirmation:{
      sourceSnapshotHash:source.columns.source_snapshot_hash,originalMethod:'invoice',collectionMethod:'invoice',basis:'架空の方法確認'}})
  }
  const payloads=await Promise.all(candidates.map((c,i)=>prepare('fixture',c,records.find(r=>r.id===c.recordId),contexts[i])))
  assert.deepEqual(payloads.map(x=>x.row.lifecycle),['received','issued','planned','issued'])
  assert.deepEqual(payloads.map(x=>x.row.source_payment_index),[0,1,2,0])
  assert.deepEqual(payloads.map(x=>x.row.frozen_amount),[100,110,null,100])
  assert.equal(payloads[0].row.scheduled_date,null)
  assert.equal(payloads[0].row.issued_on,null,'Received-only history is preserved without inventing an issue date')
  assert.equal(payloads[0].row.amount_basis,'source_record')
  assert.equal(payloads[1].row.amount_basis,'operator_confirmed')
  assert.equal(payloads[2].row.frozen_at,null)
  assert.equal(payloads[2].row.service_year,2026)
  assert.equal(payloads[2].row.scheduled_date,'2027-12-01','Do not rewrite source year/date differences')
  assert.notEqual(payloads[0].row.occurrence_key,payloads[3].row.occurrence_key)
  assert.ok(payloads.every(p=>p.readyToWrite===false))
  assert.deepEqual(plain(payloads[0].evidence.sourceRecord),single)
  await assert.rejects(prepare('fixture',{...candidates[0],issuedOn:'2025-06-01'},single,contexts[0]),/元記録と一致/)
  await assert.rejects(prepare('fixture',{...candidates[0],hasActivity:false},single,contexts[0]),/元記録と一致/)
  await assert.rejects(prepare('fixture',candidates[0],single,{...contexts[0],methodConfirmation:null}),/請求方法/)
  await assert.rejects(prepare('fixture',candidates[0],single,{...contexts[0],methodConfirmation:{...contexts[0].methodConfirmation,sourceSnapshotHash:'wrong'}}),/請求方法/)
  await assert.rejects(prepare('fixture',candidates[0],single,{...contexts[0],contractId:99}),/契約と発電所/)
  await assert.rejects(prepare('fixture',candidates[0],single,{...contexts[0],importedAt:'2026-02-30T00:00:00.000Z'}),/移行時刻/)
  await assert.rejects(prepare('fixture',{...candidates[0],recipientBasis:''},single,contexts[0]),/請求先/)
  await assert.rejects(prepare('fixture',{...candidates[0],lineItems:[{name:'違う金額',amount:99}]},single,contexts[0]),/確定金額/)
  await assert.rejects(prepare('fixture',{...candidates[0],lineItems:null},single,contexts[0]),/確定金額/)
  await assert.rejects(prepare('fixture',{...candidates[2],amount:100,lineItems:[{name:'推測',amount:100}]},split,contexts[2]),/未発行予定/)
  const modified={...single,notes:'変更'}
  await assert.rejects(prepare('fixture',candidates[0],modified,contexts[0]),/元データ/)
  const ctx=structuredClone(contexts[0]),c=plain(candidates[0]),r=structuredClone(single)
  const pending=prepare('fixture',c,r,ctx)
  ctx.projectId=99;c.amount=1;r.line_items[0].amount=1
  assert.equal((await pending).row.frozen_amount,100,'Async preparation captures immutable inputs')
  const {PGlite}=await import('@electric-sql/pglite'),db=new PGlite()
  try{
    await db.exec(`create table customers(id bigint primary key);create table projects(id bigint primary key);
      create table contracts(id bigint primary key,project_id bigint references projects(id));create table annual_records(id bigint primary key);
      insert into customers values(1);insert into projects values(1);insert into contracts values(1,1);
      insert into annual_records values(1),(2),(3);`)
    await db.transaction(async tx=>{
      await tx.exec("set local ageful.allow_draft_migration='yes'")
      await tx.exec(fs.readFileSync(path.join(root,'database/drafts/20260907_billing_ownership_foundation.sql'),'utf8'))
    })
    const columns=Object.keys(payloads[0].row).join(',')
    const insert=row=>db.query(`insert into billing_units(${columns}) select ${columns} from jsonb_populate_record(null::billing_units,$1::jsonb)`,[JSON.stringify(row)])
    for(const p of payloads)await insert(p.row)
    const stored=(await db.query('select * from billing_units order by id')).rows
    assert.equal(stored.length,4)
    assert.equal((await db.query('select sum(frozen_amount)::int amount from billing_units')).rows[0].amount,310)
    assert.equal(stored[0].lifecycle,'received')
    assert.equal(stored[0].issued_on,null)
    assert.equal(stored[2].frozen_amount,null)
    await assert.rejects(insert(payloads[0].row),/unique constraint/)
    await assert.rejects(insert({...payloads[0].row,occurrence_key:'other',source_payment_index:99,frozen_amount:101}),/do not match/)
  }finally{await db.close()}
  console.log('PASS: complete invoice migration payload accepted by PostgreSQL, received-only and planned states, exact amounts, source identity, year/date preservation and strict evidence guards')
  console.log('Scope: synthetic preparation only; no source-locking import RPC, persistent evidence, live method confirmation, cutover or production writes')
}
main().catch(error=>{console.error(error);process.exitCode=1})
