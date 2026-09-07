import type { BillingHistoryData } from './BillingHistorySection'
import { BillingHistorySection } from './BillingHistorySection'
import { buildBillingOverview } from '../lib/billing-overview'
import { fmtYen } from '../lib/utils'

/** Read-only shared preview; caller supplies authorized units and a local calendar date. */
export function BillingOverviewPanel({data,today,onViewDetail}:{data:BillingHistoryData;today:string;onViewDetail?:(projectId:number)=>void}) {
  const overview=buildBillingOverview(data.units,today)
  return <section><h2>請求</h2>
    <p>未入金：{fmtYen(overview.totals.unpaidAmount)} ／ 入金済：{fmtYen(overview.totals.receivedAmount)}（今年度・昨年度）</p>
    {!!overview.totals.unknownActualCount&&<p role="status">金額要確認：{overview.totals.unknownActualCount}件。金額不明分は合計に含みません。</p>}
    {([['今月・来月・再来月の請求予定',overview.upcoming],['未入金',overview.unpaid],['入金済',overview.received]] as const).map(([label,units])=>
      <div key={label}><h3>{label}（{units.length}件）</h3><BillingHistorySection data={{...data,units}} onViewDetail={onViewDetail} /></div>)}
    <p>表示期間より前の予定：{overview.overduePlans.length}件 ／ 日付要確認：{overview.undatedPlans.length}件 ／ それ以降の予定：{overview.laterPlans.length}件</p>
    <p>振替予定：{overview.debitPlans.length}件 ／ 記録要確認：{overview.review.length}件</p>
    {([['表示期間より前の予定',overview.overduePlans],['日付要確認',overview.undatedPlans],['それ以降の予定',overview.laterPlans],
      ['振替予定',overview.debitPlans],['記録要確認',overview.review]] as const).filter(([,units])=>units.length).map(([label,units])=>
      <details key={label}><summary>{label}（{units.length}件）を確認</summary><BillingHistorySection data={{...data,units}} onViewDetail={onViewDetail}/></details>)}
  </section>
}
