import type {TransferBillingUnit} from '../lib/ownership-billing-plan'
import {maintenancePeriodLabel} from '../lib/maintenance-period-label'

/** Display the stored service year separately from invoice/payment dates.
 * A date outside the annual period is not evidence of a missing/duplicate invoice.
 * This view does not infer a round for legacy single records or mutate their identity.
 */
export function MaintenancePeriodReview({startDate,units}:{startDate:string|null;units:readonly TransferBillingUnit[]}){
 const years=[...new Set(units.map(u=>u.serviceYear))].sort((a,b)=>b-a)
 return <details><summary>保守期間ごとの保存記録を確認</summary>
  <p>保守開始日と保存された記録年から表示しています。請求日・入金日が期間外でも、前払い等があるため別の保守期間へ移しません。回数が未登録の記録は、そのまま表示します。</p>
  {!years.length&&<p>保存記録はありません。</p>}
  {years.map(year=><section key={year} style={{marginBottom:14}}><h4>{maintenancePeriodLabel(startDate,year)}</h4>
   {units.filter(u=>u.serviceYear===year).map(u=><div key={u.id} style={{padding:8,borderBottom:'1px solid #ddd'}}>
    <strong>{u.roundLabel==='保存済み単回記録'?'回数未登録の記録':u.roundLabel}</strong>
    <span> ／ {u.lifecycle==='cancelled'?'取りやめ':u.receivedOn?'入金済み':u.issuedOn?'発行済み':'保存済みの予定'}</span>
    <div>請求予定日：{u.scheduledDate??'未登録'} ／ 請求日：{u.issuedOn??'未登録'} ／ 入金日：{u.receivedOn??'未登録'}</div>
    <div>金額：{(u.frozenAmount??u.plannedAmount)==null?'未登録':`${(u.frozenAmount??u.plannedAmount)!.toLocaleString()}円`}</div>
    {u.periodStart&&u.periodEnd&&<div>この回に指定した対象期間：{u.periodStart} ～ {u.periodEnd}</div>}
   </div>)}
  </section>)}
 </details>
}
