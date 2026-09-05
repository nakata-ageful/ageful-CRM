import type { AnnualRecord, BillingLineItem } from '../types'
import { canonicalJson, copyJson } from './billing-json'
import { isBillingDate } from './billing-unit'

export type MigrationConfirmation = {
  sourceKey: string
  sourceSignature: string
  amount?: number
  lineItems?: BillingLineItem[]
  amountBasis?: string
  recipientId?: number
  recipientBasis?: string
}
export type BillingMigrationCandidate = {
  sourceKey: string
  /** 元レコード全体の厳密照合用JSON。暗号学的ハッシュではない。 */
  sourceSignature: string
  recordId: number
  contractId: number
  year: number
  paymentIndex: number | null
  seq: number | null
  scheduledDate: string | null
  issuedOn: string | null
  receivedOn: string | null
  paymentDueOn: string | null
  hasActivity: boolean
  amount: number | null
  lineItems: BillingLineItem[] | null
  recipientId: number | null
  amountBasis: string | null
  recipientBasis: string | null
  issues: string[]
}

/** 読み取り専用の照合計画。新DBへのINSERT用payloadではない。 */
export function reviewBillingMigration(
  datasetId: string, records: readonly AnnualRecord[], confirmations: readonly MigrationConfirmation[] = [],
) {
  if (!datasetId.trim()) throw new Error('移行元データの識別子が必要です')
  if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('元レコードIDが重複しています')
  if (new Set(confirmations.map(c => c.sourceKey)).size !== confirmations.length) throw new Error('同じ回の確認値が複数あります')
  const candidates: BillingMigrationCandidate[] = []
  const retainedOnlyIds: number[] = []
  const recordIssues: { recordId: number; message: string }[] = []
  for (const record of records) {
    const sourceSignature = canonicalJson(record)
    const split = !!record.payments?.length
    if (split && ((record.billing_date && !record.payments!.some(p => p.billing_date === record.billing_date))
      || (record.received_date && !record.payments!.some(p => p.received_date === record.received_date)))) {
      recordIssues.push({ recordId: record.id, message: '親の請求日・入金日と各回の対応要確認' })
    }
    if (record.status === '入金済' && (split ? record.payments!.some(p => !p.received_date) : !record.received_date)) {
      recordIssues.push({ recordId: record.id, message: '入金済の状態と入金日の対応要確認' })
    }
    const parts = split ? record.payments! : [{ seq: null, scheduled_date: record.billing_scheduled_date,
      billing_date: record.billing_date, received_date: record.received_date }]
    for (const [index, part] of parts.entries()) {
      const hasActivity = !!(part.billing_date || part.received_date || (!split && record.transfer_failed))
      // 保守メモだけの行は請求を捏造せず、元行の保全対象として残す。
      if (!split && !hasActivity && !part.scheduled_date) {
        retainedOnlyIds.push(record.id)
        if (record.line_items?.length || record.status === '請求済') recordIssues.push({ recordId: record.id, message: '明細・状態のみの記録です。請求回の実績は自動生成しません' })
        continue
      }
      const candidate: BillingMigrationCandidate = {
        sourceKey: `${encodeURIComponent(datasetId)}/annual/${record.id}/${split ? `payment/${index}/${part.seq}` : 'single'}`,
        sourceSignature, recordId: record.id, contractId: record.contract_id, year: record.year,
        paymentIndex: split ? index : null, seq: part.seq, scheduledDate: part.scheduled_date,
        issuedOn: part.billing_date, receivedOn: part.received_date, paymentDueOn: split ? null : record.payment_due_date,
        hasActivity, amount: null, lineItems: null, recipientId: null, amountBasis: null, recipientBasis: null, issues: [],
      }
      const issues = candidate.issues
      if ([part.scheduled_date, part.billing_date, part.received_date, candidate.paymentDueOn].some(date => date != null && !isBillingDate(date))) issues.push('日付要確認')
      if (split && record.payments!.filter(p => p.seq === part.seq).length > 1) issues.push('回番号重複・対応要確認')
      if (split && record.transfer_failed) issues.push('振替不能の対象回要確認')
      if (split && record.payment_due_date) issues.push('入金予定日の対象回要確認')
      // 年度の共通明細を各分割回へコピーしない。単回も保存根拠として区別する。
      if (!split && hasActivity && record.line_items?.length) {
        if (validItems(record.line_items)) {
          candidate.lineItems = copyJson(record.line_items)
          candidate.amount = record.line_items.reduce((sum, item) => sum + item.amount, 0)
          candidate.amountBasis = '単回レコードの保存明細（原本照合とは別）'
        } else issues.push('保存明細の金額要確認')
      }
      const confirmed = confirmations.find(c => c.sourceKey === candidate.sourceKey)
      if (confirmed) {
        if (confirmed.sourceSignature !== sourceSignature) issues.push('確認後に元データが変わっています')
        else {
          if (confirmed.amount != null) {
            if (!hasActivity) issues.push('未発行予定には過去の確定額を適用しません')
            else if (!Number.isSafeInteger(confirmed.amount) || confirmed.amount < 0 || !confirmed.amountBasis?.trim()) issues.push('金額の確認根拠が不正です')
            else if (confirmed.lineItems && (!validItems(confirmed.lineItems)
              || confirmed.lineItems.reduce((sum, i) => sum + i.amount, 0) !== confirmed.amount)) issues.push('確認金額と明細が一致しません')
            else {
              candidate.amount = confirmed.amount
              candidate.lineItems = confirmed.lineItems ? copyJson(confirmed.lineItems) : null
              candidate.amountBasis = confirmed.amountBasis
            }
          }
          if (confirmed.recipientId != null) {
            if (!Number.isSafeInteger(confirmed.recipientId) || confirmed.recipientId <= 0 || !confirmed.recipientBasis?.trim()) issues.push('請求先の確認根拠が不正です')
            else { candidate.recipientId = confirmed.recipientId; candidate.recipientBasis = confirmed.recipientBasis }
          }
        }
      }
      if (hasActivity && candidate.amount == null) issues.push('金額要確認')
      if (candidate.recipientId == null) issues.push('請求先要確認')
      if (!part.scheduled_date) issues.push('対象日・対象回要確認')
      candidates.push(candidate)
    }
  }
  const unmatchedConfirmations = confirmations.filter(c => !candidates.some(unit => unit.sourceKey === c.sourceKey)).map(c => c.sourceKey)
  return {
    sourceRecords: copyJson([...records]), // 保守・駆付記録・元明細も全て維持
    candidates, retainedOnlyIds, unmatchedConfirmations, recordIssues, readyToWrite: false as const,
    counts: { records: records.length, candidates: candidates.length, actual: candidates.filter(c => c.hasActivity).length,
      planned: candidates.filter(c => !c.hasActivity).length, needsReview: candidates.filter(c => c.issues.length).length },
    // 金額集計は候補ごとの値。未確認を0として混ぜない。
    knownActualAmount: candidates.filter(c => c.hasActivity && c.amount != null).reduce((sum, c) => sum + c.amount!, 0),
    unknownActualCount: candidates.filter(c => c.hasActivity && c.amount == null).length,
  }
}

function validItems(items: BillingLineItem[]): boolean {
  return items.length > 0 && items.every(i => i.name.trim() && Number.isSafeInteger(i.amount) && i.amount >= 0)
    && Number.isSafeInteger(items.reduce((sum, i) => sum + i.amount, 0))
}
