// Rehearses the complete source import against a PostgreSQL restore of production.
// Default is rollback. Committing is allowed only to the exact disposable local-clone
// database name and socket checked below. It never reads .env or connects to Supabase.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm')
const {execFileSync}=require('node:child_process'),ts=require('typescript'),{webcrypto}=require('node:crypto')
const root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports
 const module={exports:{}};cache.set(file,module)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,
  {module,exports:module.exports,TextEncoder,crypto:webcrypto,require:name=>{if(!name.startsWith('.'))throw Error('Unexpected external module');return load(path.resolve(path.dirname(file),name)+'.ts')}})
 return module.exports
}
const {reviewBillingMigration:review}=load('src/lib/billing-migration-review.ts')
const {prepareInvoiceMigrationPayload:prepare}=load('src/lib/invoice-migration-payload.ts')
const {identifyBillingMigrationSource:identify}=load('src/lib/billing-migration-source.ts')
const {maintenancePeriod}=load('src/lib/maintenance-period-label.ts')
const {auditBillingBackup,canonicalJson,isMaintenanceOnlyRecord}=require('../scripts/review-billing-backup.cjs')
const {confirmedBillingHistory}=require('../scripts/confirmed-billing-history.cjs')
const q=value=>`'${String(value).replaceAll("'","''")}'`
let sequence=0
const key=()=>`77777777-7777-4777-8777-${String(++sequence).padStart(12,'0')}`

async function main(){
 const [backupFile,amountFile,payerFile,historyFile,psql,socket,port='55432',database='ageful_restore',mode='--rollback',outputFile,ownerUserId]=process.argv.slice(2)
 const commit=mode==='--commit-local-clone'
 const emit=mode==='--emit-sql'
 if(!database||!port||!socket||!psql||![backupFile,amountFile,payerFile,historyFile].every(Boolean)){
  throw Error('Usage: node tests/restored-production-migration.cjs BACKUP AMOUNTS PAYER HISTORY PSQL SOCKET [PORT] [DATABASE] [--rollback|--commit-local-clone|--emit-sql] [PRIVATE_OUTPUT] [OWNER_UUID]')
 }
 if(!['--rollback','--commit-local-clone','--emit-sql'].includes(mode))throw Error('Unknown transaction mode')
 if(commit&&(!path.resolve(socket).startsWith('/private/tmp/ageful-pg-tools.')||database!=='ageful_new_candidate')){
  throw Error('Commit is restricted to the disposable local ageful_new_candidate clone')
 }
 if(emit){
  const privateDir='/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups'
  if(!outputFile||path.dirname(path.resolve(outputFile))!==privateDir||!/^[-\w]+\.sql$/.test(path.basename(outputFile)))throw Error('SQL output must be a new private-backups/*.sql file')
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerUserId??''))throw Error('New Supabase Auth owner UUID is required')
 }
 const data=JSON.parse(fs.readFileSync(backupFile,'utf8')),amounts=JSON.parse(fs.readFileSync(amountFile,'utf8'))
 const payer=JSON.parse(fs.readFileSync(payerFile,'utf8')),history=confirmedBillingHistory(data,JSON.parse(fs.readFileSync(historyFile,'utf8')))
 const audit=await auditBillingBackup(data,amounts,payer)
 const raw=review(audit.datasetId,data.annual_records)
 const confirmations=raw.candidates.map(c=>{const approved=amounts.find(a=>a.recordId===c.recordId&&a.paymentIndex===c.paymentIndex&&a.seq===c.seq)
  const audited=audit.rows.find(r=>r.recordId===c.recordId&&r.originalPaymentIndex===c.paymentIndex)
  assert.ok(audited,`Missing audited occurrence ${c.recordId}/${c.paymentIndex}`)
  return {sourceKey:c.sourceKey,sourceSignature:c.sourceSignature,recipientId:audited.confirmedRecipientId,recipientBasis:payer.basis,
   ...(approved?{amount:approved.amount,lineItems:approved.lineItems,amountBasis:approved.basis}:{})}
 })
 const candidates=review(audit.datasetId,data.annual_records,confirmations).candidates,sql=[]
 const actor=emit?ownerUserId:'11111111-1111-4111-8111-111111111111'
 const importTimestamp=emit?new Date().toISOString():'2026-09-20T00:00:00.000Z'
 sql.push('BEGIN',"set local timezone='UTC'",`set local test.actor=${q(actor)}`,`set local request.jwt.claim.sub=${q(actor)}`)
 if(emit)sql.push(`DO $$ BEGIN
  IF auth.uid() IS DISTINCT FROM ${q(actor)}::uuid THEN RAISE EXCEPTION 'Auth owner mismatch'; END IF;
  IF (SELECT count(*) FROM public.customers)<>${data.customers.length}
   OR (SELECT count(*) FROM public.projects)<>${data.projects.length}
   OR (SELECT count(*) FROM public.contracts)<>${data.contracts.length}
   OR (SELECT count(*) FROM public.annual_records)<>${data.annual_records.length}
   OR (SELECT count(*) FROM public.maintenance_responses)<>${data.maintenance_responses.length}
   OR (SELECT count(*) FROM public.periodic_maintenance)<>${data.periodic_maintenance.length}
   OR (SELECT count(*) FROM public.prospects)<>${data.prospects.length}
   OR (SELECT count(*) FROM public.attachments)<>${data.attachments.length}
   OR EXISTS(SELECT 1 FROM public.billing_units)
   OR EXISTS(SELECT 1 FROM public.billing_migration_acceptances)
   OR EXISTS(SELECT 1 FROM public.billing_runtime_control)
  THEN RAISE EXCEPTION 'New DB is not an untouched source clone'; END IF;
 END $$`)
 for(const record of data.annual_records){
  const contract=data.contracts.find(c=>c.id===record.contract_id),project=contract&&data.projects.find(p=>p.id===contract.project_id)
  assert.ok(project&&contract,`Invalid source link ${record.id}`)
  const selected=candidates.filter(c=>c.recordId===record.id)
  if(!selected.length){
   assert.equal(isMaintenanceOnlyRecord(record),true,`Ambiguous retained source ${record.id}`)
   sql.push(`select public.preserve_maintenance_source(${q(key())}::uuid,${record.id},
    (select to_jsonb(p) from public.projects p where id=${project.id}),
    (select to_jsonb(c) from public.contracts c where id=${contract.id}),${q(canonicalJson(record))})`)
   continue
  }
  const confirmed=history.get(record.id)
  const failedDebitToInvoice=record.transfer_failed===true&&!record.payments?.length&&!!record.billing_date
   &&!record.received_date&&record.status==='請求済'&&contract.billing_method==='口座振替'
  if(contract.billing_method!=='請求書'&&confirmed?.method!=='invoice'&&!failedDebitToInvoice)throw Error(`Unresolved historical method ${record.id}`)
  const payloads=[]
  for(const candidate of selected){const identity=await identify(audit.datasetId,candidate,record)
   payloads.push(await prepare(audit.datasetId,candidate,record,{projectId:project.id,contractId:contract.id,importedAt:importTimestamp,
    methodConfirmation:{sourceSnapshotHash:identity.columns.source_snapshot_hash,originalMethod:failedDebitToInvoice?'direct_debit':'invoice',collectionMethod:'invoice',
     basis:failedDebitToInvoice?'元年度記録のtransfer_failed=true、請求日、請求済状態と現契約の口座振替設定による振替不能後の請求書切替確認':
      confirmed?.method==='invoice'?confirmed.basis:emit?'移行元の現契約の請求書設定を採用。過去の独立証拠は未照合。':'RESTORED COPY REHEARSAL ONLY: current invoice setting; historical method not independently verified'}}))
  }
  sql.push(`select public.import_invoice_source(${q(key())}::uuid,${record.id},
   (select to_jsonb(p) from public.projects p where id=${project.id}),
   (select to_jsonb(c) from public.contracts c where id=${contract.id}),${q(payloads[0].evidence.sourceSignature)},${q(JSON.stringify(payloads))}::jsonb)`)
 }
 for(const project of data.projects){
  const contracts=data.contracts.filter(c=>c.project_id===project.id),records=data.annual_records.filter(a=>contracts.some(c=>c.id===a.contract_id))
  if(records.length){assert.equal(contracts.length,1,`Migration project ${project.id} must have one contract`)
   const contract=contracts[0]
   sql.push(`select public.initialize_invoice_recipients(${q(key())}::uuid,${project.id},
    (select to_jsonb(p) from public.projects p where id=${project.id}),
    (select to_jsonb(c) from public.contracts c where id=${contract.id}),
    (select coalesce(jsonb_object_agg(source_annual_record_id::text,source_snapshot_hash),'{}'::jsonb) from public.invoice_import_evidence where project_id=${project.id}),
    (select coalesce(jsonb_object_agg(id::text,revision),'{}'::jsonb) from public.billing_units where project_id=${project.id}),${project.customer_id},
    coalesce((select min(scheduled_date) from public.billing_units where project_id=${project.id} and lifecycle='planned'),current_date))`)
  }
  sql.push(`select public.accept_billing_migration(${project.id})`)
 }
 const roundConfirmations=[...history.values()].filter(c=>c.round!==undefined)
 for(const confirmation of roundConfirmations){
  sql.push(`select public.confirm_imported_round(${q(key())}::uuid,
   (select to_jsonb(u) from public.billing_units u where source_annual_record_id=${confirmation.recordId}),
   (select to_jsonb(a) from public.annual_records a where id=${confirmation.recordId}),${confirmation.round},${q(confirmation.basis)})`)
 }
 const kakogawa=roundConfirmations.find(c=>c.recordId===51&&c.round===1)
 if(!kakogawa)throw Error('Confirmed Kakogawa round-one mapping is required')
 const kakogawaRecord=data.annual_records.find(r=>r.id===51),kakogawaContract=kakogawaRecord&&data.contracts.find(c=>c.id===kakogawaRecord.contract_id)
 const kakogawaProject=kakogawaContract&&data.projects.find(p=>p.id===kakogawaContract.project_id)
 assert.ok(kakogawaRecord&&kakogawaContract&&kakogawaProject,'Kakogawa source link is missing')
 assert.equal(kakogawaContract.billing_schedule_days?.[1],'12月1日')
 const kakogawaPeriod=maintenancePeriod(kakogawaContract.maintenance_start_date,2026)
 const kakogawaItem={date:'2026-12-01',year:2026,round:2,method:'invoice',recipientId:kakogawaProject.customer_id,amount:165000,...kakogawaPeriod}
 sql.push(`select public.create_future_schedule(${q(key())}::uuid,${kakogawaProject.id},
  (select to_jsonb(c) from public.contracts c where id=${kakogawaContract.id}),
  (select coalesce(jsonb_object_agg(id::text,revision),'{}'::jsonb) from public.billing_units where project_id=${kakogawaProject.id}),
  (select coalesce(max(id),0) from public.project_management_events where project_id=${kakogawaProject.id}),
  ${q(JSON.stringify([kakogawaItem]))}::jsonb,
  ${q('D-029 第2回165,000円。12月1日は既存契約の予定日。未発行・未入金。新DB移行。')})`)
 const amakusaRecord=data.annual_records.find(r=>r.id===61),amakusaContract=amakusaRecord&&data.contracts.find(c=>c.id===amakusaRecord.contract_id)
 const amakusaProject=amakusaContract&&data.projects.find(p=>p.id===amakusaContract.project_id)
 assert.ok(amakusaRecord&&amakusaContract&&amakusaProject,'Amakusa source link is missing')
 assert.equal(amakusaContract.id,16)
 sql.push(`select public.set_billing_service_period(${q(key())}::uuid,${amakusaProject.id},
  (select to_jsonb(c) from public.contracts c where id=${amakusaContract.id}),
  (select coalesce(jsonb_object_agg(id::text,revision),'{}'::jsonb) from public.billing_units where project_id=${amakusaProject.id}),
  2026,date '2026-10-27',date '2027-12-31',
  ${q('最新契約備考に記載された個別保守期間。実額・請求先・発行日・入金日は変更しない。新DB移行。')})`)
 const expectedStoredUnits=audit.rows.length+1
 sql.push(`DO $$ DECLARE units integer; evidence integer; accepted integer; amount bigint; BEGIN
  SELECT count(*),coalesce(sum(frozen_amount),0) INTO units,amount FROM public.billing_units;
  SELECT count(*) INTO evidence FROM public.invoice_import_evidence;
  SELECT count(*) INTO accepted FROM public.billing_migration_acceptances;
  IF units<>${expectedStoredUnits} OR amount<>${audit.knownActualAmount} OR evidence<>${data.annual_records.length} OR accepted<>${data.projects.length} THEN
    RAISE EXCEPTION 'restored migration mismatch units %, amount %, evidence %, accepted %',units,amount,evidence,accepted;
  END IF;
  IF (SELECT count(*) FROM public.billing_units WHERE source_annual_record_id IS NOT NULL)<>${audit.rows.length}
   OR NOT EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=${kakogawaProject.id} AND service_year=2026 AND round_number=2 AND scheduled_date=date '2026-12-01' AND planned_amount=165000 AND lifecycle='planned')
   OR NOT EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=${amakusaProject.id} AND service_year=2026 AND period_start=date '2026-10-27' AND period_end=date '2027-12-31') THEN
    RAISE EXCEPTION 'confirmed round, future round or individual service period is missing';
  END IF;
  IF EXISTS(SELECT 1 FROM public.invoice_import_evidence e LEFT JOIN public.annual_records a ON a.id=e.source_annual_record_id WHERE to_jsonb(a) IS DISTINCT FROM e.source_record) THEN
    RAISE EXCEPTION 'source changed during restored migration';
  END IF;
 END $$`)
 sql.push(`select jsonb_build_object('units',count(*),'source_units',count(*) filter(where source_annual_record_id is not null),
  'actual_amount',coalesce(sum(frozen_amount),0),'planned_amount',coalesce(sum(planned_amount) filter(where lifecycle='planned'),0),
  'failed_debit_invoice_units',count(*) filter(where original_method='direct_debit' and collection_method='invoice')) report from public.billing_units`)
 sql.push(commit||emit?'COMMIT':'ROLLBACK')
 if(emit){
  fs.writeFileSync(outputFile,sql.join(';\n')+';\n',{flag:'wx',mode:0o600})
  console.log(JSON.stringify({prepared:true,scope:'private SQL; not executed',sourceRecords:data.annual_records.length,sourceUnits:audit.rows.length,
   storedUnits:expectedStoredUnits,actualAmount:audit.knownActualAmount,acceptedProjects:data.projects.length,output:path.basename(outputFile)}))
  return
 }
 const output=execFileSync(psql,[`--host=${socket}`,`--port=${port}`,`--dbname=${database}`,'--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align'],
  {input:sql.join(';\n')+';\n',encoding:'utf8',maxBuffer:20_000_000})
 const report=output.split('\n').map(x=>x.trim()).filter(x=>x.startsWith('{')&&x.includes('failed_debit_invoice_units')).at(-1)
 assert.ok(report,'Missing restored migration report')
 const parsed=JSON.parse(report)
 assert.deepEqual(parsed,{units:expectedStoredUnits,source_units:audit.rows.length,actual_amount:audit.knownActualAmount,planned_amount:165000,failed_debit_invoice_units:1})
 console.log(JSON.stringify({passed:true,transaction:commit?'committed_to_disposable_local_clone':'rolled_back',...parsed,sourceRecords:data.annual_records.length,acceptedProjects:data.projects.length},null,2))
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
