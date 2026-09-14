/** Display-only annual anniversary range. Never changes billing dates or stored periods. */
export function maintenancePeriodLabel(startDate: string | null | undefined, year: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate ?? '')
  if (!match) return `保守開始日未設定（記録年：${year}）`
  const [, originalYear, monthText, dayText] = match
  const month = Number(monthText), day = Number(dayText)
  const original = new Date(Date.UTC(Number(originalYear), month - 1, day))
  if (original.getUTCFullYear() !== Number(originalYear) || original.getUTCMonth() !== month - 1 || original.getUTCDate() !== day
    || !Number.isInteger(year) || year < 1000 || year > 9998) return `保守期間要確認（記録年：${year}）`
  // Feb 29 anniversaries use Feb 28 in non-leap years; consecutive periods do not overlap.
  const anniversary = (y: number) => new Date(Date.UTC(y, month - 1, Math.min(day, new Date(Date.UTC(y, month, 0)).getUTCDate())))
  const from = anniversary(year), until = anniversary(year + 1)
  until.setUTCDate(until.getUTCDate() - 1)
  return `保守期間：${from.toISOString().slice(0, 10)} ～ ${until.toISOString().slice(0, 10)}`
}
