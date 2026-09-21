import type { BillingUnit } from '../lib/billing-unit'
import { customerBillingHistory, summarizeBillingHistory } from '../lib/billing-history'
import { BillingUnitTable } from './BillingUnitTable'
import { fmtYen } from '../lib/utils'

export type BillingHistoryData = {
  units: readonly BillingUnit[]
  recipientName: (id: number) => string
  projectName: (id: number) => string
  plannedAmount: (unit: BillingUnit) => number | null
  recipients?: readonly {id:number;name:string}[]
}

export function BillingHistorySection({ data, customerId, projectId, onViewDetail }: {
  data: BillingHistoryData; customerId?: number; projectId?: number; onViewDetail?: (projectId:number)=>void
}) {
  const selected = customerId == null ? [...data.units] : customerBillingHistory(data.units, customerId)
  const units = projectId == null ? selected : selected.filter(u => u.projectId === projectId)
  const total = summarizeBillingHistory(units)
  return <section className="card billing-history-card">
    <div className="billing-history-heading"><div><span className="billing-history-kicker">各回ごとの記録</span><h3>請求履歴</h3><p>各回に保存された請求先を表示します。所有者変更前の請求も残ります。</p></div><span className="billing-history-count">{units.length}件</span></div>
    <div className="billing-history-summary"><div><span>入金済</span><strong>{fmtYen(total.receivedAmount)}</strong></div><div><span>未入金</span><strong>{fmtYen(total.unpaidAmount)}</strong></div><div><span>今後の予定</span><strong>{total.plannedCount}件</strong></div><div className={(total.unknownActualCount+total.reviewCount)?'attention':''}><span>要確認</span><strong>{total.unknownActualCount + total.reviewCount}件</strong></div></div>
    {!!(total.unknownActualCount + total.reviewCount) && <p className="billing-history-alert" role="status">確認できない金額は合計に含めていません。</p>}
    {!units.length && <p className="empty-cell">この請求先の記録はありません</p>}
    {[...new Set(units.map(u => u.projectId))].map(id => <div key={id}>
      <div className="billing-history-project"><h4>{data.projectName(id)}</h4>
      {onViewDetail && <button type="button" className="btn" onClick={()=>onViewDetail(id)} aria-label={`${data.projectName(id)}の請求詳細を開く`}>請求詳細を開く</button>}
      </div>
      <BillingUnitTable units={units.filter(u => u.projectId === id)} recipientName={data.recipientName} plannedAmount={data.plannedAmount} />
    </div>)}
  </section>
}
