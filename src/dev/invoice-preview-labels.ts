import { billingUnitFromStorage } from '../lib/billing-unit-storage'
import { resolveUnitAmount } from '../lib/billing-unit'

/** The auxiliary DEV table must use the same saved values as the common detail. */
export function previewUnitLabel(row: Record<string, unknown>): string {
  const unit = billingUnitFromStorage(row)
  return `${unit.serviceYear}年 ${unit.roundLabel}`
}

export function previewAmountLabel(row: Record<string, unknown>): string {
  const value = resolveUnitAmount(billingUnitFromStorage(row))
  return value.amount === null ? '金額要確認' : `${value.amount.toLocaleString('ja-JP')}円（${value.basis}）`
}

export function previewEventLabel(type: string, before: { collection_method: string }, after: { collection_method: string }): string {
  if (type === 'plan_changed' && before.collection_method === 'direct_debit' && after.collection_method === 'invoice') {
    return '振替不能を確認・請求書へ切替'
  }
  return ({ plan_changed: '予定を保存', issued: '発行', collection_recorded: '入金確認', corrected: '訂正' } as Record<string,string>)[type] ?? type
}
