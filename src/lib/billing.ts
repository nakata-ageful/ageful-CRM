import type { Contract, BillingRow, AnnualRecord, PaymentEntry } from '../types'

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

// ── 日付ヘルパー（請求予定日文字列 ⇔ ISO日付） ──────────────────────────

/** 「1月15日」「15日」から月日抽出 */
export function parseScheduleDay(day: string): { month: number | null; day: number | null } {
  const m = day.match(/(\d{1,2})月/)?.[1]
  const d = day.match(/(\d{1,2})日/)?.[1]
  return { month: m ? Number(m) : null, day: d ? Number(d) : null }
}

/** 「X月Y日」「Y日」を YYYY-MM-DD に変換（monthDefault は 口座振替の引落日に使う） */
export function toIsoDate(year: number, dayStr: string, monthDefault?: number): string | null {
  const { month, day } = parseScheduleDay(dayStr)
  const m = month ?? monthDefault
  if (m == null || day == null) return null
  return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// ── 未入金の共通判定（請求タブ・ダッシュボードで共有） ──────────────────

/**
 * 未入金の1単位。分割入金は回（payment）ごと、単回は記録全体で1単位。
 * 対象年度は「今年度＋昨年度」（過去1年）。請求タブの未入金一覧と同じ基準。
 */
export type UnpaidUnit = { row: BillingRow; record: AnnualRecord; payment?: PaymentEntry; totalRounds?: number }

export function computeUnpaidUnits(rows: BillingRow[], currentYear: number): UnpaidUnit[] {
  const inScope = (rec: AnnualRecord) => rec.year >= currentYear - 1
  return rows.flatMap(r =>
    r.records.filter(inScope).flatMap((rec): UnpaidUnit[] => {
      if (rec.payments?.length) {
        return rec.payments
          .filter(p => !p.received_date && p.billing_date)
          .map(p => ({ row: r, record: rec, payment: p, totalRounds: rec.payments!.length }))
      }
      if (!rec.received_date && (rec.billing_date || rec.transfer_failed)) return [{ row: r, record: rec }]
      return []
    })
  )
}

// ── 請求予定の共通判定（請求タブ・ダッシュボードで共有） ──────────────

export type UpcomingItem = {
  row: BillingRow
  round: number
  totalRounds: number
  scheduledDateISO: string  // YYYY-MM-DD
  scheduleDayLabel: string  // 例: "1月15日"
  amount: number
}

/**
 * 請求予定（請求書のみ）: 契約の請求予定日のうち、指定した月ウィンドウ（既定=今月・来月・再来月）
 * に来る回で、まだ発行されていないものを返す。請求タブとダッシュボードで共有する。
 * @param monthWindow 対象月→年 のマップ。省略時は today を基準に3ヶ月分を生成
 */
export function computeUpcomingInvoices(
  rows: BillingRow[],
  monthWindow?: Map<number, number>,
): UpcomingItem[] {
  const window = monthWindow ?? (() => {
    const today = new Date()
    const cy = today.getFullYear()
    const cm = today.getMonth() + 1
    return new Map(Array.from({ length: 3 }, (_, i) => {
      const raw = cm - 1 + i
      return [(raw % 12) + 1, cy + Math.floor(raw / 12)] as [number, number]
    }))
  })()

  return rows.flatMap(r => {
    const c = r.contract
    if (c?.billing_method !== '請求書') return []
    const days = c?.billing_schedule_days ?? []
    const totalRounds = days.length
    if (totalRounds === 0) return []

    const candidates = days
      .map((day, i) => ({ day, round: i + 1, month: parseScheduleDay(day).month }))
      .filter(cd => cd.month != null && window.has(cd.month))
      .map(cd => {
        const year = window.get(cd.month!)!
        return { ...cd, year, iso: toIsoDate(year, cd.day) }
      })
      .filter(cd => cd.iso != null) as { day: string; round: number; year: number; iso: string }[]
    if (candidates.length === 0) return []

    // 予定日未設定のまま請求/入金/振替失敗が入った記録（CSV等由来）は、その年の請求が済んだ分として回を消費する
    const floatingByYear: Record<number, number> = {}
    for (const rec of r.records) {
      if (rec.payments?.length) continue
      const handled = rec.billing_date || rec.received_date || rec.transfer_failed
      if (!handled) continue
      const tied = days.some(d => toIsoDate(rec.year, d) === rec.billing_scheduled_date)
      if (tied) continue
      floatingByYear[rec.year] = (floatingByYear[rec.year] ?? 0) + 1
    }

    const results: UpcomingItem[] = []
    candidates.sort((a, b) => a.iso.localeCompare(b.iso))
    for (const cand of candidates) {
      if (r.records.some(rec => rec.billing_scheduled_date === cand.iso || rec.payments?.some(p => p.scheduled_date === cand.iso))) continue
      if ((floatingByYear[cand.year] ?? 0) > 0) { floatingByYear[cand.year]--; continue }
      results.push({
        row: r,
        round: cand.round,
        totalRounds,
        scheduledDateISO: cand.iso,
        scheduleDayLabel: cand.day,
        amount: invoiceAmount(c, cand.round, totalRounds),
      })
    }
    return results
  }).sort((a, b) => a.scheduledDateISO.localeCompare(b.scheduledDateISO))
}

/** 未入金1単位の金額（税込）。請求タブの未入金一覧と同じ算出。 */
export function unpaidUnitAmount(u: UnpaidUnit): number | null {
  const c = u.row.contract
  if (u.payment && u.totalRounds) return invoiceAmount(c, u.payment.seq, u.totalRounds)
  if (u.record.transfer_failed && u.record.billing_scheduled_date) {
    return withdrawalAmount(c, Number(u.record.billing_scheduled_date.slice(5, 7)))
  }
  if (u.record.line_items) return u.record.line_items.reduce((s, i) => s + i.amount, 0)
  if (u.record.billing_scheduled_date && c?.billing_method === '請求書') {
    const days = c?.billing_schedule_days ?? []
    const idx = days.findIndex(d => toIsoDate(u.record.year, d) === u.record.billing_scheduled_date)
    if (idx >= 0) return invoiceAmount(c, idx + 1, days.length)
  }
  return null
}
