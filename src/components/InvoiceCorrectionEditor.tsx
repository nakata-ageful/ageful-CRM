import {useRef,useState} from 'react'
import type {BillingUnit} from '../lib/billing-unit'
import {isBillingDate} from '../lib/billing-unit'
import type {InvoiceWriteRequest} from '../lib/invoice-write-session'

export function InvoiceCorrectionEditor({unit:initial,recipients,onSave,onClose}:{unit:BillingUnit;recipients:readonly {id:number;name:string}[];onSave:(r:InvoiceWriteRequest)=>Promise<unknown>;onClose:()=>void}){
  const [unit]=useState(()=>structuredClone(initial)),[recipient,setRecipient]=useState(String(initial.recipientId??''))
  const [issued,setIssued]=useState(initial.issuedOn??''),[received,setReceived]=useState(initial.receivedOn??''),[scheduled,setScheduled]=useState(initial.scheduledDate??'')
  const [due,setDue]=useState(initial.paymentDueOn??''),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [items,setItems]=useState(()=>(initial.frozenLineItems??[]).map(i=>({name:i.name,amount:String(i.amount)})))
  const lock=useRef(false)
  return <section className="card"><h3>{unit.serviceYear}年 {unit.roundLabel}：請求・入金記録を訂正</h3>
    <p>この回だけを訂正します。元の記録と訂正理由は履歴に残ります。</p>
    <form onSubmit={async e=>{e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('')
      try{
        if(!recipients.some(r=>r.id===Number(recipient))||!reason.trim()||(!issued&&!received)
          ||[issued,received,scheduled,due].some(d=>d&&!isBillingDate(d)))throw Error('請求先・日付・訂正理由を確認してください')
        if(!items.length||items.some(i=>!i.name.trim()||!/^\d+$/.test(i.amount)||!Number.isSafeInteger(Number(i.amount))))throw Error('明細と金額を確認してください')
        const lines=items.map(i=>({name:i.name.trim(),amount:Number(i.amount)})),amount=lines.reduce((n,i)=>n+i.amount,0)
        if(!Number.isSafeInteger(amount))throw Error('金額が大きすぎます')
        await onSave({unitId:Number(unit.id),revision:unit.revision,mode:'correction',reason:reason.trim(),value:{recipient_customer_id:Number(recipient),scheduled_date:scheduled||null,issued_on:issued||null,received_on:received||null,payment_due_on:due||null,frozen_amount:amount,frozen_line_items:lines}})
        onClose()
      }catch(e){setError(e instanceof Error?e.message:String(e))}finally{lock.current=false;setBusy(false)}
    }}><fieldset disabled={busy} style={{border:0,padding:0}}>
      <label>請求先<select className="form-input" value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">選択してください</option>{recipients.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label>請求予定日<input type="date" value={scheduled} onChange={e=>setScheduled(e.target.value)}/></label>
      <label>請求日<input type="date" value={issued} onChange={e=>setIssued(e.target.value)}/></label>
      <label>入金日<input type="date" value={received} onChange={e=>setReceived(e.target.value)}/></label>
      <label>入金予定日<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>
      {items.map((i,n)=><div key={n}><label>明細名<input value={i.name} onChange={e=>setItems(items.map((v,k)=>k===n?{...v,name:e.target.value}:v))}/></label><label>金額（税込）<input inputMode="numeric" value={i.amount} onChange={e=>setItems(items.map((v,k)=>k===n?{...v,amount:e.target.value}:v))}/></label><button type="button" onClick={()=>setItems(items.filter((_,k)=>k!==n))}>明細を削除</button></div>)}
      <button type="button" onClick={()=>setItems([...items,{name:'',amount:''}])}>明細を追加</button>
      <label>訂正理由<textarea className="form-input" required value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <p role="alert">{error}</p><button className="btn btn-main" disabled={busy}>訂正を保存</button><button className="btn" type="button" onClick={onClose}>閉じる</button>
    </fieldset></form>
  </section>
}
