import type { BillingHistoryData } from './BillingHistorySection'
import { BillingHistorySection } from './BillingHistorySection'
import { buildBillingOverview } from '../lib/billing-overview'
import { fmtYen } from '../lib/utils'
import {buildBillingUnitCsv,downloadBillingUnitCsv} from '../lib/billing-unit-csv'
import type {ScheduleSetupIssue,ScheduleSetupItem} from '../lib/billing-cutover-coverage'

/** Read-only shared preview; caller supplies authorized units and a local calendar date. */
export function BillingOverviewPanel({data,today,onViewDetail,setupItems=[],setupIssues=[]}:{data:BillingHistoryData;today:string;onViewDetail?:(projectId:number)=>void;setupItems?:readonly ScheduleSetupItem[];setupIssues?:readonly ScheduleSetupIssue[]}) {
  const overview=buildBillingOverview(data.units,today)
  const noBillingCandidates=setupIssues.filter(issue=>issue.category==='no_billing_candidate')
  const actionRequired=setupIssues.filter(issue=>issue.category==='action_required')
  // A案: 未保存の候補は保存済みの回と区別して当月の予定に出す。
  // 同日の保存済み回がある候補・不一致候補は二重請求に見せず、下の要確認に残す。
  const nearTermCandidates=setupItems.filter(item=>item.method==='invoice'&&overview.months.includes(item.date.slice(0,7))
    &&(item.status==='missing'||item.status==='overdue')
    &&!overview.upcoming.some(unit=>unit.projectId===item.projectId&&unit.scheduledDate===item.date))
  const debitChecks=setupItems.filter(item=>item.method==='direct_debit')
  const movedItems=new Set<ScheduleSetupItem>([...nearTermCandidates,...debitChecks])
  const remainingItems=setupItems.filter(item=>!movedItems.has(item))
  return <section><h2>請求</h2>
    <button type="button" onClick={()=>downloadBillingUnitCsv(buildBillingUnitCsv(data.units,data.recipientName,data.projectName))}>各回の請求CSVをダウンロード</button><p>全期間の各回を出力します。予定額・確定額は別列で、保存されていない保守期間は要確認とします。</p>
    <p>未入金：{fmtYen(overview.totals.unpaidAmount)} ／ 入金済：{fmtYen(overview.totals.receivedAmount)}（今年度・昨年度）</p>
    {!!overview.totals.unknownActualCount&&<p role="status">金額要確認：{overview.totals.unknownActualCount}件。金額不明分は合計に含みません。</p>}
    <div><h3>今月・来月・再来月の請求予定（{overview.upcoming.length+nearTermCandidates.length}件）</h3>
      {!!overview.upcoming.length&&<BillingHistorySection data={{...data,units:overview.upcoming}} onViewDetail={onViewDetail} />}
      {!!nearTermCandidates.length&&<div className="card" style={{overflowX:'auto'}}><p>まだ保存していない予定候補です。日付・請求先・金額は発行前に確認してください。</p>
        <table><thead><tr><th>状態</th><th>発電所</th><th>現在の顧客（請求先未確定）</th><th>請求予定日</th><th>契約からの参考額（税込）</th><th>操作</th></tr></thead><tbody>{nearTermCandidates.map(item=><tr key={`${item.projectId}:${item.date}:${item.round}`}>
          <td>{item.status==='overdue'?'切替後の期限超過・要確認':item.date<today?'予定日経過・要確認':'未保存・要確認'}</td><td>{item.projectName}</td><td>{item.customerName}</td><td>{item.date}</td><td>{fmtYen(item.amount)}</td>
          <td>{onViewDetail&&<button type="button" className="btn" onClick={()=>onViewDetail(item.projectId)}>発電所詳細で確認</button>}</td>
        </tr>)}</tbody></table></div>}
      {!overview.upcoming.length&&!nearTermCandidates.length&&<p>この期間の請求書予定はありません。</p>}
    </div>
    {!!debitChecks.length&&<section className="card" style={{marginTop:20}}><h3>口座振替の結果を確認（{debitChecks.length}件）</h3>
      <p>銀行が振替を実行します。ここでは結果を確認するだけで、未保存は未払い・振替失敗を意味しません。</p>
      <div style={{overflowX:'auto'}}><table><thead><tr><th>発電所</th><th>現在の顧客</th><th>確認日</th><th>契約からの参考額（税込）</th><th>操作</th></tr></thead><tbody>{debitChecks.map(item=><tr key={`${item.projectId}:${item.date}:${item.round}`}>
        <td>{item.projectName}</td><td>{item.customerName}</td><td>{item.date}</td><td>{fmtYen(item.amount)}</td>
        <td>{onViewDetail&&<button type="button" className="btn" onClick={()=>onViewDetail(item.projectId)}>発電所詳細で確認</button>}</td>
      </tr>)}</tbody></table></div>
    </section>}
    {([['未入金',overview.unpaid],['入金済',overview.received]] as const).map(([label,units])=>
      <div key={label}><h3>{label}（{units.length}件）</h3><BillingHistorySection data={{...data,units}} onViewDetail={onViewDetail} /></div>)}
    <p>表示期間より前の予定：{overview.overduePlans.length}件 ／ 日付要確認：{overview.undatedPlans.length}件 ／ それ以降の予定：{overview.laterPlans.length}件</p>
    <p>振替予定：{overview.debitPlans.length}件 ／ 記録要確認：{overview.review.length}件</p>
    {([['表示期間より前の予定',overview.overduePlans],['日付要確認',overview.undatedPlans],['それ以降の予定',overview.laterPlans],
      ['振替予定',overview.debitPlans],['記録要確認',overview.review]] as const).filter(([,units])=>units.length).map(([label,units])=>
      <details key={label}><summary>{label}（{units.length}件）を確認</summary><BillingHistorySection data={{...data,units}} onViewDetail={onViewDetail}/></details>)}
    {!!remainingItems.length&&<section className="card" style={{marginTop:20}}><h3>未保存・要確認の請求予定（{remainingItems.length}件）</h3>
      <p>現在の契約の「請求予定日」から表示しています。「未保存」は新しい請求回としてまだ保存していません。「期限超過・要確認」は切替後の未保存候補で、請求済みかどうか確認が必要です。「保存内容を確認」は同日の記録と現在の予定が一致していません。どれも自動発行しません。</p>
      <div style={{overflowX:'auto'}}><table><thead><tr><th>状態</th><th>発電所</th><th>現在の顧客</th><th>請求予定日</th><th>請求方法</th><th>契約からの参考額（税込）</th><th>操作</th></tr></thead><tbody>{remainingItems.map(item=><tr key={`${item.projectId}:${item.date}:${item.round}:${item.method}`}>
        <td>{item.status==='review'?<><strong>保存内容を確認</strong><br/><small>{item.reason}</small></>:item.status==='overdue'?<><strong>期限超過・要確認</strong><br/><small>{item.reason}</small></>:'未保存'}</td><td>{item.projectName}</td><td>{item.customerName}</td><td>{item.date}</td><td>{item.method==='invoice'?'請求書':'口座振替'}</td><td>{fmtYen(item.amount)}</td>
        <td>{onViewDetail&&<button type="button" className="btn" onClick={()=>onViewDetail(item.projectId)}>発電所詳細で設定</button>}</td></tr>)}</tbody></table></div>
    </section>}
    {!!setupIssues.length&&<section className="card billing-setup-review" style={{marginTop:20}}><h3>請求設定要確認（{setupIssues.length}件）</h3>
      <p>勝手に請求方法・金額・契約を決めず、未設定のまま表示しています。公開後に順次確認できます。</p>
      {!!actionRequired.length&&<details open><summary><strong>請求設定が必要（{actionRequired.length}件）</strong></summary>
        <p>金額がある、予定日がない、または契約が複数の発電所です。請求前に設定してください。</p><ul>{actionRequired.map(issue=><li key={`${issue.projectId}:${issue.code}`}>
          <span><strong>{issue.projectName}</strong><br/>{issue.reason}</span>{onViewDetail&&<button type="button" className="btn" onClick={()=>onViewDetail(issue.projectId)}>発電所詳細で確認</button>}</li>)}</ul>
      </details>}
      {!!noBillingCandidates.length&&<details><summary><strong>自社請求なし候補（{noBillingCandidates.length}件・未確定）</strong></summary>
        <p>他社保守などの可能性があります。「請求なし」と自動確定せず、発電所ごとに確認します。</p><ul>{noBillingCandidates.map(issue=><li key={`${issue.projectId}:${issue.code}`}>
          <span><strong>{issue.projectName}</strong><br/>{issue.reason}</span>{onViewDetail&&<button type="button" className="btn" onClick={()=>onViewDetail(issue.projectId)}>発電所詳細で確認</button>}</li>)}</ul>
      </details>}
    </section>}
  </section>
}
