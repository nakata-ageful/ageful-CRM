// Synthetic fixtures only; no network, credentials or persistent DB.
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
const ts = require('typescript'), { webcrypto, createHash } = require('node:crypto')
const root = path.resolve(__dirname, '..'), cache = new Map()
function load(file) {
  file = path.resolve(root, file)
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }; cache.set(file, module)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, TextEncoder, crypto: webcrypto,
    require: name => {
      if (!name.startsWith('.')) throw Error('External dependency forbidden')
      return load(path.resolve(path.dirname(file), name) + '.ts')
    },
  })
  return module.exports
}
const { reviewBillingMigration: review } = load('src/lib/billing-migration-review.ts')
const { identifyBillingMigrationSource: identify } = load('src/lib/billing-migration-source.ts')
const { prepareMaintenancePreservation: preserve, verifyMaintenancePreservation: verifyPreserved } = load('src/lib/maintenance-migration.ts')
const { billingUnitStatusLabel: statusLabel, isEditableInvoicePlan, resolveUnitAmount } = load('src/lib/billing-unit.ts')
const { customerBillingHistory, summarizeBillingHistory } = load('src/lib/billing-history.ts')
const { buildBillingOverview } = load('src/lib/billing-overview.ts')
const { createInvoiceWriteSession } = load('src/lib/invoice-write-session.ts')
const single = { id: 1, contract_id: 1, year: 2025, payments: null, status: '請求済',
  billing_scheduled_date: '2025-06-01', billing_date: '2025-06-01', received_date: null,
  payment_due_date: null, transfer_failed: false, line_items: [{ name: '保守料', amount: 100 }] }
const split = { ...single, id: 2, payments: [
  { seq: 2, scheduled_date: '2025-06-01', billing_date: '2025-06-01', received_date: null },
  { seq: 2, scheduled_date: '2025-12-01', billing_date: null, received_date: null },
] }
async function main() {
  const calls=[],command={unitId:1,revision:0,mode:'collection',value:{received_on:'2026-06-01'},reason:null}
  let ids=0,reads=0
  const writer=createInvoiceWriteSession({operationId:()=>String(++ids),write:async(id,request)=>{calls.push({id,request})},
    reload:async()=>{if(++reads===1)throw Error('synthetic reload failure');return ['reloaded']}})
  await assert.rejects(writer.save(command),/reload failure/)
  await assert.rejects(writer.save({...command,unitId:2}),/未確認/)
  await writer.save(command)
  assert.equal(calls.length,2)
  assert.equal(calls[0].id,calls[1].id,'Retry must reuse the same RPC operation ID')
  await writer.save({...command,revision:1})
  assert.equal(ids,2)
  let rejected=true
  const editable=createInvoiceWriteSession({operationId:()=>String(++ids),write:async()=>{if(rejected)throw Error('rejected')},
    reload:async()=>[],definitelyRejected:()=>true})
  await assert.rejects(editable.save(command),/rejected/)
  rejected=false
  await editable.save({...command,unitId:2})
  const maintenance={...single,status:'未入金',billing_scheduled_date:null,billing_date:null,line_items:[],payments:[],maintenance_record:'点検完了',escort_record:'訪問履歴'}
  const retained=await preserve('fixture',[maintenance])
  assert.equal(retained.billingUnitsCreated,0)
  assert.equal(retained.readyToWrite,false)
  assert.equal(retained.retained[0].sourceRecord.escort_record,'訪問履歴')
  assert.equal(retained.retained[0].sourceSnapshotHash,createHash('sha256').update(retained.retained[0].sourceSignature).digest('hex'))
  maintenance.maintenance_record='後日編集'
  assert.equal(retained.retained[0].sourceRecord.maintenance_record,'点検完了')
  const restored=JSON.parse(JSON.stringify(retained.retained.map(r=>r.sourceRecord)))
  assert.equal((await verifyPreserved(retained,restored)).matches,true)
  assert.equal((await verifyPreserved(retained,restored)).productionRestoreVerified,false)
  assert.equal((await verifyPreserved(retained,[])).mismatches[0].reason,'missing')
  assert.equal((await verifyPreserved(retained,[...restored,...restored])).mismatches[0].reason,'duplicate')
  assert.equal((await verifyPreserved(retained,[{...restored[0],escort_record:null}])).mismatches[0].reason,'changed')
  assert.equal((await verifyPreserved(retained,[...restored,{...restored[0],id:99}])).mismatches[0].reason,'extra')
  await assert.rejects(verifyPreserved({...retained,retained:[{...retained.retained[0],sourceSnapshotHash:'0'.repeat(64)}]},restored),/照合情報/)
  for(const patch of [{payment_due_date:'2025-06-10'},{line_items:single.line_items},{status:'入金済'},{transfer_failed:true},{payments:[{seq:1}]}])
    await assert.rejects(preserve('fixture',[{...maintenance,...patch}]),/請求情報/)
  assert.equal(review('fixture',[{...maintenance,payment_due_date:'2025-06-10'}]).recordIssues.length,1)
  assert.equal(review('fixture',[maintenance]).candidates.length,0)
  const display={method:'口座振替',lifecycle:'planned',issuedOn:null,receivedOn:null,frozenAt:null,frozenAmount:null}
  assert.equal(resolveUnitAmount(display,()=>999999).amount,null,'No current-contract fallback for unrecorded plan')
  assert.equal(resolveUnitAmount({...display,plannedAmount:0},()=>999999).amount,0)
  assert.equal(resolveUnitAmount({...display,plannedAmount:82500},()=>999999).amount,82500)
  assert.throws(()=>resolveUnitAmount({...display,plannedAmount:-1}),/不正/)
  assert.equal(statusLabel(display),'振替予定')
  assert.equal(statusLabel({...display,lifecycle:'fixed'}),'入金確認待ち')
  assert.equal(statusLabel({...display,lifecycle:'cancelled'}),'取りやめ')
  assert.equal(statusLabel({...display,lifecycle:'review_required'}),'記録要確認')
  for(const lifecycle of ['cancelled','review_required']) {
    const unit={...display,method:'請求書',lifecycle}
    assert.equal(isEditableInvoicePlan(unit),false)
    assert.equal(resolveUnitAmount(unit,()=>{throw Error('Must not calculate historical amount')}).amount,null)
  }
  const history=[{...display,id:'past-A',projectId:1,serviceYear:2025,recipientId:1,lifecycle:'received',receivedOn:'2025-06-01',frozenAmount:100},
    {...display,id:'next-B',projectId:1,serviceYear:2026,recipientId:2},
    {...display,id:'other-A',projectId:2,serviceYear:2026,recipientId:1,lifecycle:'issued',issuedOn:'2026-06-01',frozenAmount:200},
    {...display,id:'unknown',projectId:3,serviceYear:2026,recipientId:null}]
  const customerA=customerBillingHistory(history,1)
  assert.equal(customerA.map(u=>u.id).join(','),'other-A,past-A')
  assert.equal(summarizeBillingHistory(customerA).receivedAmount,100)
  assert.equal(summarizeBillingHistory(customerA).unpaidAmount,200)
  assert.equal(customerBillingHistory(history,2).length,1)
  customerA[0].frozenAmount=999
  assert.equal(history[2].frozenAmount,200)
  assert.equal(summarizeBillingHistory([{...history[0],frozenAmount:null}]).unknownActualCount,1)
  assert.equal(summarizeBillingHistory([{...history[0],lifecycle:'cancelled'}]).receivedAmount,0)
  assert.throws(()=>customerBillingHistory([...history,history[0]],1),/重複/)
  const scheduled={...history[1],method:'請求書',scheduledDate:'2027-01-01'}
  const overview=buildBillingOverview([scheduled,...history.filter(u=>u.id!=='next-B')],'2026-12-01')
  assert.equal(overview.months.join(','),'2026-12,2027-01,2027-02')
  assert.equal(overview.upcoming[0].recipientId,2)
  assert.equal(buildBillingOverview([{...scheduled,revision:99}],'2026-12-01').upcoming.length,1,'Saving a plan must not hide it')
  const issued={...scheduled,lifecycle:'issued',issuedOn:'2026-12-01',frozenAmount:82500,serviceYear:2026}
  const afterIssue=buildBillingOverview([issued],'2026-12-01')
  assert.equal(afterIssue.upcoming.length,0)
  assert.equal(afterIssue.unpaid.length,1)
  assert.equal(afterIssue.totals.unpaidAmount,82500)
  assert.equal(buildBillingOverview([{...issued,receivedOn:'2026-12-10',lifecycle:'received'}],'2026-12-01').received.length,1)
  assert.equal(buildBillingOverview([{...scheduled,scheduledDate:'2027-06-01'}],'2026-12-01').laterPlans.length,1)
  assert.equal(buildBillingOverview([{...scheduled,scheduledDate:null}],'2026-12-01').undatedPlans.length,1)
  assert.equal(buildBillingOverview([{...scheduled,lifecycle:'cancelled'}],'2026-12-01').upcoming.length,0)
  const candidates = review('fixture', [single, split]).candidates
  const mapped = await Promise.all(candidates.map(c => identify('fixture', c, c.recordId === 1 ? single : split)))
  assert.deepEqual(mapped.map(x => x.columns.source_payment_index), [0, 1, 2])
  assert.deepEqual(mapped.map(x => x.evidence.originalPaymentIndex), [null, 0, 1])
  assert.deepEqual(mapped.map(x => x.evidence.originalSeq), [null, 2, 2])
  for (const m of mapped) {
    assert.equal(m.readyToWrite, false)
    assert.equal(m.columns.source_snapshot_hash, createHash('sha256').update(m.evidence.sourceSignature).digest('hex'))
  }
  assert.equal(candidates[0].recipientId, null, 'Do not infer historical payer')
  assert.ok(candidates[1].issues.includes('回番号重複・対応要確認'))
  assert.notEqual(mapped[1].columns.source_payment_index, mapped[2].columns.source_payment_index)
  await assert.rejects(identify('another', candidates[0], single), /データセット/)
  await assert.rejects(identify('fixture', candidates[0], { ...single, notes: '変更' }), /元データ/)
  await assert.rejects(identify('fixture', candidates[1], { ...split, payments: [...split.payments].reverse() }), /元データ/)
  await assert.rejects(identify('fixture', { ...candidates[1], paymentIndex: -1 }, split), /配列位置/)
  await assert.rejects(identify('fixture', { ...candidates[1], seq: 1 }, split), /回番号/)
  await assert.rejects(identify('fixture', { ...candidates[0], contractId: 99 }, single), /識別情報/)
  await assert.rejects(identify('fixture', { ...candidates[0], paymentIndex: 0 }, single), /単回/)
  // Same contract/year but distinct source rows must never merge.
  const other = { ...single, id: 3 }
  const otherMap = await identify('fixture', review('fixture', [other]).candidates[0], other)
  assert.notEqual(otherMap.columns.source_annual_record_id, mapped[0].columns.source_annual_record_id)
  const { PGlite } = await import('@electric-sql/pglite')
  const db = new PGlite()
  try {
    await db.exec(`create table customers(id bigint primary key);
      create table projects(id bigint primary key);
      create table contracts(id bigint primary key, project_id bigint references projects(id));
      create table annual_records(id bigint primary key);
      insert into projects values (1); insert into contracts values (1,1);
      insert into annual_records values (1),(2),(3);`)
    await db.transaction(async tx => {
      await tx.exec("set local ageful.allow_draft_migration='yes'")
      await tx.exec(fs.readFileSync(path.join(root, 'database/drafts/20260907_billing_ownership_foundation.sql'), 'utf8'))
    })
    // Tests ONLY the source columns; deliberately not a full migration payload.
    const insert = (m, key = m.evidence.sourceKey) => db.query(`insert into billing_units
      (project_id,contract_id,occurrence_key,service_year,original_method,collection_method,lifecycle,
       source_annual_record_id,source_payment_index,source_snapshot_hash)
      values (1,1,$1,2025,'invoice','invoice','review_required',$2,$3,$4)`,
      [key, m.columns.source_annual_record_id, m.columns.source_payment_index, m.columns.source_snapshot_hash])
    for (const m of [...mapped, otherMap]) {
      await insert(m)
      const result = await db.query("select encode(sha256(convert_to($1,'UTF8')),'hex') as hash", [m.evidence.sourceSignature])
      assert.equal(result.rows[0].hash, m.columns.source_snapshot_hash, 'PostgreSQL and JS hash identical canonical bytes')
    }
    assert.equal((await db.query('select count(*)::int as n from billing_units')).rows[0].n, 4)
    await assert.rejects(insert(mapped[0], 'different-key'), /billing_units_source_occurrence_uidx/)
    await assert.rejects(insert({ ...mapped[0], columns: { ...mapped[0].columns, source_payment_index: null } }, 'missing-index'), /check constraint/)
    await assert.rejects(insert({ ...mapped[0], columns: { ...mapped[0].columns, source_annual_record_id: 999 } }, 'missing-source'), /foreign key/)
    assert.equal((await db.query('select count(*)::int as n from billing_units')).rows[0].n, 4)
  } finally { await db.close() }
  console.log('Billing migration source identity: pure checks and isolated PostgreSQL tests passed')
  console.log('Scope: identity columns only. No complete migration, live data, payer confirmation or production changes.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
