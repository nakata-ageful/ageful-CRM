/** ¥ 付き金額フォーマット（null/undefined → '—'） */
export function fmtYen(v: number | null | undefined): string {
  if (v == null) return '—'
  return `¥${v.toLocaleString('ja-JP')}`
}

/** 数値フォーマット（¥なし、null/undefined → '—'） */
export function fmtNum(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toLocaleString('ja-JP')
}

/** 日付フォーマット YYYY-MM-DD → YYYY年M月D日（null/undefined → '—'） */
export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—'
  const d = new Date(v + 'T00:00:00')
  if (isNaN(d.getTime())) return v
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/**
 * 日付入力 (input type="date") の選択範囲。過去4年〜来年。
 * 年が進むと自動でスライド。
 * 使い方: <input type="date" {...dateInputRange()} ... />
 */
export function dateInputRange(): { min: string; max: string } {
  const yr = new Date().getFullYear()
  return {
    min: `${yr - 4}-01-01`,
    max: `${yr + 1}-12-31`,
  }
}
