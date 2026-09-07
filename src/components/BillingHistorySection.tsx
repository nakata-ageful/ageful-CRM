import type { BillingUnit } from '../lib/billing-unit'
import { customerBillingHistory, summarizeBillingHistory } from '../lib/billing-history'
import { BillingUnitTable } from './BillingUnitTable'
import { fmtYen } from '../lib/utils'

export type BillingHistoryData = {
  units: readonly BillingUnit[]
  recipientName: (id: number) => string
  projectName: (id: number) => string
  plannedAmount: (unit: BillingUnit) => number | null
}

export function BillingHistorySection({ data, customerId, projectId }: {
  data: BillingHistoryData; customerId?: number; projectId?: number
}) {
  const selected = customerId == null ? [...data.units] : customerBillingHistory(data.units, customerId)
  const units = projectId == null ? selected : selected.filter(u => u.projectId === projectId)
  const total = summarizeBillingHistory(units)
  return <section className="card" style={{ marginTop: 20 }}>
    <h3>請求履歴</h3>
    <p>各回に保存された請求先を表示しています。所有者変更前の請求も残ります。</p>
    <p>入金済：{fmtYen(total.receivedAmount)} ／ 未入金：{fmtYen(total.unpaidAmount)} ／ 予定：{total.plannedCount}件</p>
    {!!(total.unknownActualCount + total.reviewCount) && <p role="status">金額・記録要確認：{total.unknownActualCount + total.reviewCount}件（確認できない金額は合計に含みません）</p>}
    {!units.length && <p className="empty-cell">この請求先の記録はありません</p>}
    {[...new Set(units.map(u => u.projectId))].map(id => <div key={id}>
      <h4>{data.projectName(id)}</h4>
      <BillingUnitTable units={units.filter(u => u.projectId === id)} recipientName={data.recipientName} plannedAmount={data.plannedAmount} />
    </div>)}
  </section>
}
