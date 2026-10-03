import {useRef,useState} from 'react'
import {CustomerPicker} from './CustomerPicker'
import type {CustomerChoice} from '../lib/customer-search'
import {isBillingDate} from '../lib/billing-unit'
export type NewDebitPlan={recipient:number;year:number;month:number;date:string;amount:number|null;note:string;reason:string}
export function ManualDebitPlanCreator({onSave,recipients=[{id:1,name:'顧客A'},{id:2,name:'顧客B'}],testOnly=true,expanded=false}:{onSave:(value:NewDebitPlan)=>Promise<void>;recipients?:readonly CustomerChoice[];testOnly?:boolean;expanded?:boolean}){
 const [recipient,setRecipient]=useState(''),[year,setYear]=useState(''),[month,setMonth]=useState(''),[date,setDate]=useState(''),[amount,setAmount]=useState(''),[note,setNote]=useState(''),[reason,setReason]=useState('')
 const [error,setError]=useState(''),[busy,setBusy]=useState(false);const lock=useRef(false)
 async function save(e:React.FormEvent){e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('')
  try{if(!recipients.some(r=>r.id===Number(recipient))||!/^\d{4}$/.test(year)||Number(year)<2000||Number(year)>2200||!/^\d{1,2}$/.test(month)||Number(month)<1||Number(month)>12||!isBillingDate(date)||!reason.trim()
   ||(amount!==''&&(!/^\d+$/.test(amount)||!Number.isSafeInteger(Number(amount)))))throw Error('対象年月・予定日・金額・確認理由を確認してください')
   await onSave({recipient:Number(recipient),year:Number(year),month:Number(month),date,amount:amount===''?null:Number(amount),note,reason:reason.trim()});setReason('');setError('追加しました。')
  }catch(e){setError(e instanceof Error?e.message:String(e))}finally{lock.current=false;setBusy(false)}}
 const EditorBody=expanded?'section':'details'
 return <EditorBody className="card" style={{padding:20}}>{!expanded&&<summary>振替予定を1件追加</summary>}<p>対象の月と予定日を指定します。自動で毎月の請求は作りません。</p>
 <form onSubmit={save}><fieldset disabled={busy} style={{border:0,display:'grid',gap:10}}>
 <CustomerPicker label="請求先" value={recipient} onChange={setRecipient} customers={recipients}/>
 <label>対象年<input value={year} onChange={e=>setYear(e.target.value)} inputMode="numeric" required/></label>
 <label>対象月<input value={month} onChange={e=>setMonth(e.target.value)} inputMode="numeric" required/></label>
 <label>振替予定日<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label>
 <label>予定額（税込・空欄は要確認）<input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="numeric"/></label>
 <label>備考<textarea value={note} onChange={e=>setNote(e.target.value)}/></label>
 <label>追加の確認内容・理由<textarea value={reason} onChange={e=>setReason(e.target.value)} required/></label>
 <button type="submit" className="btn btn-main">{busy?'保存中…':testOnly?'検証用DBへ追加':'予定を追加'}</button><p role="status">{error}</p>
 </fieldset></form></EditorBody>
}
