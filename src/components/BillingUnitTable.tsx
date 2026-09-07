import type { BillingUnit } from '../lib/billing-unit'
import { resolveUnitAmount, billingUnitStatusLabel } from '../lib/billing-unit'
import { fmtYen } from '../lib/utils'

type Props = {
  units: readonly BillingUnit[]
  recipientName: (id: number) => string
  plannedAmount: (unit: BillingUnit) => number | null
}

/** 回別データを受け取る表示部品。現所有者による請求先の補完はしない。 */
export function BillingUnitTable({ units, recipientName, plannedAmount }: Props) {
  return <div style={{ overflowX: 'auto' }}><table className="data-table" style={{ width: '100%', whiteSpace: 'nowrap' }}>
    <thead><tr>{['対象', '請求予定日', '請求先', '金額（税込）', '状態'].map(label => <th key={label}>{label}</th>)}</tr></thead>
    <tbody>{units.map(unit => {
      const amount = resolveUnitAmount(unit, () => plannedAmount(unit))
      const status = billingUnitStatusLabel(unit)
      return <tr key={unit.id}>
        <td>{unit.serviceYear}年 {unit.roundLabel}</td><td>{unit.scheduledDate ?? '日付要確認'}</td>
        <td>{unit.recipientId == null ? '請求先要確認' : recipientName(unit.recipientId)}</td>
        <td>{amount.amount == null ? '金額要確認' : fmtYen(amount.amount)}<small style={{ display: 'block', color: '#64748b' }}>{amount.basis}</small></td>
        <td>{status}</td>
      </tr>
    })}</tbody>
  </table></div>
}
