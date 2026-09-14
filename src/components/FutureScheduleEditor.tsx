import {useEffect,useState} from 'react'
import type {BillingRow,Customer} from '../types'
import type {TransferBillingUnit} from '../lib/ownership-billing-plan'
import type {ManagementEvent} from '../lib/management-lifecycle'
import {maintenanceSchedule,type MaintenanceScheduleItem} from '../lib/maintenance-schedule'
import {maintenancePeriodLabel} from '../lib/maintenance-period-label'
import {isBillingDate} from '../lib/billing-unit'
import {MaintenancePeriodReview} from './MaintenancePeriodReview'
import {validateIndividualPeriod} from '../lib/individual-maintenance-period'

type Item=MaintenanceScheduleItem&{include:boolean;reason?:string}
export function FutureScheduleEditor({row,customers,units,events,onSave,onPeriodSave}:{row:BillingRow;customers:Customer[];units:TransferBillingUnit[];events:ManagementEvent[];onSave:(value:Record<string,unknown>)=>Promise<unknown>;onPeriodSave?:(value:Record<string,unknown>)=>Promise<unknown>}){
 const [year,setYear]=useState(new Date().getFullYear())
 const [individual,setIndividual]=useState(false),[periodStart,setPeriodStart]=useState(''),[periodEnd,setPeriodEnd]=useState('')
 const [periodReason,setPeriodReason]=useState(''),[periodConfirmed,setPeriodConfirmed]=useState(false)
 useEffect(()=>setPeriodConfirmed(false),[year,periodStart,periodEnd,periodReason,individual,units])
 const [recipient,setRecipient]=useState(''),[items,setItems]=useState<Item[]>([]),[notice,setNotice]=useState(''),[reason,setReason]=useState(''),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false)
 const own=units.filter(u=>u.projectId===row.project_id)
 const [excluded,setExcluded]=useState<{date:string;round:number;reason:string}[]>([])
 function preview(){try{
  if(!recipient)throw Error('今回追加する予定の請求先を選択してください')
  if(!row.contract)throw Error('契約が未設定です')
  const candidates=maintenanceSchedule(row.contract,year,Number(recipient),own,events,individual?{periodStart,periodEnd}:undefined)
  setExcluded(candidates.filter(c=>c.exclusion).map(c=>({date:`${c.periodStart} ～ ${c.periodEnd}`,round:c.round,reason:c.exclusion!})))
  setItems(candidates.filter(c=>!c.exclusion).map(c=>({...c,include:false})))
  setNotice('保守期間ごとの回です。請求予定日は前払いを含め別に指定してください。');setReviewed(false)
 }catch(e){setNotice(e instanceof Error?e.message:String(e));setItems([]);setExcluded([])}}
 function change(index:number,patch:Partial<Item>){setItems(items.map((i,n)=>n===index?{...i,...patch}:i));setReviewed(false)}
 async function save(){setBusy(true);try{await onSave({projectId:row.project_id,contract:row.contract,versions:Object.fromEntries(own.map(u=>[u.id,u.revision])),last:Math.max(0,...events.filter(e=>e.project_id===row.project_id).map(e=>e.id)),items:items.filter(i=>i.include).map(({include,reason,...i})=>i),reason});setItems([]);setReviewed(false);setNotice('確認した請求予定を追加しました。')}catch(e){setNotice(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 async function savePeriod(){setBusy(true);try{validateIndividualPeriod({periodStart,periodEnd},year,row.project_id,own.filter(u=>u.serviceYear!==year),row.contract?.maintenance_start_date);if(!periodConfirmed||!periodReason.trim()||!onPeriodSave)throw Error('保存済み記録への変更を確認してください');await onPeriodSave({projectId:row.project_id,contract:row.contract,versions:Object.fromEntries(own.map(u=>[u.id,u.revision])),year,periodStart,periodEnd,reason:periodReason});setPeriodConfirmed(false);setItems([]);setNotice('保存済み記録の保守期間のみ更新しました。金額・請求先・入金日は変更していません。')}catch(e){setNotice(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 return <section className="card" style={{padding:20,marginTop:16}}><details><summary>今後の請求予定を追加</summary>
  <p>対象の保守期間と第何回かで管理します。請求日が前年でも保守期間は変わりません。請求日・金額は別に確認し、選択した回だけ追加します。発行・銀行手配は行いません。</p>
  <MaintenancePeriodReview startDate={row.contract?.maintenance_start_date??null} units={own}/>
  <fieldset disabled={busy} style={{border:0,padding:0}}>
  <label>保守期間の開始年 <input type="number" min={2000} max={2199} value={year} onChange={e=>{setYear(Number(e.target.value));setItems([]);setExcluded([]);setReviewed(false)}}/></label>
  {!individual&&<p>{maintenancePeriodLabel(row.contract?.maintenance_start_date,year)}</p>}
  <label><input type="checkbox" checked={individual} onChange={e=>{setIndividual(e.target.checked);setItems([]);setReviewed(false)}}/>保守期間を個別指定する</label>
  {individual&&<div><label>個別の保守開始日 <input type="date" value={periodStart} onChange={e=>{setPeriodStart(e.target.value);setYear(Number(e.target.value.slice(0,4)));setItems([]);setReviewed(false)}}/></label><label>個別の保守終了日 <input type="date" value={periodEnd} onChange={e=>{setPeriodEnd(e.target.value);setItems([]);setReviewed(false)}}/></label><p>翌期も必要に応じて個別指定してください。予定の追加では過去の請求期間を変更しません。保存済み記録への適用は、下の専用確認から行います。</p></div>}
  <label>追加分の請求先 <select value={recipient} onChange={e=>{setRecipient(e.target.value);setItems([])}}><option value="">選択してください</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{' '}<button onClick={preview}>不足分の候補を表示</button>
  {individual&&onPeriodSave&&own.some(u=>u.serviceYear===year)&&<section><p>{year}年の保存済み{own.filter(u=>u.serviceYear===year).length}回すべてに、この保守期間を指定します。発行・入金済みも含みますが、金額・請求先・入金日・元記録は変更しません。</p><label>期間変更の確認理由 <input value={periodReason} onChange={e=>setPeriodReason(e.target.value)}/></label><label><input type="checkbox" checked={periodConfirmed} onChange={e=>setPeriodConfirmed(e.target.checked)}/>上記の保存済み記録に適用することを確認しました</label><button disabled={!periodConfirmed||!periodReason.trim()||!isBillingDate(periodStart)||!isBillingDate(periodEnd)} onClick={()=>void savePeriod()}>保存済み記録の保守期間だけを保存</button></section>}
  {notice&&<p role="status">{notice}</p>}
  {!!excluded.length&&<details><summary>追加しない候補と理由（{excluded.length}件）</summary>{excluded.map((r,n)=><p key={n}>{r.date} ／ 第{r.round}回：{r.reason}</p>)}</details>}
  {items.map((i,n)=><div key={`${i.year}:${i.round}`} style={{padding:10,borderBottom:'1px solid #ddd'}}>
   <label><input type="checkbox" checked={i.include} onChange={e=>change(n,{include:e.target.checked})}/>第{i.round}回 ／ {i.method==='invoice'?'請求書':'口座振替'}</label>
   <p>{i.periodStart} ～ {i.periodEnd}</p>
   <label>請求予定日（前払いなら前年も指定可） <input type="date" value={i.date} onChange={e=>change(n,{date:e.target.value})}/></label>{' '}
   <label>請求先 <select value={i.recipientId} onChange={e=>change(n,{recipientId:Number(e.target.value)})}>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{' '}
   <label>予定額 <input type="number" min={0} step={1} value={i.amount??''} onChange={e=>change(n,{amount:e.target.value===''?null:Number(e.target.value)})}/></label>
   <p>期間途中の終了・再開や他費目の金額は確認してください。日割り・返金は自動計算しません。</p>
   {i.reason&&<p>{i.reason}</p>}
  </div>)}
  {!!items.length&&<><label>確認内容・備考 <input value={reason} onChange={e=>{setReason(e.target.value);setReviewed(false)}}/></label>{' '}
   <button disabled={!reason.trim()||!items.some(i=>i.include)||items.some(i=>i.include&&(!isBillingDate(i.date)||i.amount===null||!Number.isSafeInteger(i.amount)||i.amount<0))} onClick={()=>setReviewed(true)}>追加内容を確認</button>
   {reviewed&&<p>{items.filter(i=>i.include).length}件、予定額合計 {items.filter(i=>i.include).reduce((s,i)=>s+(i.amount??0),0).toLocaleString()}円。保存済みの記録は変更しません。 <button onClick={()=>void save()}>確認した予定を追加</button></p>}</>}
  </fieldset></details></section>
}
