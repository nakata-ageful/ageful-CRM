import type { Contract } from '../types'

/**
 * 請求計算の共通ロジック。
 * 年間総額 = 保守内容の金額項目のうち「請求に含める」項目（billing_item_flags）の合計。
 * 各回の金額 = 年間総額の均等割（billing_amount_overrides で回/月ごとに上書き可）+ 手数料。
 */

/** 請求計算の対象になりうる金額項目（保守内容セクションの項目と対応） */
export const BILLING_ITEMS = [
  { key: 'annual_maintenance', label: '年次保守料', field: 'annual_maintenance_inc' },
  { key: 'land_cost',          label: '土地賃料',   field: 'land_cost_monthly' },
  { key: 'insurance',          label: '火災保険料', field: 'insurance_fee' },
  { key: 'local_association',  label: '自治会費',   field: 'local_association_fee' },
  { key: 'communication',      label: '通信費',     field: 'communication_fee' },
  { key: 'other',              label: 'その他費用', field: 'other_fee' },
] as const

export type BillingItemKey = typeof BILLING_ITEMS[number]['key']

type AmountFields = Pick<Contract,
  'annual_maintenance_inc' | 'land_cost_monthly' | 'insurance_fee' |
  'local_association_fee' | 'communication_fee' | 'other_fee' | 'billing_item_flags'>

/** 項目が請求計算に含まれるか（フラグ未設定は「含める」扱い＝後方互換） */
export function isItemBillable(c: AmountFields | null | undefined, key: BillingItemKey): boolean {
  return c?.billing_item_flags?.[key] !== false
}

/** 年間総額（税込）: 「請求に含める」項目のみの合計 */
export function annualBillableTotalInc(c: AmountFields | null | undefined): number {
  if (!c) return 0
  return BILLING_ITEMS.reduce((sum, item) =>
    sum + (isItemBillable(c, item.key) ? (c[item.field] ?? 0) : 0), 0)
}

/** 1回 / 1ヶ月 あたりの基本金額（上書き考慮、手数料なし） */
export function baseAmountForKey(c: Contract | null | undefined, key: string, divisor: number): number {
  if (!c || divisor === 0) return 0
  const over = c.billing_amount_overrides?.[key]
  if (over != null) return over
  return Math.floor(annualBillableTotalInc(c) / divisor)
}

/** 請求書1回あたりの金額（手数料込み） */
export function invoiceAmount(c: Contract | null | undefined, round: number, totalRounds: number): number {
  const base = baseAmountForKey(c, String(round), totalRounds)
  const fee = (c?.has_issuance_fee && c?.issuance_fee_inc != null) ? c.issuance_fee_inc : 0
  return base + fee
}

/** 口座振替1ヶ月あたりの金額（手数料込み） */
export function withdrawalAmount(c: Contract | null | undefined, month: number): number {
  const base = baseAmountForKey(c, String(month), 12)
  const fee = (c?.has_transfer_fee && c?.transfer_fee_inc != null) ? c.transfer_fee_inc : 0
  return base + fee
}
