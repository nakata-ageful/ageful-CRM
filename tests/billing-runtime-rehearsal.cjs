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
const {reviewFutureSchedule}=load('src/lib/future-schedule-review.ts')
const {billingUnitFromStorage}=load('src/lib/billing-unit-storage.ts')
const {legacyScheduleSetupReview}=load('src/lib/billing-cutover-coverage.ts')
const {maintenancePeriod}=load('src/lib/maintenance-period-label.ts')
const {maintenanceSchedule}=load('src/lib/maintenance-schedule.ts')
const {reviewBillingMigration:review}=load('src/lib/billing-migration-review.ts')
const {prepareInvoiceMigrationPayload:prepare}=load('src/lib/invoice-migration-payload.ts')
const {identifyBillingMigrationSource:identify}=load('src/lib/billing-migration-source.ts')
const {auditBillingBackup,hash,canonicalJson,isMaintenanceOnlyRecord}=require('../scripts/review-billing-backup.cjs')
const {reconcileBillingImport}=require('../scripts/reconcile-billing-import.cjs')
const {confirmedBillingHistory}=require('../scripts/confirmed-billing-history.cjs')
const actor='11111111-1111-4111-8111-111111111111'
const project={...Object.fromEntries(Object.keys(pk).map(k=>[k,null])),id:1,customer_id:1,project_name:'検証発電所'}
const contract={...Object.fromEntries(Object.keys(ck).map(k=>[k,null])),id:1,project_id:1,maintenance_start_date:'2022-01-14',billing_method:'請求書',billing_count:1,billing_schedule_days:['6月15日'],annual_maintenance_inc:100,issuance_fee_inc:0,transfer_fee_inc:0}
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
 const historyArg=process.argv.indexOf('--history-confirmations')
 if(historyArg>=0&&!process.argv[historyArg+1])throw Error('確認ファイルを指定してください')
 const historyConfirmations=historyArg>=0?confirmedBillingHistory(data,JSON.parse(fs.readFileSync(process.argv[historyArg+1],'utf8'))):real?new Map():new Map([[1,{recordId:1,round:1,basis:'Synthetic explicit round confirmation'}]])
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
   '20260914_management_lifecycle.sql','20260914_future_schedule.sql','20260909_billing_runtime.sql','20260914_confirm_imported_round.sql',
   '20260924_transfer_selected_next.sql'])await tx.exec(fs.readFileSync(path.join(root,'database/drafts',f),'utf8'))})
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
   const historyConfirmation=historyConfirmations.get(record.id)
   const failedDebitToInvoice=record.transfer_failed===true&&!record.payments?.length&&!!record.billing_date
    &&!record.received_date&&record.status==='請求済'&&c.billing_method==='口座振替'
   if(real&&c.billing_method!=='請求書'&&historyConfirmation?.method!=='invoice'&&!failedDebitToInvoice){unresolvedMethods.push(record.id);continue}
   const payloads=[]
   for(const candidate of selected){const identity=await identify(audit.datasetId,candidate,record)
    payloads.push(await prepare(audit.datasetId,candidate,record,{projectId:p.id,contractId:c.id,importedAt:'2026-09-09T00:00:00.000Z',
     methodConfirmation:{sourceSnapshotHash:identity.columns.source_snapshot_hash,
      originalMethod:failedDebitToInvoice?'direct_debit':'invoice',collectionMethod:'invoice',
      basis:failedDebitToInvoice?'元年度記録のtransfer_failed=true、請求日、請求済状態と現契約の口座振替設定による振替不能後の請求書切替確認':
       historyConfirmation?.method==='invoice'?historyConfirmation.basis:real?'LOCAL REHEARSAL ONLY: current invoice setting; historical method not independently verified':'Synthetic invoice confirmation'}}))}
   await db.query('select import_invoice_source($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb)',[key(),record.id,JSON.stringify(p),JSON.stringify(c),payloads[0].evidence.sourceSignature,JSON.stringify(payloads)])
  }
  const imported={billing_units:await rows('billing_units'),invoice_import_evidence:(await db.query('select to_jsonb(e) value from invoice_import_evidence e')).rows.map(r=>r.value)}
  const roundConfirmations=[...historyConfirmations.values()].filter(c=>c.round!==undefined).map(c=>{
   const units=imported.billing_units.filter(u=>u.source_annual_record_id===c.recordId)
   assert.equal(units.length,1);assert.equal(units[0].round_number,null)
   return {sourceRecord:c.recordId,confirmedRound:c.round,status:'source confirmation validated before audited post-acceptance assignment'}
  })
  if(roundConfirmations.length)console.log(JSON.stringify({roundConfirmations},null,2))
  const reconciliation=await reconcileBillingImport(data,amounts,payer,imported)
  const multiContractProjects=data.projects.filter(p=>data.contracts.filter(c=>c.project_id===p.id).length>1)
  const coverageRows=data.projects.filter(p=>!multiContractProjects.some(x=>x.id===p.id)).map(p=>{
   const c=data.contracts.find(c=>c.project_id===p.id)
   return {project_id:p.id,contract:c??null,records:data.annual_records.filter(a=>a.contract_id===c?.id)}
  })
  const coverage=inspectFutureBillingCoverage(coverageRows,new Map(data.projects.map(p=>[p.id,p.customer_id])),imported.billing_units,'2026-09',15)
  const scheduleReview=reviewFutureSchedule(coverage.candidates,imported.billing_units.map(u=>({...billingUnitFromStorage(u),collectionState:u.collection_state})))
  const periodReview=[],periodIssues=[]
  for(const p of data.projects){
   const contracts=data.contracts.filter(c=>c.project_id===p.id)
   if(contracts.length!==1){periodIssues.push({projectId:p.id,reason:'契約が複数または未設定'});continue}
   const c=contracts[0]
   if(data.annual_records.some(r=>r.contract_id===c.id&&unresolvedMethods.includes(r.id))){periodIssues.push({projectId:p.id,reason:'過去の請求方法が未確認'});continue}
   for(const year of [2026,2027])try{
    const items=maintenanceSchedule(c,year,p.customer_id,imported.billing_units.map(u=>({...billingUnitFromStorage(u),collectionState:u.collection_state})),[])
    periodReview.push({projectId:p.id,year,items})
   }catch(e){periodIssues.push({projectId:p.id,year,reason:e.message})}
  }
  if(!real){
   assert.equal(coverage.candidates[0].date,'2027-06-15');assert.equal(coverage.summary.missing,1)
   const proposal=coverage.candidates[0]
   const match={project_id:1,recipient_customer_id:1,collection_method:'invoice',scheduled_date:proposal.date,lifecycle:'planned',planned_amount:proposal.amount,round_number:proposal.round,service_month:null}
   assert.equal(inspectFutureBillingCoverage(coverageRows,new Map([[1,1]]),[match],'2026-09',15).summary.matching,1)
   assert.equal(inspectFutureBillingCoverage(coverageRows,new Map([[1,1]]),[{...match,planned_amount:null}],'2026-09',15).summary.review,1)
   assert.equal(inspectFutureBillingCoverage(coverageRows,new Map([[1,1]]),[match,match],'2026-09',15).summary.review,1)
   const debitRows=[{...coverageRows[0],contract:{...contract,billing_method:'口座振替',billing_schedule_days:['25日'],annual_maintenance_inc:1200}}]
   const debitMatch={...match,collection_method:'direct_debit',scheduled_date:'2026-09-25',planned_amount:100,round_number:null,service_month:9}
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
  for(const confirmation of historyConfirmations.values())if(confirmation.round!==undefined){
   const unit=(await rows('billing_units')).find(u=>u.source_annual_record_id===confirmation.recordId)
   const source=data.annual_records.find(r=>r.id===confirmation.recordId),operation=key()
   const args=[operation,JSON.stringify(unit),JSON.stringify(source),confirmation.round,confirmation.basis]
   const call=a=>db.query('select confirm_imported_round($1,$2::jsonb,$3::jsonb,$4,$5) value',a)
   await db.exec("create function fail_round_audit() returns trigger language plpgsql as $$ begin raise exception 'round audit unavailable'; end $$; create trigger fail_round_audit before insert on billing_unit_events for each row execute function fail_round_audit()")
   await assert.rejects(call(args),/round audit unavailable/)
   assert.deepEqual((await rows('billing_units')).find(u=>u.id===unit.id),unit,'audit failure left a partial round assignment')
   assert.equal((await db.query('select count(*)::int n from billing_operations where operation_key=$1',[operation])).rows[0].n,0)
   await db.exec('drop trigger fail_round_audit on billing_unit_events;drop function fail_round_audit()')
   await assert.rejects(call([key(),args[1],JSON.stringify({...source,year:2000}),args[3],args[4]]),/元記録/)
   const assigned=(await call(args)).rows[0].value
   assert.deepEqual((await call(args)).rows[0].value,assigned,'retry changed result')
   assert.deepEqual({...assigned,round_number:unit.round_number,revision:unit.revision,updated_at:unit.updated_at},unit,'assignment altered financial/source fields')
   await assert.rejects(call([key(),...args.slice(1)]),/更新/)
   // Explicit D-029 scenario; planned day comes from the existing December 1 contract template.
   if(source.id===51&&source.year===2026&&confirmation.round===1){
    const c=data.contracts.find(c=>c.id===unit.contract_id)
    assert.equal(c.billing_schedule_days[1],'12月1日')
    const versions=Object.fromEntries((await rows('billing_units')).filter(u=>u.project_id===unit.project_id).map(u=>[u.id,u.revision]))
    const period=maintenancePeriod(c.maintenance_start_date,2026)
    const item={date:'2026-12-01',year:2026,round:2,method:'invoice',recipientId:unit.recipient_customer_id,amount:165000,...period}
    const scheduleArgs=[key(),unit.project_id,JSON.stringify(c),JSON.stringify(versions),0,JSON.stringify([item]),'D-029 第2回165,000円。12月1日は既存契約の予定日。未発行・未入金。隔離コピー検証。']
    const add=a=>db.query('select create_future_schedule($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7) value',a)
    const created=(await add(scheduleArgs)).rows[0].value
    assert.equal(created.length,1);assert.equal(created[0].lifecycle,'planned');assert.equal(created[0].planned_amount,165000)
    assert.equal(created[0].issued_on,null);assert.equal(created[0].received_on,null)
    assert.deepEqual((await add(scheduleArgs)).rows[0].value,created)
    const fresh=Object.fromEntries((await rows('billing_units')).filter(u=>u.project_id===unit.project_id).map(u=>[u.id,u.revision]))
    await assert.rejects(add([key(),...scheduleArgs.slice(1,3),JSON.stringify(fresh),...scheduleArgs.slice(4)]),/二重作成/)
    console.log(JSON.stringify({confirmedRound:1,addedRound:2,plannedAmount:165000,scheduledDate:item.date,sourcePreserved:true,duplicateBlocked:true,scope:'isolated copy only'}))
   }
  }
  for(const table of sourceTables)assert.equal(canonicalJson(await rows(table)),canonicalJson([...(data[table]??[])].sort((a,b)=>a.id-b.id)),`${table}: migration changed source`)
  if(real&&data.annual_records.some(r=>r.id===61&&r.contract_id===16)){
   const c=data.contracts.find(c=>c.id===16);assert.ok(c.maintenance_contract_notes.includes('2027年12月31日'))
   const before=(await rows('billing_units')).filter(u=>u.project_id===c.project_id),periodKey=key()
   const args=[periodKey,c.project_id,JSON.stringify(c),JSON.stringify(Object.fromEntries(before.map(u=>[u.id,u.revision]))),2026,'2026-10-27','2027-12-31','隔離コピー：最新契約備考に記載された特別保守期間の指定。実額・請求先・入金日は変更しない。']
   const call=()=>db.query('select set_billing_service_period($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7,$8) value',args)
   const updated=(await call()).rows[0].value;assert.deepEqual((await call()).rows[0].value,updated)
   assert.equal(updated.length,1)
   const original=before.find(u=>u.id===updated[0].id)
   assert.deepEqual({...updated[0],period_start:original.period_start,period_end:original.period_end,revision:original.revision,updated_at:original.updated_at},original)
   console.log('PASS: latest-copy explicit extended period attached to existing paid record; financial/source values unchanged')
  }
  for(const table of sourceTables)assert.equal(canonicalJson(await rows(table)),canonicalJson([...(data[table]??[])].sort((a,b)=>a.id-b.id)),`${table}: period assignment changed source`)
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
   await db.query("insert into billing_runtime_control(owner_user_id,enabled,cutover_on) values($1,true,'2026-09-20')",[actor])
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
   assert.equal(before.cutover_on,'2026-09-20','runtime must expose the durable start of overdue invoice review')
   await db.exec('begin')
   await db.exec(`update contracts set billing_item_flags='{"annual_maintenance":false,"land_cost":true}'::jsonb where id=1`)
   assert.deepEqual((await db.query('select billing_runtime_snapshot() value')).rows[0].value.units,before.units,'Fee selection must not change stored occurrences')
   await db.exec('rollback')
   const backup=(await db.query('select billing_runtime_backup() value')).rows[0].value
   assert.equal(backup.version,2);assert.equal(backup.billing_units.length,before.units.length)
   assert.deepEqual(backup.annual_records,[...fixture.annual_records].sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b))))
   const planned=before.units.find(u=>u.lifecycle==='planned'),paid=before.units.find(u=>u.lifecycle==='received')
   const existingChoice={unitId:String(planned.id),expectedRevision:planned.revision,recipientId:2,method:'請求書',
    scheduledDate:'2026-12-01',plannedAmount:200,periodStart:null,periodEnd:null,note:'変更後の予定'}
   const nextOccurrence={year:2028,round:1,method:'invoice',date:'2027-12-01',recipientId:1,amount:100,...maintenancePeriod(contract.maintenance_start_date,2028)}
   const nextTransfer={action:'transfer',value:{project,contract,newOwner:2,futureRecipient:2,date:'2026-09-01',fields:{contract:{}},
    choices:[existingChoice,{newOccurrence:nextOccurrence}],reason:'次回A、以後Bを確認'}}
   await db.exec('begin')
   const nextKey=key()
   await db.query('select billing_runtime_write($1,$2::jsonb)',[nextKey,JSON.stringify(nextTransfer)])
   await db.query('select billing_runtime_write($1,$2::jsonb)',[nextKey,JSON.stringify(nextTransfer)])
   const nextState=(await db.query('select billing_runtime_snapshot() value')).rows[0].value
   assert.equal(nextState.transfers.length,1)
   assert.equal(nextState.units.filter(u=>u.occurrence_key==='maintenance:2028:round:1').length,1)
   assert.equal(nextState.units.find(u=>u.occurrence_key==='maintenance:2028:round:1').recipient_customer_id,1)
   await db.exec('reset role')
   assert.equal((await db.query('select default_recipient_customer_id from billing_recipient_plans where retired_at is null')).rows[0].default_recipient_customer_id,2)
   await db.exec('set role authenticated')
   assert.equal(nextState.units.find(u=>u.id===paid.id).frozen_amount,paid.frozen_amount)
   await db.exec('rollback')
   assert.deepEqual((await db.query('select billing_runtime_snapshot() value')).rows[0].value,before,'Rolled-back transfer must preserve all prior state')
   for(const [contractMethod,nextMethod] of [['請求書','direct_debit'],['口座振替','invoice'],['口座振替','direct_debit']]){
    await db.exec('begin')
    const variant={...nextTransfer,value:{...nextTransfer.value,fields:{contract:contractMethod==='口座振替'?debitFields:{}},
     choices:[existingChoice,{newOccurrence:{...nextOccurrence,method:nextMethod}}]}}
    await db.query('select billing_runtime_write($1,$2::jsonb)',[key(),JSON.stringify(variant)])
    const state=(await db.query('select billing_runtime_snapshot() value')).rows[0].value
    const saved=state.units.find(u=>u.occurrence_key==='maintenance:2028:round:1')
    assert.equal(saved.collection_method,nextMethod)
    assert.equal(saved.recipient_customer_id,1)
    assert.equal(state.transfers[0].contract_after.billing_method,contractMethod)
    await db.exec('rollback')
   }
   assert.deepEqual((await db.query('select billing_runtime_snapshot() value')).rows[0].value,before,'All method-pair rehearsals must leave the original state intact')
   await db.exec('begin;savepoint failed_transfer')
   await assert.rejects(db.query('select billing_runtime_write($1,$2::jsonb)',[key(),JSON.stringify({...nextTransfer,value:{...nextTransfer.value,
    choices:[existingChoice,{newOccurrence:{...nextOccurrence,year:2026,periodStart:'2026-01-14',periodEnd:'2027-01-13'}}]}})]),/二重作成|対応確認/)
   await db.exec('rollback to savepoint failed_transfer;rollback')
   assert.deepEqual((await db.query('select billing_runtime_snapshot() value')).rows[0].value,before,'Failed next occurrence must roll back the owner, plans and contract')
   console.log('PASS: transfer and one confirmed next occurrence are atomic; next A/default B, replay and failed-insert rollback')
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
   const scheduleState=await runtimeSnapshot()
   const scheduleContract=(await db.query('select to_jsonb(c) value from contracts c where id=1')).rows[0].value
   const periodItem=i=>({...i,...maintenancePeriod(scheduleContract.maintenance_start_date,i.year)})
   const scheduleRequest={projectId:1,contract:scheduleContract,versions:Object.fromEntries(scheduleState.units.map(u=>[u.id,u.revision])),last:resumed.management_events.at(-1).id,
    items:[{date:'2027-12-01',year:2028,round:1,method:'invoice',recipientId:2,amount:75},{date:'2027-12-01',year:2029,round:1,method:'invoice',recipientId:1,amount:80}].map(periodItem),reason:'対象保守期間を確認（前払い）'}
   const scheduleKey=key();await runtimeWrite(scheduleKey,'future_schedule',scheduleRequest);await runtimeWrite(scheduleKey,'future_schedule',scheduleRequest)
   const scheduled=await runtimeSnapshot()
   assert.equal(scheduled.units.length,scheduleState.units.length+2)
   assert.equal(scheduled.units.find(u=>u.occurrence_key==='maintenance:2028:round:1').service_year,2028)
   assert.equal(scheduled.units.find(u=>u.occurrence_key==='maintenance:2028:round:1').scheduled_date,'2027-12-01')
   assert.deepEqual(scheduled.units.filter(u=>scheduleState.units.some(old=>old.id===u.id)),scheduleState.units,'Future generation must never update existing units')
   await assert.rejects(runtimeWrite(key(),'future_schedule',scheduleRequest),/更新されています/)
   const refreshed={...scheduleRequest,versions:Object.fromEntries(scheduled.units.map(u=>[u.id,u.revision]))}
   await assert.rejects(runtimeWrite(key(),'future_schedule',refreshed),/二重作成/)
   await assert.rejects(runtimeWrite(key(),'future_schedule',{...refreshed,items:[periodItem({...refreshed.items[0],date:'2030-06-15',year:2030}),{...refreshed.items[0]}]}),/二重作成/)
   assert.deepEqual(await runtimeSnapshot(),scheduled,'Later duplicate failure must roll back earlier insertion')
   await assert.rejects(runtimeWrite(key(),'future_schedule',{...refreshed,contract:{...scheduleContract,annual_maintenance_inc:999}}),/契約が更新/)
   await assert.rejects(runtimeWrite(key(),'future_schedule',{...refreshed,items:[{...refreshed.items[0],periodStart:null}]}),/対象保守期間/)
   await assert.rejects(runtimeWrite(key(),'future_schedule',{...refreshed,items:[{...refreshed.items[0],periodEnd:'2028-12-31'}]}),/対象保守期間/)
   console.log('PASS: future invoice rounds across years, explicit payers/amounts, insert-only preservation, replay, stale requests, duplicates, full rollback and management end guard')
   await db.exec('begin')
   const longRequest={...refreshed,items:[{date:'2034-09-01',year:2034,round:1,method:'invoice',recipientId:2,amount:165000,periodStart:'2034-10-27',periodEnd:'2035-12-31'}],reason:'長い初年度の個別指定'}
   await runtimeWrite(key(),'future_schedule',longRequest)
   const longState=await runtimeSnapshot(),longVersions=Object.fromEntries(longState.units.map(u=>[u.id,u.revision]))
   await db.exec('savepoint overlapping_period')
   await assert.rejects(runtimeWrite(key(),'future_schedule',{...longRequest,versions:longVersions,items:[{...longRequest.items[0],year:2035,periodStart:'2035-10-27',periodEnd:'2036-10-26'}]}),/重複/)
   await db.exec('rollback to savepoint overlapping_period')
   await runtimeWrite(key(),'future_schedule',{...longRequest,versions:longVersions,items:[{...longRequest.items[0],year:2036,date:'2035-12-01',periodStart:'2036-01-01',periodEnd:'2036-12-31'}]})
   assert.equal((await runtimeSnapshot()).units.find(u=>u.service_year===2036).period_start,'2036-01-01')
   await db.exec('rollback')
   console.log('PASS: PostgreSQL extended initial period and next January period; overlap denied and original snapshot retained')
   const monthly={...refreshed,items:[{date:'2029-12-25',year:2030,round:1,method:'direct_debit',recipientId:2,amount:100},{date:'2030-01-25',year:2030,round:2,method:'direct_debit',recipientId:1,amount:200}].map(periodItem)}
   await runtimeWrite(key(),'future_schedule',monthly)
   const monthlyState=await runtimeSnapshot(),monthUnit=monthlyState.units.find(u=>u.occurrence_key==='maintenance:2030:round:1')
   assert.equal(monthUnit.planned_amount,100)
   await runtimeWrite(key(),'plan',{projectId:1,reason:'振替予定を請求書へ切替し日付を変更',choices:monthlyState.units.filter(u=>u.lifecycle==='planned').map(u=>({unitId:String(u.id),expectedRevision:u.revision,recipientId:u.recipient_customer_id,method:u.id===monthUnit.id?'請求書':u.collection_method==='invoice'?'請求書':'口座振替',scheduledDate:u.id===monthUnit.id?'2030-03-25':u.scheduled_date,plannedAmount:u.planned_amount,periodStart:u.period_start,periodEnd:u.period_end,note:u.plan_note}))})
   const movedState=await runtimeSnapshot()
   await assert.rejects(runtimeWrite(key(),'future_schedule',{...monthly,versions:Object.fromEntries(movedState.units.map(u=>[u.id,u.revision])),items:[monthly.items[0]]}),/二重作成/)
   console.log('PASS: monthly debit plans retain explicit amounts/payers and cannot be regenerated after date/method changes')
   await runtimeWrite(key(),'management',{projectId:1,expectedLast:movedState.management_events.at(-1).id,scope:'all',action:'end',date:'2031-01-01',reason:'将来期間の停止確認',choices:movedState.units.filter(u=>u.lifecycle==='planned').map(u=>({unitId:String(u.id),expectedRevision:u.revision,action:'keep',amount:null}))})
   const stopped=await runtimeSnapshot()
   await assert.rejects(runtimeWrite(key(),'future_schedule',{...monthly,last:stopped.management_events.at(-1).id,versions:Object.fromEntries(stopped.units.map(u=>[u.id,u.revision])),items:[periodItem({...monthly.items[0],year:2032,date:'2030-12-01'})]}),/全取引終了/)
   const managementBackup=(await db.query('select billing_runtime_backup() value')).rows[0].value
   const periodState=await runtimeSnapshot(),periodContract=(await db.query('select to_jsonb(c) value from contracts c where id=1')).rows[0].value
   const periodRequest={projectId:1,contract:periodContract,versions:Object.fromEntries(periodState.units.map(u=>[u.id,u.revision])),year:2025,periodStart:'2025-01-14',periodEnd:'2026-01-13',reason:'過去実績の期間だけを指定'}
   const metadataKey=key();await runtimeWrite(metadataKey,'service_period',periodRequest);await runtimeWrite(metadataKey,'service_period',periodRequest)
   const periodSaved=(await runtimeSnapshot()).units.find(u=>u.service_year===2025),periodOriginal=periodState.units.find(u=>u.id===periodSaved.id)
   assert.deepEqual({...periodSaved,period_start:periodOriginal.period_start,period_end:periodOriginal.period_end,revision:periodOriginal.revision,updated_at:periodOriginal.updated_at},periodOriginal)
   await assert.rejects(runtimeWrite(key(),'service_period',periodRequest),/更新されています/)
   console.log('PASS: authorized existing paid-period metadata correction preserves all financial fields, audit/replay and stale-write protection')
   assert.equal(managementBackup.project_management_events.length,4)
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
  const archiveArg=process.argv.indexOf('--archive')
  if(archiveArg>=0){const output=path.resolve(process.argv[archiveArg+1]??'');if(!output.startsWith('/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups/'))throw Error('Archive must stay in private backup directory');fs.writeFileSync(output,Buffer.from(await archive.arrayBuffer()),{flag:'wx',mode:0o600});console.log('Verified isolated-engine archive saved; not a production PostgreSQL/Auth/Storage backup')}
  await db.exec(`set test.actor='${actor}'`)
  await assert.rejects(db.exec('delete from billing_unit_events'),/append-only/)
  await assert.rejects(db.exec('truncate project_management_events'),/append-only/)
  if(!real){await db.exec("set role authenticated;set test.actor=''");await assert.rejects(db.query('select billing_runtime_backup()'),/利用権限/);await db.exec('reset role')}
  const finalStoredUnits=await rows('billing_units')
  const setupRows=data.projects.map(p=>{const contracts=data.contracts.filter(c=>c.project_id===p.id),contract=contracts[0]??null
   const customer=data.customers.find(c=>c.id===p.customer_id)
   return {project_id:p.id,project_name:p.project_name,customer_name:customer?.company_name??customer?.name??'-',company_name:customer?.company_name??null,
    contract,contract_count:contracts.length,records:contract?data.annual_records.filter(a=>a.contract_id===contract.id):[],currentYearRecord:null,currentYearRecords:[],currentYear:2026}
  })
  const setupReview=legacyScheduleSetupReview(setupRows,new Map(data.projects.map(p=>[p.id,p.customer_id])),finalStoredUnits.map(u=>billingUnitFromStorage(u)),'2026-09-20')
  console.log(JSON.stringify({scope:real?'saved application JSON → isolated logical schema (not production DDL/Auth/storage restore)':'synthetic complete runtime rehearsal',
   sourceCounts:Object.fromEntries(sourceTables.map(t=>[t,(data[t]??[]).length])),expectedUnits:audit.rows.length,importedUnits:imported.billing_units.length,
   importedActualAmount:imported.billing_units.reduce((sum,u)=>sum+(u.frozen_amount??0),0),acceptedProjects:accepted,unresolvedMethodRecordIds:unresolvedMethods,
   sourceRowsUnchanged:true,engineBackupRestoreMatched:true,restoredTables:allTables.length,
   nearTermSetup:{visibleUnsavedPlans:setupReview.items.length,projectsWithConfigurationIssues:new Set(setupReview.issues.map(i=>i.projectId)).size,
    issueReasons:setupReview.issues.reduce((counts,i)=>{counts[i.reason]=(counts[i.reason]??0)+1;return counts},{})},productionCutoverReady:false},null,2))
  if(process.argv.includes('--legacy-calendar-review'))console.log(JSON.stringify({futureCoverage:{scope:'DEPRECATED calendar-year diagnostic; NOT maintenance-period coverage',startMonth:coverage.startMonth,months:coverage.months,
   ...coverage.summary,settingIssues:coverage.issues.length,undatedSavedPlans:coverage.undatedSavedPlans,excludedMultiContractProjects:multiContractProjects.length,authorizesCutover:false}},null,2))
  if(process.argv.includes('--legacy-calendar-review'))console.log(JSON.stringify({futureScheduleReview:{scope:'DEPRECATED calendar-year diagnostic; no creation authorization',selectable:scheduleReview.filter(r=>!r.exclusion).length,
   excluded:scheduleReview.filter(r=>r.exclusion).length,reasons:scheduleReview.filter(r=>r.exclusion).reduce((counts,r)=>{counts[r.exclusion]=(counts[r.exclusion]??0)+1;return counts},{})}},null,2))
  console.log(JSON.stringify({maintenancePeriodReview:{scope:'2026/2027 maintenance starting years, not invoice calendar years; no saves',periodsReviewed:periodReview.length,
   existingRounds:periodReview.flatMap(p=>p.items).filter(i=>i.exclusion?.includes('保存済み')).length,
   ambiguousRounds:periodReview.flatMap(p=>p.items).filter(i=>i.exclusion?.includes('対応確認')).length,
   uncreatedRounds:periodReview.flatMap(p=>p.items).filter(i=>!i.exclusion).length,
   projectsWithSettingIssues:new Set(periodIssues.map(i=>i.projectId)).size,
   settingIssueReasons:periodIssues.reduce((counts,i)=>{counts[i.reason]=(counts[i.reason]??0)+1;return counts},{})}},null,2))
  if(real&&process.argv.includes('--review-details'))console.log(JSON.stringify({periodDetails:periodReview.filter(p=>[19,32,33,40,64].includes(p.projectId)).map(p=>({projectName:data.projects.find(x=>x.id===p.projectId)?.project_name,year:p.year,items:p.items.map(i=>({periodStart:i.periodStart,periodEnd:i.periodEnd,round:i.round,status:i.exclusion??'未作成（請求日・金額の確認前）'}))}))},null,2))
  // Explicit local inspection only. Default test logs never include project names or source notes.
  if(real&&process.argv.includes('--review-details')&&process.argv.includes('--legacy-calendar-review'))console.log(JSON.stringify({reviewDetails:[...new Set(scheduleReview.filter(r=>r.exclusion).map(r=>r.candidate.projectId))].map(id=>({
   projectId:id,projectName:data.projects.find(p=>p.id===id)?.project_name,
   candidates:scheduleReview.filter(r=>r.exclusion&&r.candidate.projectId===id).map(r=>({date:r.candidate.date,round:r.candidate.round,amount:r.candidate.amount,reason:r.exclusion})),
   saved:imported.billing_units.filter(u=>u.project_id===id).map(u=>({sourceRecord:u.source_annual_record_id,sourceIndex:u.source_payment_index,year:u.service_year,round:u.round_number,month:u.service_month,state:u.lifecycle,scheduled:u.scheduled_date,issued:u.issued_on,received:u.received_on,amount:u.frozen_amount,plannedAmount:u.planned_amount}))
  }))},null,2))
 }finally{await db.close()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
