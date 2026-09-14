import {useState} from 'react'
import type {BillingRow,Customer} from '../types'
import type {TransferBillingUnit} from '../lib/ownership-billing-plan'
import type {ManagementEvent} from '../lib/management-lifecycle'
import {inspectFutureBillingCoverage} from '../lib/billing-cutover-coverage'
import {reviewFutureSchedule} from '../lib/future-schedule-review'
import {MaintenancePeriodReview} from './MaintenancePeriodReview'

type Item={date:string;year:number;round:number;method:'invoice'|'direct_debit';recipientId:number;amount:number;include:boolean;reason?:string}
export function FutureScheduleEditor({row,customers,units,events,onSave}:{row:BillingRow;customers:Customer[];units:TransferBillingUnit[];events:ManagementEvent[];onSave:(value:Record<string,unknown>)=>Promise<unknown>}){
 const [month,setMonth]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`})
 const [months,setMonths]=useState(15),[recipient,setRecipient]=useState(''),[items,setItems]=useState<Item[]>([]),[notice,setNotice]=useState(''),[reason,setReason]=useState(''),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false)
 const own=units.filter(u=>u.projectId===row.project_id)
 const [excluded,setExcluded]=useState<{date:string;round:number;reason:string}[]>([])
 function preview(){try{
  if(!recipient)throw Error('今回追加する予定の請求先を選択してください')
  const result=inspectFutureBillingCoverage([{...row,records:[]}],new Map([[row.project_id,Number(recipient)]]),own.map(u=>({project_id:u.projectId,recipient_customer_id:u.recipientId??0,collection_method:u.method==='請求書'?'invoice':'direct_debit',scheduled_date:u.scheduledDate,lifecycle:u.lifecycle,planned_amount:u.plannedAmount??null})),month,months,events)
  // Preserve same-year round identity even if its operator-assigned date or method moved.
  const reviewed=reviewFutureSchedule(result.candidates,own)
  const proposals=reviewed.filter(r=>!r.exclusion).map(r=>r.candidate)
  setExcluded(reviewed.filter(r=>r.exclusion).map(r=>({date:r.candidate.date,round:r.candidate.round,reason:r.exclusion!})))
  setItems(proposals.map(c=>({date:c.date,year:Number(c.date.slice(0,4)),round:c.round,method:c.method,recipientId:Number(recipient),amount:c.amount,include:false,reason:c.reason})))
  setNotice([...result.issues.map(i=>i.reason),`追加候補 ${proposals.length}件。保存済みの回は変更しません。`,proposals.length<result.candidates.length?'保存記録がある回、または年内の方法変更等で対応が不明な候補は除外しました。請求詳細で確認してください。':''].filter(Boolean).join(' / '));setReviewed(false)
 }catch(e){setNotice(e instanceof Error?e.message:String(e));setItems([]);setExcluded([])}}
 function change(index:number,patch:Partial<Item>){setItems(items.map((i,n)=>n===index?{...i,...patch}:i));setReviewed(false)}
 async function save(){setBusy(true);try{await onSave({projectId:row.project_id,contract:row.contract,versions:Object.fromEntries(own.map(u=>[u.id,u.revision])),last:Math.max(0,...events.filter(e=>e.project_id===row.project_id).map(e=>e.id)),items:items.filter(i=>i.include).map(({include,reason,...i})=>i),reason});setItems([]);setReviewed(false);setNotice('確認した請求予定を追加しました。')}catch(e){setNotice(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}
 return <section className="card" style={{padding:20,marginTop:16}}><details><summary>今後の請求予定を追加</summary>
  <p>来年以降も、期間を選んで不足分だけ追加できます。発行・引落しは行いません。前払い期間、保守終了後の他費目、各回の請求先と金額を確認してください。</p>
  <MaintenancePeriodReview startDate={row.contract?.maintenance_start_date??null} units={own}/>
  <fieldset disabled={busy} style={{border:0,padding:0}}>
  <label>開始月 <input type="month" value={month} onChange={e=>{setMonth(e.target.value);setItems([])}}/></label>{' '}
  <label>作成期間 <select value={months} onChange={e=>{setMonths(Number(e.target.value));setItems([])}}><option value={12}>12か月</option><option value={15}>15か月</option><option value={24}>24か月</option></select></label>{' '}
  <label>追加分の請求先 <select value={recipient} onChange={e=>{setRecipient(e.target.value);setItems([])}}><option value="">選択してください</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{' '}<button onClick={preview}>不足分の候補を表示</button>
  {notice&&<p role="status">{notice}</p>}
  {!!excluded.length&&<details><summary>追加しない候補と理由（{excluded.length}件）</summary>{excluded.map((r,n)=><p key={n}>{r.date} ／ 第{r.round}回：{r.reason}</p>)}</details>}
  {items.map((i,n)=><div key={`${i.date}:${i.round}`} style={{padding:10,borderBottom:'1px solid #ddd'}}>
   <label><input type="checkbox" checked={i.include} onChange={e=>change(n,{include:e.target.checked})}/>追加する：{i.date} ／ {i.method==='invoice'?`請求書 第${i.round}回`:`口座振替 ${i.round}月分`}</label>{' '}
   <label>請求先 <select value={i.recipientId} onChange={e=>change(n,{recipientId:Number(e.target.value)})}>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>{' '}
   <label>予定額 <input type="number" min={0} step={1} value={Number.isNaN(i.amount)?'':i.amount} onChange={e=>change(n,{amount:e.target.value===''?NaN:Number(e.target.value)})}/></label>
   {i.reason&&<p>{i.reason}</p>}
  </div>)}
  {!!items.length&&<><label>確認内容・備考 <input value={reason} onChange={e=>{setReason(e.target.value);setReviewed(false)}}/></label>{' '}
   <button disabled={!reason.trim()||!items.some(i=>i.include)||items.some(i=>i.include&&(!Number.isSafeInteger(i.amount)||i.amount<0))} onClick={()=>setReviewed(true)}>追加内容を確認</button>
   {reviewed&&<p>{items.filter(i=>i.include).length}件、予定額合計 {items.filter(i=>i.include).reduce((s,i)=>s+i.amount,0).toLocaleString()}円。保存済みの記録は変更しません。 <button onClick={()=>void save()}>確認した予定を追加</button></p>}</>}
  </fieldset></details></section>
}
