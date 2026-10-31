import {errorDetail,formErrorText} from '../lib/form-error'
import {FormError} from './FormError'
import {useRef,useState} from 'react'
import {CustomerPicker} from './CustomerPicker'
import type {CustomerChoice} from '../lib/customer-search'
import {isBillingDate} from '../lib/billing-unit'
export type NewDebitPlan={recipient:number;year:number;month:number;date:string;amount:number|null;note:string;reason:string}
export function ManualDebitPlanCreator({onSave,recipients=[{id:1,name:'顧客A'},{id:2,name:'顧客B'}],testOnly=true,expanded=false}:{onSave:(value:NewDebitPlan)=>Promise<void>;recipients?:readonly CustomerChoice[];testOnly?:boolean;expanded?:boolean}){
 const [recipient,setRecipient]=useState(''),[year,setYear]=useState(''),[month,setMonth]=useState(''),[date,setDate]=useState(''),[amount,setAmount]=useState(''),[note,setNote]=useState(''),[reason,setReason]=useState('')
 const [notice,setNotice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);const lock=useRef(false)
 async function save(e:React.FormEvent){e.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('')
  try{
   if(!recipients.some(r=>r.id===Number(recipient)))throw Error('「請求先」で顧客を選択してください')
   if(!/^\d{4}$/.test(year)||Number(year)<2000||Number(year)>2200)throw Error('「対象年」に2000～2200年を入力してください')
   if(!/^\d{1,2}$/.test(month)||Number(month)<1||Number(month)>12)throw Error('「対象月」に1～12月を入力してください')
   if(!isBillingDate(date))throw Error('「振替予定日」を入力してください')
   if(amount!==''&&(!/^\d+$/.test(amount)||!Number.isSafeInteger(Number(amount))))throw Error('「予定額」に0円以上の整数を入力してください。未定の場合は空欄にしてください')
   if(!reason.trim())throw Error('「追加の確認内容・理由」を入力してください')
   await onSave({recipient:Number(recipient),year:Number(year),month:Number(month),date,amount:amount===''?null:Number(amount),note,reason:reason.trim()});setReason('');setNotice('振替予定を追加しました。')
  }catch(e){setError(errorDetail(e)||formErrorText(e))}finally{lock.current=false;setBusy(false)}}
 const EditorBody=expanded?'section':'details'
 return <EditorBody className="card" style={{padding:20}}>{!expanded&&<summary>振替予定を1件追加</summary>}<p>今回追加する1か月分だけを保存します。銀行への振替手配は行いません。</p>
 <form onSubmit={save}><fieldset disabled={busy} style={{border:0,display:'grid',gap:10}}>
 <CustomerPicker label="請求先" value={recipient} onChange={setRecipient} customers={recipients}/>
 <label>対象年<input value={year} onChange={e=>setYear(e.target.value)} inputMode="numeric" required/></label>
 <label>対象月<input value={month} onChange={e=>setMonth(e.target.value)} inputMode="numeric" required/></label>
 <label>振替予定日<input type="date" value={date} onChange={e=>setDate(e.target.value)} required/></label>
 <label>予定額（税込・空欄は要確認）<input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="numeric"/></label>
 <label>備考<textarea value={note} onChange={e=>setNote(e.target.value)}/></label>
 <label>追加の確認内容・理由<textarea value={reason} onChange={e=>setReason(e.target.value)} required/></label>
 <button type="submit" className="btn btn-main">{busy?'保存中…':testOnly?'検証用DBへ追加':'予定を追加'}</button><FormError message={error}/>{notice&&<p role="status">{notice}</p>}
 </fieldset></form></EditorBody>
}
