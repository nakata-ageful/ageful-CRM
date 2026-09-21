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
    <thead><tr>{['保守期間・回', '請求先', '方法', '予定日', '発行・振替日', '入金日', '金額（税込）', '状態'].map(label => <th key={label}>{label}</th>)}</tr></thead>
    <tbody>{units.map(unit => {
      const amount = resolveUnitAmount(unit, () => plannedAmount(unit))
      const status = billingUnitStatusLabel(unit)
      return <tr key={unit.id}>
        <td><strong>{unit.periodStart&&unit.periodEnd?`${unit.periodStart} ～ ${unit.periodEnd}`:`${unit.serviceYear}年（保守期間未確認）`}</strong><small>{unit.roundLabel}</small></td>
        <td>{unit.recipientId == null ? <span className="billing-unit-warning">請求先要確認</span> : recipientName(unit.recipientId)}</td>
        <td>{unit.method}</td><td>{unit.scheduledDate ?? '日付要確認'}</td><td>{unit.issuedOn??'—'}</td><td>{unit.receivedOn??'—'}</td>
        <td>{amount.amount == null ? '金額要確認' : fmtYen(amount.amount)}<small style={{ display: 'block', color: '#64748b' }}>{amount.basis}</small></td>
        <td><span className={`billing-unit-status billing-unit-status-${unit.lifecycle}`}>{status}</span></td>
      </tr>
    })}</tbody>
  </table></div>
}
