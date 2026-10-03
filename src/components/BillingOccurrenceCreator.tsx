import {useRef,useState} from 'react'
import {CustomerPicker} from './CustomerPicker'
import type {CustomerChoice} from '../lib/customer-search'
import type {Contract} from '../types'
import type {BillingUnit} from '../lib/billing-unit'
import {futureMaintenancePeriod,cycleInvoiceDate,type BillingCycleRule} from '../lib/billing-cycle'
import {detailPlanCount,validateDetailPlan,type DetailPlanCandidate} from '../lib/billing-detail-plan'
import type {MaintenanceScheduleItem} from '../lib/maintenance-schedule'
import {fmtYen} from '../lib/utils'

export type AddBillingOccurrence=(item:MaintenanceScheduleItem,reason:string)=>Promise<unknown>

/** One reviewed occurrence, using the existing atomic insert-only schedule writer. */
export function BillingOccurrenceCreator({candidate,contract,units,recipients,onSave,onClose,cycleRules=[]}:{
  candidate:DetailPlanCandidate;contract:Contract;units:readonly BillingUnit[];
  recipients:readonly CustomerChoice[];onSave:AddBillingOccurrence;onClose:()=>void
  cycleRules?:readonly BillingCycleRule[]
}){
  const [year,setYear]=useState(String(candidate.year)),[round,setRound]=useState(String(candidate.round))
  const [start,setStart]=useState(candidate.periodStart??''),[end,setEnd]=useState(candidate.periodEnd??'')
  const [date,setDate]=useState(candidate.date),[recipient,setRecipient]=useState(String(candidate.recipientId))
  const [amount,setAmount]=useState(candidate.amount===null?'':String(candidate.amount)),[reason,setReason]=useState('')
  const [confirmed,setConfirmed]=useState<MaintenanceScheduleItem|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const lock=useRef(false),debit=candidate.method==='direct_debit'
  const change=(setter:(v:string)=>void,value:string)=>{setter(value);setConfirmed(null);setError('')}
  const changeCoverage=(setter:(v:string)=>void,value:string)=>{change(setter,value);setAmount('')}
  const years=(value:string)=>{
    changeCoverage(setYear,value)
    const stored=units.find(u=>u.serviceYear===Number(value)&&u.periodStart&&u.periodEnd)
    try{const period=stored?{periodStart:stored.periodStart!,periodEnd:stored.periodEnd!}:futureMaintenancePeriod(contract,Number(value),cycleRules);setStart(period.periodStart);setEnd(period.periodEnd);const prepaid=cycleInvoiceDate(contract,Number(value),cycleRules);if(prepaid)setDate(prepaid)}catch{setStart('');setEnd('')}
  }
  function review(e:React.FormEvent){e.preventDefault();setError('');setConfirmed(null)
    try{
      if(!/^\d+$/.test(amount)||!recipients.some(r=>r.id===Number(recipient))||!/^\d{4}$/.test(year)||Number(round)>detailPlanCount(contract))throw Error('請求先・予定額・対象の回を確認してください')
      const item:MaintenanceScheduleItem={year:Number(year),round:Number(round),periodStart:start,periodEnd:end,date,recipientId:Number(recipient),amount:Number(amount),method:candidate.method}
      if(!contract.maintenance_start_date)throw Error('「保守情報」で保守開始日を設定してください')
      validateDetailPlan(item,units,contract.project_id,reason,contract.maintenance_start_date,cycleRules,contract);setConfirmed(item)
    }catch(e){setError(e instanceof Error?e.message:String(e))}
  }
  async function save(){if(!confirmed||lock.current)return;lock.current=true;setBusy(true);setError('')
    try{validateDetailPlan(confirmed,units,contract.project_id,reason,contract.maintenance_start_date,cycleRules,contract);await onSave(confirmed,reason.trim());onClose()}
    catch(e){setError(e instanceof Error?e.message:String(e))}finally{lock.current=false;setBusy(false)}
  }
  return <section>
    <p>保守期間と第何回かを指定して、1回分の予定を追加します。前払いの場合も、請求予定日ではなく対象の保守期間を選んでください。過去の記録は上書きしません。</p>
    <p>入力済みの予定額は契約からの参考額です。実際の請求額・入金額は、発行・入金確認のときに記録します。銀行手配や請求書の送信は行いません。</p>
    <p>対象の回・期間・予定日を変更した場合は、予定額も再確認して入力してください。</p>
    {error&&<p role="alert">{error}</p>}
    <form onSubmit={review}><fieldset disabled={busy} style={{border:0,padding:0}}>
      <label>保守期間の開始年<input type="number" min={2000} max={2199} required value={year} onChange={e=>years(e.target.value)}/></label>
      <label>対象の回<select value={round} onChange={e=>changeCoverage(setRound,e.target.value)}>{Array.from({length:detailPlanCount(contract)},(_,i)=><option key={i} value={i+1}>第{i+1}回</option>)}</select></label>
      <label>保守期間の開始日<input type="date" required value={start} onChange={e=>{changeCoverage(setStart,e.target.value);setYear(e.target.value.slice(0,4))}}/></label>
      <label>保守期間の終了日<input type="date" required value={end} onChange={e=>changeCoverage(setEnd,e.target.value)}/></label>
      <CustomerPicker label="請求先" value={recipient} onChange={value=>change(setRecipient,value)} customers={recipients}/>
      <label>{debit?'振替予定日':'請求予定日'}<input type="date" required value={date} onChange={e=>changeCoverage(setDate,e.target.value)}/></label>
      <label>予定額（税込）<input inputMode="numeric" required value={amount} onChange={e=>change(setAmount,e.target.value)}/></label>
      <label>確認内容・備考<textarea required value={reason} onChange={e=>change(setReason,e.target.value)} placeholder="対象期間・請求先・予定額を確認した内容"/></label>
      {confirmed&&<div className="billing-plan-confirmation" role="status"><strong>追加する予定：1件</strong><p>{confirmed.periodStart} ～ {confirmed.periodEnd} ／ 第{confirmed.round}回<br/>請求先：{recipients.find(r=>r.id===confirmed.recipientId)?.name}<br/>{debit?'振替':'請求'}予定日：{confirmed.date} ／ 予定額：{fmtYen(confirmed.amount!)}</p><p>この予定を追加した後、この画面から{debit?'振替結果':'請求日・入金日'}を記録できます。</p></div>}
      <div className="editor-footer"><button type="button" className="btn btn-sub" onClick={onClose}>キャンセル</button>
        {confirmed?<button type="button" className="btn btn-main" onClick={()=>void save()}>{busy?'保存中…':'確認した予定を保存'}</button>:<button type="submit" className="btn btn-main">追加内容を確認</button>}
      </div>
    </fieldset></form>
  </section>
}
