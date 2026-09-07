import { useRef,useState } from 'react'
import { isBillingDate,isEditableInvoicePlan,type BillingUnit } from '../lib/billing-unit'
import type { InvoiceWriteRequest } from '../lib/invoice-write-session'

export function InvoicePlanEditor({unit:initialUnit,recipients,onSave,onClose}:{unit:BillingUnit;
  recipients:readonly {id:number;name:string}[];onSave:(r:InvoiceWriteRequest)=>Promise<unknown>;onClose:()=>void}) {
  const [unit]=useState(()=>structuredClone(initialUnit))
  const [date,setDate]=useState(unit.scheduledDate??''),[payer,setPayer]=useState(unit.recipientId?.toString()??'')
  const [amount,setAmount]=useState(unit.plannedAmount?.toString()??'')
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);const lock=useRef(false)
  if(!isEditableInvoicePlan(unit))return <p role="alert">この回の予定は変更できません。</p>
  async function save(event:React.FormEvent){
    event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('')
    try{
      const id=Number(unit.id),recipient=payer?Number(payer):null
      if(!Number.isSafeInteger(id)||id<=0||(date&&!isBillingDate(date)))throw Error('対象回・予定日を確認してください')
      if(recipient!==null&&(!Number.isSafeInteger(recipient)||!recipients.some(r=>r.id===recipient)))throw Error('請求先を選び直してください')
      if(amount&&(!/^\d+$/.test(amount)||!Number.isSafeInteger(Number(amount))))throw Error('予定額は0円以上の整数で入力してください')
      await onSave({unitId:id,revision:unit.revision,mode:'plan',value:{recipient_customer_id:recipient,scheduled_date:date||null,
        planned_amount:amount===''?null:Number(amount)},reason:null})
      onClose()
    }catch(e){setError(e instanceof Error?e.message:String(e))}finally{lock.current=false;setBusy(false)}
  }
  return <section className="card"><h3>{unit.serviceYear}年 {unit.roundLabel}：予定を編集</h3>
    <p>選んだ1回だけを変更します。金額は確定せず、保存後も請求予定に残ります。</p>
    {error&&<p role="alert">{error}</p>}<form onSubmit={save}><fieldset disabled={busy} style={{border:0}}>
      <label>請求先<select value={payer} onChange={e=>setPayer(e.target.value)}><option value="">請求先要確認</option>
        {recipients.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>請求予定日<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label>予定額（税込）<input inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      <p>空欄は金額要確認です。保存額は契約変更で自動更新されず、実績の確定額とは別です。</p>
      <button className="btn btn-main" type="submit">{busy?'保存中…':'予定を保存'}</button>
      <button className="btn" type="button" onClick={onClose}>閉じる</button>
    </fieldset></form>
  </section>
}
