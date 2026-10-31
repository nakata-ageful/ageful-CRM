import {errorDetail,formErrorText} from '../lib/form-error'
import {FormError} from './FormError'
import { useRef,useState } from 'react'
import {CustomerPicker} from './CustomerPicker'
import type {CustomerChoice} from '../lib/customer-search'
import { isBillingDate,isEditableInvoicePlan,type BillingUnit } from '../lib/billing-unit'
import type { InvoiceWriteRequest } from '../lib/invoice-write-session'

export function InvoicePlanEditor({unit:initialUnit,recipients,onSave,onClose}:{unit:BillingUnit;
  recipients:readonly CustomerChoice[];onSave:(r:InvoiceWriteRequest)=>Promise<unknown>;onClose:()=>void}) {
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
    }catch(e){setError(errorDetail(e)||formErrorText(e))}finally{lock.current=false;setBusy(false)}
  }
  return <section className="card"><h3>{unit.serviceYear}年 {unit.roundLabel}：予定を編集</h3>
    <p>今回だけの請求先・日付・予定額を変更します。保存しても未発行の予定のままです。</p>
    <FormError message={error}/><form onSubmit={save}><fieldset disabled={busy} style={{border:0}}>
      <CustomerPicker label="請求先" value={payer} onChange={setPayer} customers={recipients} emptyLabel="請求先要確認"/>
      <label>請求予定日<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label>予定額（税込）<input inputMode="numeric" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
      <p>金額の空欄は「金額要確認」です。今回の予定額は、今後の基本設定を変更しても自動では変わりません。</p>
      <div className="editor-footer"><button className="btn btn-sub" type="button" onClick={onClose}>キャンセル</button><button className="btn btn-main" type="submit">{busy?'保存中…':'予定を保存'}</button></div>
    </fieldset></form>
  </section>
}
