import type { BillingHistoryData } from './BillingHistorySection'
import { BillingHistorySection } from './BillingHistorySection'
import { buildBillingOverview } from '../lib/billing-overview'
import { fmtYen } from '../lib/utils'
import {buildBillingUnitCsv,downloadBillingUnitCsv} from '../lib/billing-unit-csv'
import type {ScheduleSetupIssue,ScheduleSetupItem} from '../lib/billing-cutover-coverage'

/** Read-only shared preview; caller supplies authorized units and a local calendar date. */
export function BillingOverviewPanel({data,today,onViewDetail,setupItems=[],setupIssues=[]}:{data:BillingHistoryData;today:string;onViewDetail?:(projectId:number)=>void;setupItems?:readonly ScheduleSetupItem[];setupIssues?:readonly ScheduleSetupIssue[]}) {
  const overview=buildBillingOverview(data.units,today)
  return <section><h2>請求</h2>
    <button type="button" onClick={()=>downloadBillingUnitCsv(buildBillingUnitCsv(data.units,data.recipientName,data.projectName))}>各回の請求CSVをダウンロード</button><p>全期間の各回を出力します。予定額・確定額は別列で、保存されていない保守期間は要確認とします。</p>
    <p>未入金：{fmtYen(overview.totals.unpaidAmount)} ／ 入金済：{fmtYen(overview.totals.receivedAmount)}（今年度・昨年度）</p>
    {!!overview.totals.unknownActualCount&&<p role="status">金額要確認：{overview.totals.unknownActualCount}件。金額不明分は合計に含みません。</p>}
    {([['今月・来月・再来月の請求予定',overview.upcoming],['未入金',overview.unpaid],['入金済',overview.received]] as const).map(([label,units])=>
      <div key={label}><h3>{label}（{units.length}件）</h3><BillingHistorySection data={{...data,units}} onViewDetail={onViewDetail} /></div>)}
    <p>表示期間より前の予定：{overview.overduePlans.length}件 ／ 日付要確認：{overview.undatedPlans.length}件 ／ それ以降の予定：{overview.laterPlans.length}件</p>
    <p>振替予定：{overview.debitPlans.length}件 ／ 記録要確認：{overview.review.length}件</p>
    {([['表示期間より前の予定',overview.overduePlans],['日付要確認',overview.undatedPlans],['それ以降の予定',overview.laterPlans],
      ['振替予定',overview.debitPlans],['記録要確認',overview.review]] as const).filter(([,units])=>units.length).map(([label,units])=>
      <details key={label}><summary>{label}（{units.length}件）を確認</summary><BillingHistorySection data={{...data,units}} onViewDetail={onViewDetail}/></details>)}
    {!!setupItems.length&&<section className="card" style={{marginTop:20}}><h3>設定待ちの請求予定（{setupItems.length}件）</h3>
      <p>現在の契約の「請求予定日」から表示しています。新しい請求回としてはまだ保存していません。請求先・保守期間を確認し、発電所詳細から予定を追加してください。</p>
      <div style={{overflowX:'auto'}}><table><thead><tr><th>発電所</th><th>現在の顧客</th><th>請求予定日</th><th>請求方法</th><th>予定額（税込）</th><th>操作</th></tr></thead><tbody>{setupItems.map(item=><tr key={`${item.projectId}:${item.date}:${item.round}:${item.method}`}>
        <td>{item.projectName}</td><td>{item.customerName}</td><td>{item.date}</td><td>{item.method==='invoice'?'請求書':'口座振替'}</td><td>{fmtYen(item.amount)}</td>
        <td>{onViewDetail&&<button type="button" className="btn" onClick={()=>onViewDetail(item.projectId)}>発電所詳細で設定</button>}</td></tr>)}</tbody></table></div>
    </section>}
    {!!setupIssues.length&&<section className="card" style={{marginTop:20}}><h3>請求設定要確認（{setupIssues.length}件）</h3>
      <p>推測で契約を選ばず、請求予定を作らずに残しています。</p><ul>{setupIssues.map(issue=><li key={`${issue.projectId}:${issue.reason}`}>
        {issue.projectName}：{issue.reason} {onViewDetail&&<button type="button" className="btn" onClick={()=>onViewDetail(issue.projectId)}>発電所詳細を開く</button>}</li>)}</ul>
    </section>}
  </section>
}
