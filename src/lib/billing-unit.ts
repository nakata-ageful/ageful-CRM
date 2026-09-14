import type { BillingLineItem } from '../types'

/** ローカル検証用の請求回モデル。DB/RPC接続と移行はまだ有効化しない。 */
export type BillingUnit = {
  id: string
  projectId: number
  serviceYear: number
  roundLabel: string
  method: '請求書' | '口座振替'
  scheduledDate: string | null
  recipientId: number | null
  lifecycle: 'planned' | 'fixed' | 'issued' | 'received' | 'cancelled' | 'review_required'
  issuedOn: string | null
  receivedOn: string | null
  paymentDueOn?: string | null
  frozenAmount: number | null
  frozenLineItems: BillingLineItem[] | null
  frozenAt: string | null
  /** Saved estimate, distinct from issued/received actuals. Missing means not yet recorded. */
  plannedAmount?: number | null
  revision: number
  periodStart?: string | null
  periodEnd?: string | null
  planNote?: string | null
}

export type UnitAmount = { amount: number | null; basis: '確定額' | '予定額' | '金額要確認' }

/** Shared display wording for invoice/debit history; does not decide when debit amounts freeze. */
export function billingUnitStatusLabel(unit: BillingUnit): string {
  if (unit.lifecycle === 'cancelled') return '取りやめ'
  if (unit.lifecycle === 'review_required') return '記録要確認'
  if (unit.lifecycle === 'received' || unit.receivedOn) return '入金済'
  if (unit.lifecycle === 'issued' || unit.issuedOn) return '発行済・未入金'
  if (unit.lifecycle === 'fixed') return '入金確認待ち'
  return unit.method === '口座振替' ? '振替予定' : '未発行'
}

const isYen = (n: number) => Number.isSafeInteger(n) && n >= 0
const isCustomerId = (n: number) => Number.isSafeInteger(n) && n > 0
export function isBillingDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

/** 凍結額0も正しい値。過去の額が不明なら現契約で埋めない。 */
export function resolveUnitAmount(unit: BillingUnit, _legacyEstimate?: () => number | null): UnitAmount {
  if (unit.frozenAmount != null) {
    if (!isYen(unit.frozenAmount)) throw new Error('確定額が不正です')
    return { amount: unit.frozenAmount, basis: '確定額' }
  }
  if (unit.lifecycle !== 'planned' || unit.issuedOn || unit.receivedOn || unit.frozenAt) {
    return { amount: null, basis: '金額要確認' }
  }
  // D-027: never recompute a saved occurrence from the current contract.
  const amount = unit.plannedAmount ?? null
  if (amount != null && !isYen(amount)) throw new Error('予定額が不正です')
  return { amount, basis: amount == null ? '金額要確認' : '予定額' }
}

/** 振替の固定境界は未決。今回の編集対象は未発行の請求書のみ。 */
export function isEditableInvoicePlan(unit: BillingUnit): boolean {
  return unit.method === '請求書' && unit.lifecycle === 'planned'
    && !unit.issuedOn && !unit.receivedOn && !unit.frozenAt && unit.frozenAmount == null
}

export function upcomingInvoiceUnits(units: readonly BillingUnit[]): BillingUnit[] {
  return units.filter(isEditableInvoicePlan).slice().sort((a, b) =>
    (a.scheduledDate ?? '9999').localeCompare(b.scheduledDate ?? '9999') || a.id.localeCompare(b.id))
}

export function saveInvoicePlan(
  unit: BillingUnit, expectedRevision: number, patch: { recipientId: number; scheduledDate: string },
): BillingUnit {
  if (unit.revision !== expectedRevision) throw new Error('情報が更新されています。確認し直してください')
  if (!isEditableInvoicePlan(unit)) throw new Error('この請求は通常の予定変更では変更できません')
  if (!isCustomerId(patch.recipientId) || !isBillingDate(patch.scheduledDate)) throw new Error('請求先・請求予定日を確認してください')
  return { ...unit, ...patch, revision: unit.revision + 1 }
}

/** 明細は値コピー。監査用の契約スナップショットから再計算する入口を作らない。 */
export function issueInvoiceUnit(
  unit: BillingUnit, expectedRevision: number,
  input: { issuedOn: string; amount: number; lineItems: BillingLineItem[]; frozenAt: string },
): BillingUnit {
  if (unit.revision !== expectedRevision) throw new Error('情報が更新されています。確認し直してください')
  if (!isEditableInvoicePlan(unit)) throw new Error('この請求は発行できません')
  if (unit.recipientId == null || !isCustomerId(unit.recipientId)) throw new Error('請求先を確認してください')
  if (!isBillingDate(input.issuedOn) || !Number.isFinite(Date.parse(input.frozenAt))) throw new Error('発行日・確定日時を確認してください')
  if (!isYen(input.amount) || !input.lineItems.length || input.lineItems.some(i => !i.name.trim() || !isYen(i.amount))
    || input.lineItems.reduce((sum, i) => sum + i.amount, 0) !== input.amount) throw new Error('金額と明細合計が一致しません')
  return { ...unit, lifecycle: 'issued', issuedOn: input.issuedOn, frozenAt: input.frozenAt,
    frozenAmount: input.amount, frozenLineItems: input.lineItems.map(i => ({ ...i })), revision: unit.revision + 1 }
}

/** 将来の既定先と安定IDの例外。日付変更で例外の対象をずらさない。 */
export type RecipientPlan = {
  projectId: number
  defaultRecipientId: number
  overrides: Record<string, number>
}

export function recipientForUnit(unit: BillingUnit, plan: RecipientPlan): number | null {
  if (unit.projectId !== plan.projectId) throw new Error('別の発電所の請求先指定です')
  if (!isEditableInvoicePlan(unit)) return unit.recipientId
  return Object.hasOwn(plan.overrides, unit.id) ? plan.overrides[unit.id] : plan.defaultRecipientId
}

/** 確認済みID/版だけを更新。これは純粋関数でありDBの原子性・権限保証ではない。 */
export function applyInvoiceRecipientPlan(
  units: readonly BillingUnit[], plan: RecipientPlan, expected: Readonly<Record<string, number>>,
): BillingUnit[] {
  if (!isCustomerId(plan.defaultRecipientId) || Object.values(plan.overrides).some(id => !isCustomerId(id))) throw new Error('請求先を確認してください')
  const targets = units.filter(u => u.projectId === plan.projectId && isEditableInvoicePlan(u))
  if (new Set(units.map(u => u.id)).size !== units.length) throw new Error('請求回IDが重複しています')
  if (targets.length !== Object.keys(expected).length || targets.some(u => expected[u.id] !== u.revision)) throw new Error('請求予定が変わりました。確認し直してください')
  if (Object.keys(plan.overrides).some(id => !targets.some(u => u.id === id))) throw new Error('個別指定の対象回を確認してください')
  return units.map(unit => {
    if (unit.projectId !== plan.projectId || !isEditableInvoicePlan(unit)) return unit
    return { ...unit, recipientId: recipientForUnit(unit, plan), revision: unit.revision + 1 }
  })
}
