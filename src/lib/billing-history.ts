import type { BillingUnit } from './billing-unit'
import { resolveUnitAmount } from './billing-unit'
import { copyJson } from './billing-json'

/** Filter the already authorized cross-project ledger by saved payer, never current project owner. */
export function customerBillingHistory(units: readonly BillingUnit[], customerId: number): BillingUnit[] {
  if (!Number.isSafeInteger(customerId) || customerId <= 0) throw new Error('顧客を確認してください')
  if (new Set(units.map(unit => unit.id)).size !== units.length) throw new Error('請求回IDが重複しています')
  return copyJson(units.filter(unit => unit.recipientId === customerId)).sort((a, b) =>
    (b.receivedOn ?? b.issuedOn ?? b.scheduledDate ?? '').localeCompare(a.receivedOn ?? a.issuedOn ?? a.scheduledDate ?? '')
      || b.serviceYear - a.serviceYear || a.id.localeCompare(b.id))
}

/** Keep unknown historical amounts separate from totals; planned estimates are not receipts. */
export function summarizeBillingHistory(units: readonly BillingUnit[]) {
  if (new Set(units.map(unit => unit.id)).size !== units.length) throw new Error('請求回IDが重複しています')
  const result = { receivedAmount: 0, unpaidAmount: 0, unknownActualCount: 0, plannedCount: 0, reviewCount: 0, cancelledCount: 0 }
  for (const unit of units) {
    if (unit.lifecycle === 'cancelled') { result.cancelledCount++; continue }
    if (unit.lifecycle === 'review_required') { result.reviewCount++; continue }
    if (unit.lifecycle === 'planned' && !unit.receivedOn && !unit.issuedOn) { result.plannedCount++; continue }
    const amount = resolveUnitAmount(unit, () => null).amount
    if (amount == null) { result.unknownActualCount++; continue }
    if (unit.lifecycle === 'received' || unit.receivedOn) result.receivedAmount += amount
    else result.unpaidAmount += amount
    if (!Number.isSafeInteger(result.receivedAmount) || !Number.isSafeInteger(result.unpaidAmount)) throw new Error('集計金額が大きすぎます')
  }
  return result
}
