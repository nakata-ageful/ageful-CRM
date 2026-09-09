import { isBillingDate, type BillingUnit } from './billing-unit'
import type { BillingLineItem } from '../types'

/** Strict read boundary. No current-owner, current-contract or date inference. */
export function billingUnitFromStorage(row: Record<string, unknown>): BillingUnit {
  const integer = (key: string, min: number) => {
    const value = row[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) throw new Error(`請求記録の${key}が不正です`)
    return value
  }
  const date = (key: string) => {
    const value = row[key]
    if (value === null) return null
    if (typeof value !== 'string' || !isBillingDate(value)) throw new Error(`請求記録の${key}が不正です`)
    return value
  }
  const lifecycle = row.lifecycle
  if (!['planned','fixed','issued','received','cancelled','review_required'].includes(String(lifecycle))) throw new Error('請求記録の状態が不正です')
  if (!['invoice','direct_debit'].includes(String(row.collection_method))) throw new Error('請求方法が不正です')
  const year = integer('service_year', 2000)
  if (year > 2200) throw new Error('請求年度が不正です')
  const month = row.service_month === null ? null : integer('service_month', 1)
  if (month !== null && month > 12) throw new Error('対象月が不正です')
  const round = row.round_number === null ? null : integer('round_number', 1)
  const amount = row.frozen_amount === null ? null : integer('frozen_amount', 0)
  let items: BillingLineItem[] | null = null
  let frozenAt: string | null = null
  if (amount !== null) {
    if (!Array.isArray(row.frozen_line_items) || !row.frozen_line_items.length) throw new Error('確定明細がありません')
    items = row.frozen_line_items.map(item => {
      if (!item || typeof item.name !== 'string' || !item.name.trim() || !Number.isSafeInteger(item.amount) || item.amount < 0) throw new Error('確定明細が不正です')
      return { name: item.name, amount: item.amount }
    })
    if (items.reduce((sum, item) => sum + item.amount, 0) !== amount) throw new Error('確定額と明細が一致しません')
    if (typeof row.frozen_at !== 'string' || !Number.isFinite(Date.parse(row.frozen_at))) throw new Error('確定日時が不正です')
    frozenAt = row.frozen_at
  } else if (row.frozen_line_items !== null || row.frozen_at !== null) throw new Error('確定情報が不整合です')
  return { id: String(integer('id',1)), projectId: integer('project_id',1), serviceYear: year,
    roundLabel: month !== null ? `${month}月分` : round !== null ? `第${round}回` : '保存済み単回記録',
    method: row.collection_method === 'invoice' ? '請求書' : '口座振替',
    scheduledDate: date('scheduled_date'), issuedOn: date('issued_on'), receivedOn: date('received_on'),paymentDueOn:date('payment_due_on'),
    recipientId: row.recipient_customer_id === null ? null : integer('recipient_customer_id',1),
    lifecycle: lifecycle as BillingUnit['lifecycle'], frozenAmount: amount, frozenLineItems: items, frozenAt,
    plannedAmount: row.planned_amount == null ? null : integer('planned_amount',0), revision: integer('revision',0) }
}
