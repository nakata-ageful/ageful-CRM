import {useState} from 'react'
import type {BillingUnit} from '../lib/billing-unit'
import {maintenancePeriodLabel} from '../lib/maintenance-period-label'
import {SavedMaintenancePeriodEditor} from './SavedMaintenancePeriodEditor'
import type {SavedMaintenancePeriodChange} from '../lib/saved-maintenance-period'

/** Display the stored service year separately from invoice/payment dates.
 * A date outside the annual period is not evidence of a missing/duplicate invoice.
 * This view does not infer a round for legacy single records or mutate their identity.
 */
export function MaintenancePeriodReview({startDate,units,onSave}:{startDate:string|null;units:readonly BillingUnit[];onSave?:(change:SavedMaintenancePeriodChange)=>Promise<unknown>}){
 const [editingYear,setEditingYear]=useState<number|null>(null)
 const years=[...new Set(units.map(u=>u.serviceYear))].sort((a,b)=>b-a)
 return <details><summary>保守期間ごとの保存記録を確認</summary>
  <p>通常の保守期間は、保守開始日から翌年の前日までの1年間です。請求予定日・請求日・入金日は別に管理するため、次の期間の分を前年12月に請求することもできます。</p>
  <p>期間未保存の記録は、保守開始日と記録年からの参考表示です。前払い等があるため、請求日から対象期間を自動変更しません。</p>
  {!years.length&&<p>保存記録はありません。</p>}
  {years.map(year=>{const group=units.filter(u=>u.serviceYear===year),first=group[0];const same=first.periodStart&&first.periodEnd&&group.every(u=>u.periodStart===first.periodStart&&u.periodEnd===first.periodEnd);return <section key={year} style={{marginBottom:14}}><h4>{same?`保守期間：${first.periodStart} ～ ${first.periodEnd}`:maintenancePeriodLabel(startDate,year)}</h4>
   {!same&&<p>{group.some(u=>u.periodStart||u.periodEnd)?'各回の期間が未設定または異なっています。下の保存内容を確認してください。':'参考表示・保守期間はまだ保存されていません。'}</p>}
   {units.filter(u=>u.serviceYear===year).map(u=><div key={u.id} style={{padding:8,borderBottom:'1px solid #ddd'}}>
    <strong>{u.roundLabel==='保存済み単回記録'?'回数未登録の記録':u.roundLabel}</strong>
    <span> ／ {u.lifecycle==='cancelled'?'取りやめ':u.receivedOn?'入金済み':u.issuedOn?'発行済み':'保存済みの予定'}</span>
    <div>請求予定日：{u.scheduledDate??'未登録'} ／ 請求日：{u.issuedOn??'未登録'} ／ 入金日：{u.receivedOn??'未登録'}</div>
    <div>金額：{(u.frozenAmount??u.plannedAmount)==null?'未登録':`${(u.frozenAmount??u.plannedAmount)!.toLocaleString()}円`}</div>
    {u.periodStart&&u.periodEnd&&<div>この回に指定した対象期間：{u.periodStart} ～ {u.periodEnd}</div>}
   </div>)}
   {onSave&&<button type="button" className="btn" onClick={()=>setEditingYear(year)}>この期間の保存記録を修正</button>}
   {onSave&&editingYear===year&&<SavedMaintenancePeriodEditor key={`${year}:${startDate}:${units.map(u=>`${u.id}:${u.revision}`).join(',')}`} startDate={startDate} year={year} units={units} onSave={onSave} onClose={()=>setEditingYear(null)}/>}
  </section>})}
 </details>
}
