import {errorDetail,formErrorText} from '../lib/form-error'
import {FormError} from './FormError'
import { useRef,useState } from 'react'
import { isBillingDate,type BillingUnit } from '../lib/billing-unit'
import type { InvoiceWriteRequest } from '../lib/invoice-write-session'
import { fmtYen } from '../lib/utils'
import type { RoutineInvoiceContext } from '../lib/routine-invoice'
import {debitOccurrenceLabel} from '../lib/billing-occurrence-label'

export function ManualDebitEditor({unit:initialUnit,automaticDebit,recipientName,onSave,onClose}:(
  {unit:BillingUnit;automaticDebit?:never}|{unit?:never;automaticDebit:RoutineInvoiceContext}
)&{recipientName:(id:number)=>string;
  onSave:(request:InvoiceWriteRequest)=>Promise<unknown>;onClose:()=>void}) {
  const [unit]=useState(()=>structuredClone(initialUnit))
  const item=automaticDebit?.item
  const recipientId=item?.recipientId??unit?.recipientId??null
  const amount=item?.amount??unit?.plannedAmount
  const correcting=unit?.lifecycle==='received'
  const [mode,setMode]=useState<''|'debit_received'|'debit_invoice_switch'|'debit_correction'>(correcting?'debit_correction':item?'':'debit_received')
  const [date,setDate]=useState(correcting?unit!.receivedOn??'':''),[reason,setReason]=useState('')
  const [items,setItems]=useState(correcting?unit!.frozenLineItems?.map(i=>({name:i.name,amount:String(i.amount)}))??[]:[{name:item?'口座振替':'',amount:item?.amount==null?'':String(item.amount)}])
  const [busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false)
  if(!item&&(!unit||unit.method!=='口座振替'||(!correcting&&(unit.lifecycle!=='planned'||unit.frozenAmount!==null||unit.receivedOn))))return <p role="alert">振替予定または入金済みの振替だけが対象です。</p>
  async function submit(e:React.FormEvent){
    e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('')
    try{
      if(!mode)throw Error('振替の確認結果を選んでください')
      const id=Number(unit?.id)
      const savedReason=reason.trim()||(item&&mode==='debit_received'?'銀行の振替結果で入金を確認':'')
      if((!item&&(!Number.isSafeInteger(id)||id<=0))||recipientId===null||!savedReason)throw Error('請求先・確認内容を確認してください')
      let value:object={}
      if(mode!=='debit_invoice_switch'){
        if(!isBillingDate(date)||!items.length||items.some(i=>!i.name.trim()||!/^\d+$/.test(i.amount)||!Number.isSafeInteger(Number(i.amount))))throw Error('入金日・実額・明細を入力してください')
        const lines=items.map(i=>({name:i.name.trim(),amount:Number(i.amount)})),amount=lines.reduce((sum,i)=>sum+i.amount,0)
        if(!Number.isSafeInteger(amount))throw Error('金額が大きすぎます')
        value={received_on:date,amount,line_items:lines}
      }
      await onSave({unitId:item?0:id,revision:unit?.revision??0,mode,value,reason:savedReason,
        ...(automaticDebit?{automaticDebit}:{})});onClose()
    }catch(e){setError(errorDetail(e)||formErrorText(e))}finally{lock.current=false;setBusy(false)}
  }
  return <section className="card"><h3>{debitOccurrenceLabel(item?.date??unit?.scheduledDate)}：{correcting?'振替記録を訂正':'振替結果を記録'}</h3>
    <p>銀行の処理は行いません。確認した結果を記録してください。</p>
    <p>請求先：{recipientId===null?'要確認':recipientName(recipientId)} ／ 振替予定額：{amount==null?'要確認':fmtYen(amount)}</p>
    {item&&<p>保守期間：{item.periodStart} ～ {item.periodEnd}</p>}
    <FormError message={error}/><form onSubmit={submit}><fieldset disabled={busy} style={{border:0}}>
      {correcting?<p>訂正前の内容と理由を履歴に残します。請求先は変更しません。</p>:<label>確認結果<select required value={mode} onChange={e=>setMode(e.target.value as typeof mode)}>{item&&<option value="" disabled>結果を選んでください</option>}<option value="debit_received">入金を確認した</option><option value="debit_invoice_switch">振替不能を確認し、請求書へ切替</option></select></label>}
      {mode&&(mode!=='debit_invoice_switch'?<><label>入金日<input required type="date" max="9999-12-31" value={date} onChange={e=>setDate(e.target.value)}/></label>
        {items.map((item,index)=><div key={index} className="editor-line-item"><label>明細名<input required value={item.name} onChange={e=>setItems(items.map((v,i)=>i===index?{...v,name:e.target.value}:v))}/></label>
          <label>実際の入金額（税込）<input required inputMode="numeric" value={item.amount} onChange={e=>setItems(items.map((v,i)=>i===index?{...v,amount:e.target.value}:v))}/></label>
          {items.length>1&&<button type="button" onClick={()=>setItems(items.filter((_,i)=>i!==index))}>明細を削除</button>}</div>)}
        <button type="button" onClick={()=>setItems([...items,{name:'',amount:''}])}>明細を追加</button></>
        :<p>元の請求先・予定額を維持して同じ回を切り替えます。切替後、別途発行した請求書の内容を記録してください。</p>)}
      {mode&&<label>{item&&mode==='debit_received'?'確認メモ（任意）':'確認内容・理由'}<textarea required={!item||mode!=='debit_received'} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
      <div className="editor-footer"><button type="button" className="btn btn-sub" onClick={onClose}>キャンセル</button><button type="submit" className="btn btn-main" disabled={!mode}>{busy?'保存中…':'確認結果を保存'}</button></div>
    </fieldset></form></section>
}
