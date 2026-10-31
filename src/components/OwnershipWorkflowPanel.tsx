import {errorDetail,formErrorText} from '../lib/form-error'
import {FormError} from './FormError'
import {useState} from 'react'
import type {Customer,CustomerInput,Project} from '../types'
import type {RegistrationCustomer} from '../lib/customer-registration'
import {CustomerPicker} from './CustomerPicker'
import {customerDisplayName} from '../lib/customer-search'
import {CustomerRegistration} from './CustomerRegistration'
import './OwnershipTransferEditor.css'

export function OwnershipWorkflowPanel({project,customers,onSave,onDirect,onCreateCustomer,onReloadCustomers,onBusyChange,pendingCustomerInput,onPendingCustomerChange,candidateOnly=false,initialCustomer=false}:{
  project:Pick<Project,'id'|'customer_id'|'plant_name'|'project_name'>;customers:readonly Customer[];candidateOnly?:boolean;initialCustomer?:boolean;onDirect?:()=>void;
  onSave:(action:'start'|'candidate'|'unknown',customerId:number|null,date:string,reason:string)=>Promise<void>;
  onCreateCustomer:(input:CustomerInput)=>Promise<RegistrationCustomer>;onReloadCustomers:()=>Promise<readonly RegistrationCustomer[]>;
  onBusyChange?:(busy:boolean)=>void;pendingCustomerInput?:CustomerInput|null;onPendingCustomerChange?:(input:CustomerInput|null)=>void
}){
  const [mode,setMode]=useState<'start'|'unknown'>('start'),[target,setTarget]=useState(''),[creating,setCreating]=useState(false)
  const [date,setDate]=useState(''),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false)
  const [busy,setBusy]=useState(false),[customerBusy,setCustomerBusy]=useState(false),[error,setError]=useState('')
  const [added,setAdded]=useState<RegistrationCustomer[]>([])
  const currentOwner=customers.find(c=>c.id===project.customer_id)
  const choices=[...customers.filter(c=>!added.some(a=>a.id===c.id)),...added].filter(c=>c.id!==project.customer_id)
  async function save(){
    if(busy||customerBusy)return
    setError('')
    if(mode==='unknown'&&(!date||!confirmed)){setError('所有が終了した日と確認のチェックを入力してください');return}
    if(candidateOnly&&!target){setError(initialCustomer?'顧客を選択してください':'引継ぎ先の顧客を選択してください');return}
    setBusy(true);onBusyChange?.(true)
    try{await onSave(mode==='unknown'?'unknown':candidateOnly?'candidate':'start',mode==='unknown'?null:target?Number(target):null,mode==='unknown'?date:'',reason.trim()||
      (mode==='unknown'?'所有終了を確認。新所有者の氏名は未確認':candidateOnly?'引継ぎ先の顧客を選択':'既存発電所の引継ぎ見込みを登録'))}
    catch(e){setError(errorDetail(e)||formErrorText(e))}finally{setBusy(false);onBusyChange?.(false)}
  }
  return <div className="standard-editor ownership-transfer-shell ownership-workflow-panel">
    {!initialCustomer&&<div className="ownership-workflow-summary">
      <h3>{candidateOnly?'引継ぎ先を設定':project.plant_name||project.project_name}</h3>
      <p>現在の所有者：{currentOwner?customerDisplayName(currentOwner):'未確認'}</p>
    </div>}
    {!candidateOnly&&<div className="ownership-workflow-options">
      <button type="button" className={`btn ${mode==='start'?'btn-main':'btn-sub'}`} disabled={busy||customerBusy} onClick={()=>{setMode('start');setError('')}}>見込み管理へ戻す</button>
      {onDirect&&<button type="button" className="btn btn-sub" disabled={busy||customerBusy} onClick={onDirect}>決まった所有者へ直接変更</button>}
      {project.customer_id!=null&&<button type="button" className={`btn ${mode==='unknown'?'btn-main':'btn-sub'}`} disabled={busy||customerBusy} onClick={()=>{setMode('unknown');setCreating(false);setError('')}}>所有者が変わったが名前が分からない</button>}
    </div>}
    <FormError message={error}/>
    <fieldset className="ownership-workflow-fields" disabled={busy||customerBusy} style={{border:0,padding:0,minWidth:0}}>
      {mode==='start'?<>
        <p>{initialCustomer?'この新規案件の顧客を設定します。請求・入金記録は変更しません。':candidateOnly?'顧客を選んだだけでは、所有者や請求先は変わりません。':'現在の所有者・保守・請求は変えず、同じ発電所の見込みを登録します。'}</p>
        <CustomerPicker label={initialCustomer?'顧客':'次の所有者'} value={target} onChange={setTarget} customers={choices} emptyLabel={initialCustomer?'顧客を選択してください':'引継ぎ先未定'} disabled={creating}/>
        <div className="ownership-workflow-customer-actions">
        {!candidateOnly&&<button type="button" className="btn btn-sub btn-sm" onClick={()=>setTarget('')}>引継ぎ先未定にする</button>}
        <button type="button" className="btn btn-sub btn-sm" onClick={()=>setCreating(!creating)}>{creating?'登録欄を閉じる':'＋ 新規顧客を登録'}</button>
        </div>
      </>:<>
        <p>現在の所有者を「未確認」にし、前の所有者を履歴に残します。保守予定や保存済みの請求は消しません。</p>
        <p>保存済み予定の請求先は変えません。変更する回は「請求詳細」で指定してください。</p>
        <label className="form-label">前の所有者の所有が終了した日<input className="form-input" type="date" min="2000-01-01" max={new Date().toLocaleDateString('sv-SE')} value={date} onChange={e=>setDate(e.target.value)}/></label>
        <label className="ownership-transfer-check"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>売却などで所有者が変わったことを確認しました（保守契約の終了とは別です）</span></label>
      </>}
      {!initialCustomer&&<label className="form-label ownership-workflow-memo">メモ（任意）<textarea className="form-input" rows={2} value={reason} onChange={e=>setReason(e.target.value)}/></label>}
      <button type="button" className="btn btn-main" disabled={creating||customerBusy} onClick={()=>void save()}>{busy?'保存中…':initialCustomer?'顧客を設定':mode==='unknown'?'所有者を未確認として保存':candidateOnly?'引継ぎ先を設定':'引継ぎの見込みを登録'}</button>
    </fieldset>
    {mode==='start'&&creating&&<CustomerRegistration initialCustomer={initialCustomer} customers={choices} currentOwnerId={project.customer_id??0}
      onCreate={onCreateCustomer} onReload={onReloadCustomers} pendingInput={pendingCustomerInput} onPendingChange={onPendingCustomerChange}
      onSelect={customer=>{setAdded(list=>[...list.filter(c=>c.id!==customer.id),customer]);setTarget(String(customer.id));setCreating(false);onPendingCustomerChange?.(null)}}
      onCancel={()=>setCreating(false)} onBusyChange={value=>{setCustomerBusy(value);onBusyChange?.(value)}}/>}
  </div>
}
