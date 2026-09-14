// Isolated PostgreSQL engine only; never reads .env or connects to Supabase.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const ts=require('typescript'),{webcrypto}=require('node:crypto'),root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports
 const module={exports:{}};cache.set(file,module)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
  {module,exports:module.exports,TextEncoder,crypto:webcrypto,require:name=>{if(!name.startsWith('.'))throw Error('Unexpected external module');return load(path.resolve(path.dirname(file),name)+'.ts')}})
 return module.exports
}
const plain=v=>JSON.parse(JSON.stringify(v))
const {contractFieldKinds:ck,projectFieldKinds:pk}=load('src/lib/ownership-field-selection.ts')
const {contractTransferLabels:labels,validateContractBillingSettings:validate}=load('src/lib/contract-transfer-form.ts')
const {durableBillingOperation}=load('src/lib/durable-billing-operation.ts')
const {inspectFutureBillingCoverage}=load('src/lib/billing-cutover-coverage.ts')
const {reviewBillingMigration:review}=load('src/lib/billing-migration-review.ts')
const {prepareInvoiceMigrationPayload:prepare}=load('src/lib/invoice-migration-payload.ts')
const {identifyBillingMigrationSource:identify}=load('src/lib/billing-migration-source.ts')
const {auditBillingBackup,hash,canonicalJson,isMaintenanceOnlyRecord}=require('../scripts/review-billing-backup.cjs')
const {reconcileBillingImport}=require('../scripts/reconcile-billing-import.cjs')
const actor='11111111-1111-4111-8111-111111111111'
const project={...Object.fromEntries(Object.keys(pk).map(k=>[k,null])),id:1,customer_id:1,project_name:'検証発電所'}
const contract={...Object.fromEntries(Object.keys(ck).map(k=>[k,null])),id:1,project_id:1,billing_method:'請求書',billing_count:1,billing_schedule_days:['6月15日'],annual_maintenance_inc:100,issuance_fee_inc:0,transfer_fee_inc:0}
const annual={id:1,contract_id:1,year:2025,status:'入金済',payments:null,billing_scheduled_date:null,billing_date:'2025-06-01',payment_due_date:null,received_date:'2025-06-10',transfer_failed:false,line_items:[{name:'保守料',amount:100}],maintenance_record:'元の保守備考',escort_record:null}
const fixture={customers:[{id:1,name:'A'},{id:2,name:'B'}],projects:[project],contracts:[contract],annual_records:[annual,
 {...annual,id:2,year:2026,status:'未入金',billing_date:null,received_date:null,line_items:null,billing_scheduled_date:'2026-12-01'},
 {...annual,id:3,year:2027,status:'未入金',billing_date:null,received_date:null,line_items:null,maintenance_record:'保守専用'}],
 maintenance_responses:[{id:1,project_id:1,notes:'対応記録'}],periodic_maintenance:[{id:1,project_id:1,notes:'定期点検'}],prospects:[],attachments:[]}
let sequence=0;const key=()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12,'0')}`
async function main(){
 const [backupFile,amountFile,payerFile]=process.argv.slice(2),real=!!backupFile
 const data=real?JSON.parse(fs.readFileSync(backupFile,'utf8')):fixture
 const amounts=real?JSON.parse(fs.readFileSync(amountFile,'utf8')):[]
 const payer=real?JSON.parse(fs.readFileSync(payerFile,'utf8')):{datasetHash:hash(data),mode:'existing_current_customer',basis:'Synthetic fixture approval'}
 const audit=await auditBillingBackup(data,amounts,payer)
 const {PGlite}=await import('@electric-sql/pglite');let db=new PGlite()
 const sourceTables=['customers','projects','contracts','annual_records','maintenance_responses','periodic_maintenance','prospects','attachments']
 try{
  await db.exec(`create role authenticated;create role anon;create schema auth;create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;set test.actor='${actor}';grant usage on schema public,auth to authenticated,anon;`)
  // Logical data restoration into a rehearsal schema. Does NOT reconstruct production policies/triggers from JSON.
  for(const table of sourceTables){
   const rows=data[table]??[],keys=[...new Set(rows.flatMap(r=>Object.keys(r)))];if(!keys.includes('id'))keys.unshift('id')
   for(const k of keys)if(!/^[a-z][a-z0-9_]*$/.test(k))throw Error('Invalid column name')
   const columns=keys.map(k=>{const values=rows.map(r=>r[k]).filter(v=>v!=null),kind=table==='contracts'?ck[k]:table==='projects'?pk[k]:null
    const type=k==='id'||k.endsWith('_id')&&values.every(v=>typeof v==='number')?'bigint':kind==='date'||k==='ownership_transfer_date'?'date':kind==='number'||values.some(v=>typeof v==='number')?'numeric':kind==='boolean'||values.some(v=>typeof v==='boolean')?'boolean':['strings','flags','amounts'].includes(kind)||values.some(v=>typeof v==='object')?'jsonb':'text'
    return `"${k}" ${type}${k==='id'?' primary key':''}`})
   await db.exec(`create table ${table}(${columns.join(',')})`)
   for(const row of rows)await db.query(`insert into ${table} select * from jsonb_populate_record(null::${table},$1::jsonb)`,[JSON.stringify(row)])
  }
  const rows=async table=>(await db.query(`select to_jsonb(t) value from ${table} t order by id`)).rows.map(r=>r.value)
  for(const table of sourceTables)assert.equal(canonicalJson(await rows(table)),canonicalJson([...(data[table]??[])].sort((a,b)=>a.id-b.id)),`${table}: backup values changed`)
  await db.transaction(async tx=>{await tx.exec("set local ageful.allow_draft_migration='yes'");for(const f of [
   '20260907_billing_ownership_foundation.sql','20260907_invoice_write_rpc.sql','20260907_invoice_import_rpc.sql',
   '20260907_preserve_maintenance_source.sql','20260907_invoice_recipient_initialization.sql','20260907_invoice_initialization_inspection.sql',
   '20260907_imported_invoice_source_guard.sql','20260907_legacy_invoice_creation_guard.sql','20260907_transfer_detail_choices.sql',
   '20260907_manual_billing_plan.sql','20260907_transfer_ownership_manual.sql','20260907_manual_debit_result.sql','20260907_create_manual_debit_plan.sql',
   '20260914_management_lifecycle.sql','20260909_billing_runtime.sql'])await tx.exec(fs.readFileSync(path.join(root,'database/drafts',f),'utf8'))})
  const raw=review(audit.datasetId,data.annual_records)
  const confirmations=raw.candidates.map(c=>{const approval=amounts.find(a=>a.recordId===c.recordId&&a.paymentIndex===c.paymentIndex&&a.seq===c.seq)
   return {sourceKey:c.sourceKey,sourceSignature:c.sourceSignature,recipientId:audit.rows.find(r=>r.recordId===c.recordId&&r.originalPaymentIndex===c.paymentIndex).confirmedRecipientId,recipientBasis:payer.basis,
    ...(approval?{amount:approval.amount,lineItems:approval.lineItems,amountBasis:approval.basis}:{})}})
  const candidates=review(audit.datasetId,data.annual_records,confirmations).candidates
  const unresolvedMethods=[]
  for(const record of data.annual_records){
   const c=data.contracts.find(c=>c.id===record.contract_id),p=data.projects.find(p=>p.id===c.project_id)
   const selected=candidates.filter(x=>x.recordId===record.id)
   if(!selected.length){
    if(!isMaintenanceOnlyRecord(record))throw Error('Ambiguous maintenance-only source')
    await db.query('select preserve_maintenance_source($1,$2,$3::jsonb,$4::jsonb,$5)',[key(),record.id,JSON.stringify(p),JSON.stringify(c),canonicalJson(record)]);continue
   }
   // Do not infer a historical invoice/debit method from a currently debit-paid contract.
   if(real&&c.billing_method!=='請求書'){unresolvedMethods.push(record.id);continue}
   const payloads=[]
   for(const candidate of selected){const identity=await identify(audit.datasetId,candidate,record)
    payloads.push(await prepare(audit.datasetId,candidate,record,{projectId:p.id,contractId:c.id,importedAt:'2026-09-09T00:00:00.000Z',
     methodConfirmation:{sourceSnapshotHash:identity.columns.source_snapshot_hash,originalMethod:'invoice',collectionMethod:'invoice',
      basis:real?'LOCAL REHEARSAL ONLY: current invoice setting; historical method not independently verified':'Synthetic invoice confirmation'}}))}
   await db.query('select import_invoice_source($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb)',[key(),record.id,JSON.stringify(p),JSON.stringify(c),payloads[0].evidence.sourceSignature,JSON.stringify(payloads)])
  }
  const imported={billing_units:await rows('billing_units'),invoice_import_evidence:(await db.query('select to_jsonb(e) value from invoice_import_evidence e')).rows.map(r=>r.value)}
  const reconciliation=await reconcileBillingImport(data,amounts,payer,imported)
  const multiContractProjects=data.projects.filter(p=>data.contracts.filter(c=>c.project_id===p.id).length>1)
  const coverageRows=data.projects.filter(p=>!multiContractProjects.some(x=>x.id===p.id)).map(p=>{
   const c=data.contracts.find(c=>c.project_id===p.id)
   return {project_id:p.id,contract:c??null,records:data.annual_records.filter(a=>a.contract_id===c?.id)}
  })
  const coverage=inspectFutureBillingCoverage(coverageRows,new Map(data.projects.map(p=>[p.id,p.customer_id])),imported.billing_units,'2026-09',15)
  if(!real){
   assert.equal(coverage.candidates[0].date,'2027-06-15');assert.equal(coverage.summary.missing,1)
   const proposal=coverage.candidates[0]
   const match={project_id:1,recipient_customer_id:1,collection_method:'invoice',scheduled_date:proposal.date,lifecycle:'planned',planned_amount:proposal.amount}
   assert.equal(inspectFutureBillingCoverage(coverageRows,new Map([[1,1]]),[match],'2026-09',15).summary.matching,1)
   assert.equal(inspectFutureBillingCoverage(coverageRows,new Map([[1,1]]),[{...match,planned_amount:null}],'2026-09',15).summary.review,1)
   assert.equal(inspectFutureBillingCoverage(coverageRows,new Map([[1,1]]),[match,match],'2026-09',15).summary.review,1)
   const debitRows=[{...coverageRows[0],contract:{...contract,billing_method:'口座振替',billing_schedule_days:['25日'],annual_maintenance_inc:1200}}]
   const debitMatch={...match,collection_method:'direct_debit',scheduled_date:'2026-09-25',planned_amount:100}
   assert.equal(inspectFutureBillingCoverage(debitRows,new Map([[1,1]]),[debitMatch],'2026-09',1).summary.matching,1)
  }
  if(!real)assert.equal(reconciliation.financialSourceChecksPassed,true)
  else assert.ok(reconciliation.issues.every(i=>i.recordId?unresolvedMethods.includes(i.recordId):i.code==='total_amount_mismatch'),'Unexpected reconciliation mismatch beyond explicitly excluded method records')
  // Rehearsal-only fallback: never write this synthetic effective date to production.
  const rehearsalToday=(await db.query('select current_date::text value')).rows[0].value
  let accepted=0
  for(const p of data.projects){
   const cons=data.contracts.filter(c=>c.project_id===p.id),records=data.annual_records.filter(a=>cons.some(c=>c.id===a.contract_id))
   if(records.some(a=>unresolvedMethods.includes(a.id)))continue
   if(records.length){
    if(cons.length!==1)throw Error('Migration project has multiple contracts')
    const units=(await rows('billing_units')).filter(u=>u.project_id===p.id),evidence=imported.invoice_import_evidence.filter(e=>e.project_id===p.id)
    const dates=units.filter(u=>u.lifecycle==='planned'&&u.scheduled_date).map(u=>u.scheduled_date).sort()
    await db.query('select initialize_invoice_recipients($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8)',[key(),p.id,JSON.stringify(p),JSON.stringify(cons[0]),
     JSON.stringify(Object.fromEntries(evidence.map(e=>[e.source_annual_record_id,e.source_snapshot_hash]))),JSON.stringify(Object.fromEntries(units.map(u=>[u.id,u.revision]))),p.customer_id,dates[0]??rehearsalToday])
   }
   await db.query('select accept_billing_migration($1)',[p.id]);accepted++
  }
  for(const table of sourceTables)assert.equal(canonicalJson(await rows(table)),canonicalJson([...(data[table]??[])].sort((a,b)=>a.id-b.id)),`${table}: migration changed source`)
  if(!real){
   assert.deepEqual(Object.keys(ck).sort(),Object.keys(labels).sort())
   const prepareFields=choices=>db.query('select prepare_transfer_detail_choices($1::jsonb,$2::jsonb,$3::jsonb)',[JSON.stringify(project),JSON.stringify(contract),JSON.stringify({contract:choices})])
   for(const [name,kind] of Object.entries(ck)){
    if(kind==='protected'){await assert.rejects(prepareFields({[name]:{mode:'clear'}}),/選択できない/);continue}
    const value=kind==='number'?name==='billing_count'?1:200:kind==='boolean'?true:kind==='date'?'2026-01-01':kind==='flags'?{annual_maintenance:false}:kind==='amounts'?{'1':150}:kind==='strings'?['6月15日']:name==='billing_method'?'請求書':name.startsWith('plan_')?'年1回':name==='meti_setup_report_status'?'受理':'変更内容'
    await prepareFields({[name]:{mode:'change',value}})
    if(!['billing_method','billing_schedule_days'].includes(name))await prepareFields({[name]:{mode:'clear'}})
   }
   const debitFields={billing_method:{mode:'change',value:'口座振替'},billing_count:{mode:'change',value:12},billing_schedule_days:{mode:'change',value:['25日']},billing_amount_overrides:{mode:'change',value:{'12':200}}}
   await prepareFields(debitFields);validate({...contract,billing_method:'口座振替',billing_count:12,billing_schedule_days:['25日'],billing_amount_overrides:{'12':200}},debitFields)
   await assert.rejects(prepareFields({...debitFields,billing_count:{mode:'change',value:2}}),/回数/)
   assert.throws(()=>validate({...contract,plan_inspection:'invalid'},{plan_inspection:{mode:'change',value:'invalid'}}),/点検/)
   let forbiddenWrites=0
   const noWrite=async()=>{forbiddenWrites++;throw Error('must not send')}
   const quota=durableBillingOperation({scope:'quota',operationId:key,storage:{getItem:()=>null,setItem:()=>{throw Error('quota exceeded')},removeItem:()=>{}},write:noWrite,reload:async()=>null})
   await assert.rejects(quota.save({action:'transfer'}),/quota exceeded/)
   const corrupt=durableBillingOperation({scope:'corrupt',operationId:key,storage:{getItem:()=>'{broken',setItem:()=>{},removeItem:()=>{}},write:noWrite,reload:async()=>null})
   await assert.rejects(corrupt.recover(),/読み取れません/);assert.equal(forbiddenWrites,0)
   const rejectedMap=new Map()
   const rejected=durableBillingOperation({scope:'rejected',operationId:key,storage:{getItem:k=>rejectedMap.get(k)??null,setItem:(k,v)=>rejectedMap.set(k,v),removeItem:k=>rejectedMap.delete(k)},
    write:async()=>{throw Error('confirmed rollback')},reload:async()=>null,definitelyRejected:e=>e.message==='confirmed rollback'})
   await assert.rejects(rejected.save({action:'transfer'}),/confirmed rollback/);assert.equal(rejectedMap.size,0)
   await assert.rejects(db.query('select billing_runtime_snapshot()'),/利用権限/)
   await db.query('insert into billing_runtime_control(owner_user_id,enabled) values($1,true)',[actor])
   await assert.rejects(db.query('select billing_runtime_snapshot()'),/今後の請求予定/)
   await db.exec('update billing_runtime_control set future_schedule_coverage_verified=true')
   await db.exec('grant select,update,delete on projects,contracts,customers,annual_records to authenticated;set role authenticated')
   await assert.rejects(db.exec("update contracts set notes='old tab edit' where id=1"),/古い画面/)
   await db.exec(`set request.headers='{"x-ageful-client":"ledger-v1"}'`)
   await db.exec('update contracts set notes=notes where id=1')
   await assert.rejects(db.exec("update projects set customer_id=2 where id=1"),/所有者変更/)
   await assert.rejects(db.exec("update contracts set project_id=2 where id=1"),/直接変更/)
   await assert.rejects(db.exec("update annual_records set billing_date='2026-01-01' where id=1"),/新しい請求/)
   await assert.rejects(db.exec('delete from customers where id=1'),/削除できません/)
   await assert.rejects(db.exec('select * from billing_units'),/permission denied/)
   const before=(await db.query('select billing_runtime_snapshot() value')).rows[0].value
   await db.exec('begin')
   await db.exec(`update contracts set billing_item_flags='{"annual_maintenance":false,"land_cost":true}'::jsonb where id=1`)
   assert.deepEqual((await db.query('select billing_runtime_snapshot() value')).rows[0].value.units,before.units,'Fee selection must not change stored occurrences')
   await db.exec('rollback')
   const backup=(await db.query('select billing_runtime_backup() value')).rows[0].value
   assert.equal(backup.version,2);assert.equal(backup.billing_units.length,before.units.length)
   assert.deepEqual(backup.annual_records,[...fixture.annual_records].sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))))
   const planned=before.units.find(u=>u.lifecycle==='planned'),paid=before.units.find(u=>u.lifecycle==='received')
   const request={action:'transfer',value:{project,contract,newOwner:2,futureRecipient:1,date:'2026-09-01',fields:{contract:debitFields},choices:[{
    unitId:String(planned.id),expectedRevision:planned.revision,recipientId:2,method:'口座振替',scheduledDate:'2026-12-01',plannedAmount:200,periodStart:null,periodEnd:null,note:'移転後の予定'}],reason:'一括移転の確認'}}
   const storageMap=new Map(),storage={getItem:k=>storageMap.get(k)??null,setItem:(k,v)=>storageMap.set(k,v),removeItem:k=>storageMap.delete(k)}
   let requests=[],reloadFails=true
   const createJournal=()=>durableBillingOperation({storage,scope:'isolated-user',operationId:key,
    write:async(id,r)=>{requests.push(id);return db.query('select billing_runtime_write($1,$2::jsonb)',[id,JSON.stringify(r)])},
    reload:async()=>{if(reloadFails)throw Error('simulate closed page after commit');return (await db.query('select billing_runtime_snapshot() value')).rows[0].value}})
   await assert.rejects(createJournal().save(request),/closed page/)
   assert.equal(storageMap.size,1);reloadFails=false
   await assert.rejects(createJournal().save({...request,action:'plan'}),/未確認/)
   const recovered=await createJournal().recover();assert.equal(storageMap.size,0);assert.equal(new Set(requests).size,1)
   assert.equal((await db.query('select billing_runtime_has_transfer(1) value')).rows[0].value,true)
   assert.equal(recovered.transfers.length,1);assert.deepEqual(recovered.units.find(u=>u.id===paid.id),paid)
   await db.exec('reset role')
   assert.equal((await db.query('select default_recipient_customer_id from billing_recipient_plans where retired_at is null')).rows[0].default_recipient_customer_id,1)
   await db.exec('set role authenticated')
   const changed=recovered.units.find(u=>u.id===planned.id)
   await db.query('select billing_runtime_write($1,$2::jsonb)',[key(),JSON.stringify({action:'invoice',value:{unitId:changed.id,revision:changed.revision,mode:'debit_received',value:{received_on:'2026-12-01',amount:200,line_items:[{name:'保守料',amount:200}]},reason:'入金確認'}})])
   const runtimeWrite=(id,action,value)=>db.query('select billing_runtime_write($1,$2::jsonb)',[id,JSON.stringify({action,value})])
   const runtimeSnapshot=async()=>(await db.query('select billing_runtime_snapshot() value')).rows[0].value
   await runtimeWrite(key(),'debit_add',{projectId:1,contractId:1,recipient:2,year:2027,month:6,date:'2027-06-25',amount:200,note:'終了確認用',reason:'明示予定追加'})
   const snapshotBeforeManagement=await runtimeSnapshot(),managedPlan=snapshotBeforeManagement.units.find(u=>u.lifecycle==='planned')
   const maintenanceEnd={projectId:1,expectedLast:0,scope:'maintenance',action:'end',date:'2026-10-01',reason:'保守終了・土地代だけ残す',choices:[{unitId:String(managedPlan.id),expectedRevision:managedPlan.revision,action:'amount',amount:75}]}
   const endKey=key();await runtimeWrite(endKey,'management',maintenanceEnd);await runtimeWrite(endKey,'management',maintenanceEnd)
   const maintenanceEnded=await runtimeSnapshot();assert.equal(maintenanceEnded.management_events.length,1)
   assert.equal(maintenanceEnded.units.find(u=>u.id===managedPlan.id).planned_amount,75)
   assert.deepEqual(maintenanceEnded.units.filter(u=>u.lifecycle!=='planned'),snapshotBeforeManagement.units.filter(u=>u.lifecycle!=='planned'))
   await assert.rejects(runtimeWrite(key(),'management',{...maintenanceEnd,action:'resume',date:'2027-01-01'}),/履歴が更新/)
   const fullEnd={...maintenanceEnd,expectedLast:maintenanceEnded.management_events[0].id,scope:'all',date:'2026-11-01',reason:'全取引終了',
    choices:[{unitId:String(managedPlan.id),expectedRevision:maintenanceEnded.units.find(u=>u.id===managedPlan.id).revision,action:'cancel',amount:null}]}
   await db.exec(`reset role;create function test_management_failure() returns trigger language plpgsql as $$begin if NEW.reason='failure_test' then raise exception 'management audit failure';end if;return NEW;end$$;
     create trigger test_management_failure before insert on project_management_events for each row execute function test_management_failure();set role authenticated`)
   await assert.rejects(runtimeWrite(key(),'management',{...fullEnd,reason:'failure_test'}),/management audit failure/)
   assert.deepEqual(await runtimeSnapshot(),maintenanceEnded,'Final audit failure must roll back plan changes and operation')
   await runtimeWrite(key(),'management',fullEnd)
   const ended=await runtimeSnapshot();assert.equal(ended.units.find(u=>u.id===managedPlan.id).lifecycle,'cancelled')
   const nextDebit={projectId:1,contractId:1,recipient:2,year:2027,month:7,date:'2027-07-25',amount:75,note:'土地代',reason:'明示追加'}
   await assert.rejects(runtimeWrite(key(),'debit_add',nextDebit),/全取引終了後/)
   await runtimeWrite(key(),'management',{projectId:1,expectedLast:ended.management_events.at(-1).id,scope:'all',action:'resume',date:'2027-02-01',choices:[],reason:'取引再開、保守は再開しない'})
   const resumed=await runtimeSnapshot();assert.equal(resumed.management_events.length,3)
   assert.equal(resumed.units.find(u=>u.id===managedPlan.id).lifecycle,'cancelled','Resume must not revive cancelled plans')
   await runtimeWrite(key(),'debit_add',nextDebit)
   const managementBackup=(await db.query('select billing_runtime_backup() value')).rows[0].value
   assert.equal(managementBackup.project_management_events.length,3)
   await assert.rejects(db.exec('select * from project_management_events'),/permission denied/)
   await db.exec(`set test.actor='22222222-2222-4222-8222-222222222222'`)
   await assert.rejects(db.query('select billing_runtime_snapshot()'),/利用権限/)
   assert.equal((await db.query('select count(*)::int n from customers')).rows[0].n,0)
   await db.exec("set test.actor=''");await assert.rejects(db.query('select billing_runtime_snapshot()'),/利用権限/)
   await db.exec(`reset role;set test.actor='${actor}'`)
   console.log('PASS: all 50 editable Contract fields; coupled settings, source migration → atomic transfer → debit receipt, single-owner RPC, old-writer denial and durable same-ID recovery')
  }
  const allTables=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r=>r.tablename)
  const snapshot=async()=>{const result={};for(const table of allTables)result[table]=(await db.query(`select to_jsonb(t) v from ${table} t order by to_jsonb(t)::text`)).rows.map(r=>r.v);return result}
  const beforeRestore=await snapshot(),archive=await db.dumpDataDir('none');await db.close();db=new PGlite({loadDataDir:archive})
  assert.equal(canonicalJson(await snapshot()),canonicalJson(beforeRestore),'Engine backup restore changed data')
  await db.exec(`set test.actor='${actor}'`)
  await assert.rejects(db.exec('delete from billing_unit_events'),/append-only/)
  await assert.rejects(db.exec('truncate project_management_events'),/append-only/)
  if(!real){await db.exec("set role authenticated;set test.actor=''");await assert.rejects(db.query('select billing_runtime_backup()'),/利用権限/);await db.exec('reset role')}
  console.log(JSON.stringify({scope:real?'saved application JSON → isolated logical schema (not production DDL/Auth/storage restore)':'synthetic complete runtime rehearsal',
   sourceCounts:Object.fromEntries(sourceTables.map(t=>[t,(data[t]??[]).length])),expectedUnits:audit.rows.length,importedUnits:imported.billing_units.length,
   importedActualAmount:imported.billing_units.reduce((sum,u)=>sum+(u.frozen_amount??0),0),acceptedProjects:accepted,unresolvedMethodRecordIds:unresolvedMethods,
   sourceRowsUnchanged:true,engineBackupRestoreMatched:true,restoredTables:allTables.length,productionCutoverReady:false},null,2))
  console.log(JSON.stringify({futureCoverage:{scope:'read-only current-contract proposals; not issued amounts or an automatic migration',startMonth:coverage.startMonth,months:coverage.months,
   ...coverage.summary,settingIssues:coverage.issues.length,undatedSavedPlans:coverage.undatedSavedPlans,excludedMultiContractProjects:multiContractProjects.length,authorizesCutover:false}},null,2))
 }finally{await db.close()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
