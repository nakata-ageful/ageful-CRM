import {useState} from 'react'
import type {BillingUnit} from '../lib/billing-unit'
import {isBillingDate} from '../lib/billing-unit'
import {maintenancePeriod} from '../lib/maintenance-period-label'
import {savedMaintenancePeriodChange,type SavedMaintenancePeriodChange} from '../lib/saved-maintenance-period'

export function SavedMaintenancePeriodEditor({startDate,year,units,onSave,onClose}:{startDate:string|null;year:number;units:readonly BillingUnit[];onSave:(change:SavedMaintenancePeriodChange)=>Promise<unknown>;onClose:()=>void}){
 const group=units.filter(u=>u.serviceYear===year),first=group[0]
 const defaultPeriod=()=>{try{return maintenancePeriod(startDate,year)}catch{return {periodStart:'',periodEnd:''}}}
 const stored=first?.periodStart&&first.periodEnd&&group.every(u=>u.periodStart===first.periodStart&&u.periodEnd===first.periodEnd)
 const [period,setPeriod]=useState(()=>stored?{periodStart:first.periodStart!,periodEnd:first.periodEnd!}:defaultPeriod())
 const [reason,setReason]=useState(''),[review,setReview]=useState<SavedMaintenancePeriodChange|null>(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false)
 function changeStart(value:string){setReview(null);setNotice('');setPeriod(previous=>{try{return isBillingDate(value)?maintenancePeriod(value,Number(value.slice(0,4))):{...previous,periodStart:value}}catch{return {...previous,periodStart:value}}})}
 function confirm(){try{setReview(savedMaintenancePeriodChange(first.projectId,year,period,reason,units,startDate));setNotice('')}catch(e){setReview(null);setNotice(e instanceof Error?e.message:String(e))}}
 async function save(){if(!review||busy)return;setBusy(true);try{await onSave(review);onClose()}catch(e){setNotice(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 return <div className="card" style={{padding:16,marginTop:12}}>
  <h4>保存済み記録の保守期間を修正</h4>
  <p>この期間の{group.length}件すべてを修正します。請求先・金額・請求予定日・請求日・入金日は変更しません。</p>
  <fieldset disabled={busy} style={{border:0,padding:0}}>
   <button type="button" onClick={()=>{setPeriod(defaultPeriod());setReview(null);setNotice('')}}>保守開始日から1年間を入力</button>
   <div><label>保守期間の開始日 <input type="date" min={`${year}-01-01`} max={`${year}-12-31`} value={period.periodStart} onChange={e=>changeStart(e.target.value)}/></label>{' '}
    <label>保守期間の終了日 <input type="date" max="2200-12-31" value={period.periodEnd} onChange={e=>{setPeriod({...period,periodEnd:e.target.value});setReview(null);setNotice('')}}/></label></div>
   <p>開始日を変えると、終了日は翌年の前日になります。例外の期間は終了日も変更できます。開始年は保存記録の{year}年のままです。別の開始年への付け替えは、この操作では行いません。</p>
   <label>修正理由 <input className="form-input" value={reason} onChange={e=>{setReason(e.target.value);setReview(null);setNotice('')}} placeholder="例：備考と契約を確認し、保守開始日から1年間に修正"/></label>
   <div style={{marginTop:12}}><button type="button" className="btn" onClick={confirm}>修正内容を確認</button>{' '}<button type="button" className="btn" onClick={onClose}>キャンセル</button></div>
   {review&&<div role="status" style={{marginTop:12}}><p>修正後：{review.periodStart} ～ {review.periodEnd} ／ {group.length}件<br/>理由：{review.reason}<br/>請求・入金の記録はそのまま残り、期間の変更履歴を保存します。</p><button type="button" className="btn btn-main" onClick={()=>void save()}>{busy?'保存中…':'確認した保守期間だけを保存'}</button></div>}
  </fieldset>
  {notice&&<p role="alert">{notice}</p>}
 </div>
}
