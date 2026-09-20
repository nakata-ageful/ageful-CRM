import type { AnnualRecord } from '../types'
import type { BillingMigrationCandidate } from './billing-migration-review'
import { reviewBillingMigration } from './billing-migration-review'
import { identifyBillingMigrationSource } from './billing-migration-source'
import { canonicalJson, copyJson } from './billing-json'
import { isBillingDate } from './billing-unit'

export type InvoiceMigrationContext = {
  projectId: number
  /** Explicit contract→project correspondence from the reviewed source, not conArr[0]. */
  contractId: number
  /** Rehearsal timestamp; production import must use the DB transaction's timestamp. */
  importedAt: string
  methodConfirmation: {
    sourceSnapshotHash: string
    originalMethod: 'invoice' | 'direct_debit'
    collectionMethod: 'invoice'
    basis: string
  }
}

/** Full invoice row preparation, NOT authorization to insert or to remove the legacy gate. */
export async function prepareInvoiceMigrationPayload(
  datasetId: string, candidate: BillingMigrationCandidate, record: AnnualRecord, context: InvoiceMigrationContext,
) {
  const c=copyJson(candidate), original=copyJson(record), ctx=copyJson(context)
  if (!Number.isSafeInteger(ctx.projectId) || ctx.projectId<=0 || !Number.isSafeInteger(ctx.contractId)
    || ctx.contractId<=0 || ctx.contractId!==original.contract_id) throw new Error('契約と発電所の対応を確認してください')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(ctx.importedAt)
    || !Number.isFinite(Date.parse(ctx.importedAt)) || new Date(ctx.importedAt).toISOString()!==ctx.importedAt) {
    throw new Error('移行時刻を確認してください')
  }
  const source=await identifyBillingMigrationSource(datasetId,c,original)
  const method=ctx.methodConfirmation
  const failedDebitToInvoice=original.transfer_failed===true
  if (!method || method.sourceSnapshotHash!==source.columns.source_snapshot_hash || !method.basis?.trim()
    || method.collectionMethod!=='invoice'
    || method.originalMethod!==(failedDebitToInvoice?'direct_debit':'invoice')) {
    throw new Error('元記録に対応した請求方法の確認が必要です。現在の契約からは推測しません')
  }
  // The legacy UI stores a failed debit and the subsequently issued invoice in one row.
  // Import only that fully evidenced shape; ambiguous/split failures remain blocked.
  if (failedDebitToInvoice && (original.payments?.length || !original.billing_date || original.received_date
    || original.status!=='請求済')) throw new Error('振替不能後の請求書発行状態を確認してください')
  const review=reviewBillingMigration(datasetId,[original])
  const base=review.candidates.find(x=>x.sourceKey===c.sourceKey)
  if (!base || review.recordIssues.length) throw new Error('元記録の状態・各回の対応を確認してください')
  // A matching source hash alone does not prove the caller's copied dates/status are unchanged.
  for (const key of ['scheduledDate','issuedOn','receivedOn','paymentDueOn','hasActivity'] as const) {
    if (base[key]!==c[key]) throw new Error('日付・実績の情報が元記録と一致しません')
  }
  if (!Number.isSafeInteger(c.year) || c.year<2000 || c.year>2200
    || (c.seq!==null && (!Number.isSafeInteger(c.seq) || c.seq<=0))) throw new Error('対象年度・回番号を確認してください')
  if (base.issues.some(x=>!['金額要確認','請求先要確認','対象日・対象回要確認'].includes(x))) {
    throw new Error('元記録の明細・日付・回の対応を確認してください')
  }
  for (const date of [c.scheduledDate,c.issuedOn,c.receivedOn,c.paymentDueOn]) {
    if (date!==null && !isBillingDate(date)) throw new Error('日付を確認してください')
  }
  if (!Number.isSafeInteger(c.recipientId) || c.recipientId!<=0 || !c.recipientBasis?.trim()) throw new Error('請求先の確認根拠が必要です')
  let amountBasis:'source_record'|'operator_confirmed'|'unconfirmed'='unconfirmed'
  if (c.hasActivity) {
    if (!Number.isSafeInteger(c.amount) || c.amount!<0 || !c.amountBasis?.trim()
      || !Array.isArray(c.lineItems) || c.lineItems.length===0
      || c.lineItems.some(i=>typeof i.name!=='string' || !i.name.trim() || !Number.isSafeInteger(i.amount) || i.amount<0)
      || c.lineItems.reduce((sum,i)=>sum+i.amount,0)!==c.amount) throw new Error('確定金額と各回の明細・確認根拠を揃えてください')
    amountBasis=base.amount===c.amount && canonicalJson(base.lineItems)===canonicalJson(c.lineItems)?'source_record':'operator_confirmed'
  } else if (c.amount!==null || c.lineItems!==null) {
    throw new Error('未発行予定に過去の確定額は設定しません')
  }
  return {
    row: {
      project_id:ctx.projectId,contract_id:ctx.contractId,recipient_plan_id:null,
      recipient_customer_id:c.recipientId,recipient_source:'confirmed' as const,
      // Source identity, not year/seq alone: same-year annual records stay separate.
      occurrence_key:`legacy:${original.id}:${source.columns.source_payment_index}`,
      service_year:c.year,service_month:null,round_number:c.seq,schedule_slot_id:null,
      scheduled_date:c.scheduledDate,original_method:failedDebitToInvoice?'direct_debit' as const:'invoice' as const,collection_method:'invoice' as const,
      lifecycle:c.receivedOn?'received' as const:c.issuedOn?'issued' as const:'planned' as const,
      collection_state:c.receivedOn?'succeeded' as const:'pending' as const,
      issued_on:c.issuedOn,received_on:c.receivedOn,payment_due_on:c.paymentDueOn,
      frozen_amount:c.amount,frozen_line_items:copyJson(c.lineItems),frozen_at:c.hasActivity?ctx.importedAt:null,
      amount_basis:amountBasis,revision:0,...source.columns,
    },
    evidence: {...source.evidence,methodConfirmation:method,recipientBasis:c.recipientBasis,amountBasis:c.amountBasis},
    readyToWrite:false as const,
  }
}
