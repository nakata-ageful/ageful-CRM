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
