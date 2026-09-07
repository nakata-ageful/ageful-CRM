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
  const importDb=new PGlite()
  try{
    await importDb.exec(`create table customers(id bigint primary key);create table projects(id bigint primary key,customer_id bigint default 1);
      create table contracts(id bigint primary key,project_id bigint references projects(id));
      create table annual_records(id bigint primary key,contract_id bigint references contracts(id),year integer,status text,
        payments jsonb,billing_scheduled_date date,billing_date date,received_date date,payment_due_date date,transfer_failed boolean,line_items jsonb);
      create schema auth;create function auth.uid() returns uuid language sql as 'select nullif(current_setting(''test.actor'',true),'''')::uuid';
      set test.actor='11111111-1111-4111-8111-111111111111';
      insert into customers values(1);insert into projects values(1);insert into contracts values(1,1);`)
    for(const r of records)await importDb.query('insert into annual_records select * from jsonb_populate_record(null::annual_records,$1::jsonb)',[JSON.stringify(r)])
    await importDb.transaction(async tx=>{
      await tx.exec("set local ageful.allow_draft_migration='yes'")
      for(const name of ['20260907_billing_ownership_foundation.sql','20260907_invoice_import_rpc.sql'])
        await tx.exec(fs.readFileSync(path.join(root,'database/drafts',name),'utf8'))
    })
    let seq=0
    const operation=()=>`66666666-6666-4666-8666-${String(++seq).padStart(12,'0')}`
    const call=(op,rs,project={id:1,customer_id:1},signature=rs[0].evidence.sourceSignature)=>importDb.query(
      'select import_invoice_source($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb) receipt',
      [op,rs[0].row.source_annual_record_id,JSON.stringify(project),JSON.stringify({id:1,project_id:1}),signature,JSON.stringify(rs)])
    async function snapshot(){const s={};for(const t of ['projects','contracts','annual_records','billing_units','billing_operations','billing_unit_events','invoice_import_evidence'])
      s[t]=(await importDb.query(`select to_jsonb(t) value from ${t} t order by to_jsonb(t)::text`)).rows.map(x=>x.value);return s}
    const start=await snapshot(),splitPayloads=payloads.filter(p=>p.row.source_annual_record_id===2)
    const inspect=async()=>(await importDb.query('select inspect_invoice_import(1) report')).rows[0].report
    assert.equal((await inspect()).unimported_sources,3)
    assert.equal((await inspect()).source_checks_passed,false)
    await assert.rejects(call(operation(),[splitPayloads[0]]),/すべての回/)
    await assert.rejects(call(operation(),[splitPayloads[0],splitPayloads[0]]),/重複/)
    await assert.rejects(call(operation(),[payloads[0]],{id:1,notes:'確認後の変更'}),/発電所・契約/)
    const wrongDate=plain(splitPayloads);wrongDate[1].row.scheduled_date='2027-12-02'
    await assert.rejects(call(operation(),wrongDate),/元記録と一致/)
    const wrongAmount=plain(splitPayloads);wrongAmount[0].row.frozen_amount=111
    await assert.rejects(call(operation(),wrongAmount),/do not match/)
    const wrongProof=plain(splitPayloads);wrongProof[1].evidence.methodConfirmation.sourceSnapshotHash='0'.repeat(64)
    await assert.rejects(call(operation(),wrongProof),/確認根拠/)
    const extra=plain(splitPayloads);extra[0].row.id=999
    await assert.rejects(call(operation(),extra),/移行列/)
    await assert.rejects(call(operation(),[payloads[0]],{id:1,customer_id:1},JSON.stringify({...single,status:'請求済'})),/元記録が更新/)
    assert.deepEqual(await snapshot(),start)
    await importDb.exec(`create function fail_import() returns trigger language plpgsql as $$begin raise exception 'synthetic final evidence failure';end$$;
      create trigger fail_import before insert on invoice_import_evidence for each row execute function fail_import();`)
    await assert.rejects(call(operation(),splitPayloads),/synthetic final evidence failure/)
    assert.deepEqual(await snapshot(),start,'Source, units, events, operation and evidence all roll back')
    await importDb.exec('drop trigger fail_import on invoice_import_evidence')
    const op=operation(),receipt=(await call(op,splitPayloads)).rows
    const imported=await snapshot()
    assert.equal(imported.billing_units.length,2)
    assert.equal(imported.billing_unit_events.length,2)
    assert.equal(imported.invoice_import_evidence.length,1)
    assert.equal((await inspect()).unimported_sources,2)
    assert.deepEqual(imported.annual_records,start.annual_records,'Never mutate the old source')
    assert.equal(receipt[0].receipt.cutover_ready,false)
    assert.deepEqual((await call(op,splitPayloads)).rows,receipt)
    assert.deepEqual(await snapshot(),imported)
    await assert.rejects(call(operation(),splitPayloads),/取込済み/)
    const changed=plain(splitPayloads);changed[0].evidence.amountBasis='別の根拠'
    await assert.rejects(call(op,changed),/同じ操作ID/)
    await call(operation(),[payloads[0]])
    await call(operation(),[payloads[3]])
    const finished=await snapshot()
    assert.equal(finished.billing_units.length,4)
    assert.equal(finished.invoice_import_evidence.length,3)
    assert.equal(finished.billing_units.reduce((n,u)=>n+(u.frozen_amount??0),0),310)
    const report=await inspect()
    assert.equal(report.source_checks_passed,true)
    assert.equal(report.cutover_ready,false,'Clean source checks must not silently authorize cutover')
    // A later legacy edit must be detected even after successful import.
    await importDb.exec("update annual_records set status='請求済' where id=1")
    assert.equal((await inspect()).changed_sources,1)
    assert.equal((await inspect()).source_checks_passed,false)
    await importDb.exec("update annual_records set status='入金済' where id=1")
    await importDb.exec('update projects set customer_id=2 where id=1')
    assert.equal((await inspect()).changed_parents,3)
    assert.equal((await inspect()).source_checks_passed,false)
    await importDb.exec('update projects set customer_id=1 where id=1')
    assert.deepEqual(await snapshot(),finished)
    // A direct update without an event is detected by the report (this fixture intentionally lacks the update guard).
    await assert.rejects(importDb.transaction(async tx=>{
      await tx.exec("update billing_units set scheduled_date='2027-12-02' where source_annual_record_id=2 and source_payment_index=2")
      const changedReport=(await tx.query('select inspect_invoice_import(1) report')).rows[0].report
      assert.equal(changedReport.changed_or_untracked_units,1)
      assert.equal(changedReport.source_checks_passed,false)
      throw new Error('synthetic report test rollback')
    }),/synthetic report test rollback/)
    assert.deepEqual(await snapshot(),finished)
    assert.ok(finished.billing_units.filter(u=>u.frozen_amount!==null).every(u=>u.frozen_at!==contexts[0].importedAt),'Freeze timestamp is assigned by DB')
    for(const sql of ['update invoice_import_evidence set schema_version=1','delete from invoice_import_evidence','truncate invoice_import_evidence'])
      await assert.rejects(importDb.exec(sql),/append-only/)
    await importDb.exec("set test.actor=''")
    await assert.rejects(call(operation(),[payloads[0]]),/ログイン/)
    await assert.rejects(inspect(),/ログイン/)
    assert.equal((await importDb.query("select has_function_privilege('public','import_invoice_source(uuid,bigint,jsonb,jsonb,text,jsonb)','execute') allowed")).rows[0].allowed,false)
    assert.equal((await importDb.query("select has_function_privilege('public','inspect_invoice_import(bigint)','execute') allowed")).rows[0].allowed,false)
    console.log('PASS: atomic source import, all-round coverage, source/parent recheck, immutable evidence, final failure rollback, idempotent retry and unchanged source')
    console.log('PASS: project-level unimported/changed-source inspection; clean checks explicitly do not authorize cutover')
  }finally{await importDb.close()}
  console.log('PASS: complete invoice migration payload accepted by PostgreSQL, received-only and planned states, exact amounts, source identity, year/date preservation and strict evidence guards')
  console.log('Scope: synthetic invoice-source import only; no real method confirmation, whole-project cutover, concurrent legacy writers, durable restore or production writes')
}
main().catch(error=>{console.error(error);process.exitCode=1})
