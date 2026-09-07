import type { AnnualRecordStatus, PaymentEntry } from '../types'

/** 日付から状態を判定。入金日は請求日が欠けた旧記録でも有効な実績。 */
export function statusFromBillingDates(input: {
  billing_date?: string | null
  received_date?: string | null
  payments?: readonly PaymentEntry[] | null
}): AnnualRecordStatus {
  if (input.payments?.length) {
    if (input.payments.every(p => !!p.received_date)) return '入金済'
    return input.payments.some(p => !!p.billing_date || !!p.received_date) ? '請求済' : ''
  }
  if (input.received_date) return '入金済'
  return input.billing_date ? '請求済' : ''
}
