import { useRef, useState } from 'react'
import type { BillingUnit } from '../lib/billing-unit'
import { isBillingDate, isEditableInvoicePlan } from '../lib/billing-unit'
import type { InvoiceWriteRequest } from '../lib/invoice-write-session'
import { fmtYen } from '../lib/utils'

/** onSave must resolve only after the atomic RPC and refreshed ledger have completed. */
export function InvoiceUnitEditor({unit:initialUnit,recipientName,onSave,onClose}:{unit:BillingUnit;recipientName:(id:number)=>string;
  onSave:(request:InvoiceWriteRequest)=>Promise<unknown>;onClose:()=>void}) {
  const [unit]=useState(()=>structuredClone(initialUnit))
  const [date,setDate]=useState(''),[due,setDue]=useState('')
  const [items,setItems]=useState([{name:'保守料',amount:''}])
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const lock=useRef(false)
  const issuing=isEditableInvoicePlan(unit)
  const collecting=unit.method==='請求書'&&unit.lifecycle==='issued'&&!unit.receivedOn
  if(!issuing&&!collecting)return <p role="alert">この回は発行・入金確認の対象ではありません。</p>
  async function save(e:React.FormEvent) {
    e.preventDefault();if(lock.current)return
    lock.current=true;setBusy(true);setError('')
    try {
      const id=Number(unit.id)
      if(!Number.isSafeInteger(id)||id<=0||!isBillingDate(date))throw Error('対象回と日付を確認してください')
      let value:object={received_on:date}
      if(issuing){
        if(unit.recipientId==null)throw Error('先に請求先を設定してください')
        const lines=items.map(i=>({name:i.name.trim(),amount:Number(i.amount)}))
        if(items.some(i=>!/^\d+$/.test(i.amount))||lines.some(i=>!i.name||!Number.isSafeInteger(i.amount)))throw Error('明細名と0円以上の整数を入力してください')
        const amount=lines.reduce((sum,i)=>sum+i.amount,0)
        if(!Number.isSafeInteger(amount)||(due&&!isBillingDate(due)))throw Error('金額・入金予定日を確認してください')
        value={recipient_customer_id:unit.recipientId,scheduled_date:unit.scheduledDate,issued_on:date,received_on:null,
          payment_due_on:due||null,frozen_amount:amount,frozen_line_items:lines}
      }
      await onSave({unitId:id,revision:unit.revision,mode:issuing?'issue':'collection',value,reason:null})
      onClose()
    }catch(e){setError(e instanceof Error?e.message:String(e))}finally{lock.current=false;setBusy(false)}
  }
  return <section className="card"><h3>{unit.serviceYear}年 {unit.roundLabel}：{issuing?'発行':'入金確認'}</h3>
    <p>請求先：{unit.recipientId===null?'請求先要確認':recipientName(unit.recipientId)}</p>
    {!issuing&&<p>確定額：{unit.frozenAmount===null?'金額要確認':fmtYen(unit.frozenAmount)}</p>}
    {error&&<p role="alert">{error}</p>}
    <form onSubmit={save}><fieldset disabled={busy} style={{border:0}}>
      <label>{issuing?'請求日':'入金日'}<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
      {issuing&&<><label>入金予定日<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>
        {items.map((item,index)=><div key={index}>
          <label>明細名<input required value={item.name} onChange={e=>setItems(items.map((v,i)=>i===index?{...v,name:e.target.value}:v))}/></label>
          <label>金額（税込）<input required inputMode="numeric" value={item.amount} onChange={e=>setItems(items.map((v,i)=>i===index?{...v,amount:e.target.value}:v))}/></label>
          {items.length>1&&<button type="button" onClick={()=>setItems(items.filter((_,i)=>i!==index))}>削除</button>}
        </div>)}<button type="button" onClick={()=>setItems([...items,{name:'',amount:''}])}>明細を追加</button></>}
      <p>入力内容を確認して保存してください。保存後に最新の請求履歴を読み込みます。</p>
      <button type="submit" className="btn btn-main">{busy?'保存中…':issuing?'発行して保存':'入金確認を保存'}</button>
      <button type="button" className="btn" onClick={onClose}>閉じる</button>
    </fieldset></form>
  </section>
}
