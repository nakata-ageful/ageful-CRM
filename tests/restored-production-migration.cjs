// Rehearses the complete source import against a PostgreSQL restore of production.
// It always rolls back. It never reads .env and cannot be used to mutate production.
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
const {auditBillingBackup,canonicalJson,isMaintenanceOnlyRecord}=require('../scripts/review-billing-backup.cjs')
const {confirmedBillingHistory}=require('../scripts/confirmed-billing-history.cjs')
const q=value=>`'${String(value).replaceAll("'","''")}'`
let sequence=0
const key=()=>`77777777-7777-4777-8777-${String(++sequence).padStart(12,'0')}`

async function main(){
 const [backupFile,amountFile,payerFile,historyFile,psql,socket,port='55432',database='ageful_restore']=process.argv.slice(2)
 if(!database||!port||!socket||!psql||![backupFile,amountFile,payerFile,historyFile].every(Boolean)){
  throw Error('Usage: node tests/restored-production-migration.cjs BACKUP AMOUNTS PAYER HISTORY PSQL SOCKET [PORT] [DATABASE]')
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
 sql.push('BEGIN',"set local timezone='UTC'","set local test.actor='11111111-1111-4111-8111-111111111111'")
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
   payloads.push(await prepare(audit.datasetId,candidate,record,{projectId:project.id,contractId:contract.id,importedAt:'2026-09-20T00:00:00.000Z',
    methodConfirmation:{sourceSnapshotHash:identity.columns.source_snapshot_hash,originalMethod:failedDebitToInvoice?'direct_debit':'invoice',collectionMethod:'invoice',
     basis:failedDebitToInvoice?'元年度記録のtransfer_failed=true、請求日、請求済状態と現契約の口座振替設定による振替不能後の請求書切替確認':
      confirmed?.method==='invoice'?confirmed.basis:'RESTORED COPY REHEARSAL ONLY: current invoice setting; historical method not independently verified'}}))
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
 sql.push(`DO $$ DECLARE units integer; evidence integer; accepted integer; amount bigint; BEGIN
  SELECT count(*),coalesce(sum(frozen_amount),0) INTO units,amount FROM public.billing_units;
  SELECT count(*) INTO evidence FROM public.invoice_import_evidence;
  SELECT count(*) INTO accepted FROM public.billing_migration_acceptances;
  IF units<>${audit.rows.length} OR amount<>${audit.knownActualAmount} OR evidence<>${data.annual_records.length} OR accepted<>${data.projects.length} THEN
    RAISE EXCEPTION 'restored migration mismatch units %, amount %, evidence %, accepted %',units,amount,evidence,accepted;
  END IF;
  IF EXISTS(SELECT 1 FROM public.invoice_import_evidence e LEFT JOIN public.annual_records a ON a.id=e.source_annual_record_id WHERE to_jsonb(a) IS DISTINCT FROM e.source_record) THEN
    RAISE EXCEPTION 'source changed during restored migration';
  END IF;
 END $$`)
 sql.push(`select jsonb_build_object('units',count(*),'actual_amount',coalesce(sum(frozen_amount),0),
  'failed_debit_invoice_units',count(*) filter(where original_method='direct_debit' and collection_method='invoice')) report from public.billing_units`)
 sql.push('ROLLBACK')
 const output=execFileSync(psql,[`--host=${socket}`,`--port=${port}`,`--dbname=${database}`,'--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align'],
  {input:sql.join(';\n')+';\n',encoding:'utf8',maxBuffer:20_000_000})
 const report=output.split('\n').map(x=>x.trim()).filter(x=>x.startsWith('{')&&x.includes('failed_debit_invoice_units')).at(-1)
 assert.ok(report,'Missing restored migration report')
 const parsed=JSON.parse(report)
 assert.deepEqual(parsed,{units:audit.rows.length,actual_amount:audit.knownActualAmount,failed_debit_invoice_units:1})
 console.log(JSON.stringify({passed:true,transaction:'rolled_back',...parsed,sourceRecords:data.annual_records.length,acceptedProjects:data.projects.length},null,2))
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
