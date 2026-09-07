import { useRef,useState } from 'react'
import { isBillingDate,type BillingUnit } from '../lib/billing-unit'
import type { InvoiceWriteRequest } from '../lib/invoice-write-session'
import { fmtYen } from '../lib/utils'

export function ManualDebitEditor({unit:initialUnit,recipientName,onSave,onClose}:{unit:BillingUnit;recipientName:(id:number)=>string;
  onSave:(request:InvoiceWriteRequest)=>Promise<unknown>;onClose:()=>void}) {
  const [unit]=useState(()=>structuredClone(initialUnit))
  const correcting=unit.lifecycle==='received'
  const [mode,setMode]=useState<'debit_received'|'debit_invoice_switch'|'debit_correction'>(correcting?'debit_correction':'debit_received')
  const [date,setDate]=useState(correcting?unit.receivedOn??'':''),[reason,setReason]=useState('')
  const [items,setItems]=useState(correcting?unit.frozenLineItems?.map(i=>({name:i.name,amount:String(i.amount)}))??[]:[{name:'',amount:''}])
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false)
  if(unit.method!=='口座振替'||(!correcting&&(unit.lifecycle!=='planned'||unit.frozenAmount!==null||unit.receivedOn)))return <p role="alert">振替予定または入金済みの振替だけが対象です。</p>
  async function submit(e:React.FormEvent){
    e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('')
    try{
      const id=Number(unit.id)
      if(!Number.isSafeInteger(id)||id<=0||unit.recipientId===null||!reason.trim())throw Error('請求先・確認内容を確認してください')
      let value:object={}
      if(mode!=='debit_invoice_switch'){
        if(!isBillingDate(date)||!items.length||items.some(i=>!i.name.trim()||!/^\d+$/.test(i.amount)||!Number.isSafeInteger(Number(i.amount))))throw Error('入金日・実額・明細を入力してください')
        const lines=items.map(i=>({name:i.name.trim(),amount:Number(i.amount)})),amount=lines.reduce((sum,i)=>sum+i.amount,0)
        if(!Number.isSafeInteger(amount))throw Error('金額が大きすぎます')
        value={received_on:date,amount,line_items:lines}
      }
      await onSave({unitId:id,revision:unit.revision,mode,value,reason:reason.trim()});onClose()
    }catch(e){setError(e instanceof Error?e.message:String(e))}finally{lock.current=false;setBusy(false)}
  }
  return <section className="card"><h3>{unit.serviceYear}年 {unit.roundLabel}：{correcting?'振替記録を訂正':'振替結果を記録'}</h3>
    <p>銀行の処理は行いません。確認した結果を記録してください。</p>
    <p>請求先：{unit.recipientId===null?'要確認':recipientName(unit.recipientId)} ／ 保存予定額：{unit.plannedAmount==null?'要確認':fmtYen(unit.plannedAmount)}</p>
    {error&&<p role="alert">{error}</p>}<form onSubmit={submit}><fieldset disabled={busy} style={{border:0}}>
      {correcting?<p>訂正前の内容と理由を履歴に残します。請求先は変更しません。</p>:<label>確認結果<select value={mode} onChange={e=>setMode(e.target.value as typeof mode)}><option value="debit_received">入金を確認した</option><option value="debit_invoice_switch">振替不能を確認し、請求書へ切替</option></select></label>}
      {mode!=='debit_invoice_switch'?<><label>入金日<input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
        {items.map((item,index)=><div key={index}><label>明細名<input required value={item.name} onChange={e=>setItems(items.map((v,i)=>i===index?{...v,name:e.target.value}:v))}/></label>
          <label>実際の入金額（税込）<input required inputMode="numeric" value={item.amount} onChange={e=>setItems(items.map((v,i)=>i===index?{...v,amount:e.target.value}:v))}/></label>
          {items.length>1&&<button type="button" onClick={()=>setItems(items.filter((_,i)=>i!==index))}>削除</button>}</div>)}
        <button type="button" onClick={()=>setItems([...items,{name:'',amount:''}])}>明細を追加</button></>
        :<p>元の請求先・予定額を維持して同じ回を切り替えます。請求書の発行は次の操作です。</p>}
      <label>確認内容・理由<textarea required value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <button type="submit" className="btn btn-main">{busy?'保存中…':'確認結果を保存'}</button><button type="button" className="btn" onClick={onClose}>閉じる</button>
    </fieldset></form></section>
}
