import type { AnnualRecord, PaymentEntry } from '../types'

/** 親のstatusや予定日だけでは発行済みとしない。分割は各回で判定する。 */
export function paymentHasActivity(payment: PaymentEntry): boolean {
  return !!(payment.billing_date || payment.received_date)
}

export function recordHasActivity(record: AnnualRecord): boolean {
  return !!(record.billing_date || record.received_date || record.transfer_failed)
}

export function hasHandledInvoiceAt(records: AnnualRecord[], date: string, round: number, sameDateHasMultipleRounds = false): boolean {
  return records.some(record => record.payments?.length
    ? record.payments.some(p => p.scheduled_date === date && (!sameDateHasMultipleRounds || p.seq === round) && paymentHasActivity(p))
    : record.billing_scheduled_date === date && recordHasActivity(record))
}

/** 旧データでは安全な回の更新を保証できない場合がある。新規作成せず詳細へ案内する。 */
export function hasSavedInvoicePlanAt(records: AnnualRecord[], date: string): boolean {
  return records.some(record => record.billing_scheduled_date === date
    || record.payments?.some(p => p.scheduled_date === date))
}
