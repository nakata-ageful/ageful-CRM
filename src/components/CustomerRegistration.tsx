import {useRef,useState} from 'react'
import type {CustomerInput} from '../types'
import {customerChoiceLabel} from '../lib/customer-search'
import {definiteCustomerRejection,emptyCustomerInput,registrationMatches,validateCustomerRegistration,type RegistrationCustomer} from '../lib/customer-registration'

export function CustomerRegistration({customers,currentOwnerId,onCreate,onReload,onSelect,onCancel,onBusyChange,pendingInput,onPendingChange}:{
  customers:readonly RegistrationCustomer[];currentOwnerId:number;onCreate:(input:CustomerInput)=>Promise<RegistrationCustomer>
  onReload:()=>Promise<readonly RegistrationCustomer[]>;onSelect:(customer:RegistrationCustomer,created:boolean)=>void
  onCancel:()=>void;onBusyChange:(busy:boolean)=>void
  pendingInput?:CustomerInput|null;onPendingChange?:(input:CustomerInput|null)=>void
}){
  const [form,setForm]=useState<CustomerInput>(()=>({...pendingInput??emptyCustomerInput})),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [separate,setSeparate]=useState(false),[uncertain,setUncertain]=useState(!!pendingInput),[checked,setChecked]=useState<readonly RegistrationCustomer[]|null>(null)
  const [checkedEmpty,setCheckedEmpty]=useState(false)
  const lock=useRef(false),registered=useRef<RegistrationCustomer|null>(null)
  const matches=registrationMatches(form,checked??customers)
  function change(patch:Partial<CustomerInput>){setForm(f=>({...f,...patch}));setSeparate(false);setError('');setChecked(null)}
  function start(){lock.current=true;setBusy(true);onBusyChange(true);setError('')}
  function finish(){lock.current=false;setBusy(false);onBusyChange(false)}
  async function save(e:React.FormEvent){
    e.preventDefault();if(lock.current||uncertain)return
    let input:CustomerInput
    try{input=validateCustomerRegistration(form);if(matches.length&&!separate)throw Error('既存の顧客を確認してください。別の顧客なら、下の確認欄にチェックしてください')}
    catch(e){setError(e instanceof Error?e.message:String(e));return}
    start()
    try{
      // Keep the successful ID even if a later UI callback fails. No refresh is
      // required between insert and selection; a refresh error cannot re-insert.
      const customer=registered.current??await onCreate(input)
      if(!Number.isSafeInteger(customer.id)||customer.id<=0||customer.id===currentOwnerId)throw Error('登録した顧客のIDを確認できません')
      registered.current=customer;onSelect(customer,true)
    }catch(e){setError(e instanceof Error?e.message:typeof e==='object'&&e&&'message'in e?String(e.message):String(e));if(!definiteCustomerRejection(e)){setUncertain(true);setCheckedEmpty(false);onPendingChange?.(input)}}
    finally{finish()}
  }
  async function check(){
    if(lock.current)return;start()
    try{const list=await onReload();setChecked(list);setCheckedEmpty(!registrationMatches(form,list).length)}
    catch(e){setError(`顧客一覧を確認できませんでした。再登録せず、もう一度「登録結果を確認」を押してください。${e instanceof Error?e.message:''}`)}
    finally{finish()}
  }
  return <section className="ownership-new-customer" aria-label="新規顧客登録">
    <h4>新規顧客登録</h4><p>ここでは顧客だけ登録します。所有者変更は最後の確認で保存するまで行いません。変更を中止しても顧客は残ります。</p>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {uncertain&&<div className="ownership-customer-recovery"><p role="alert">登録結果が未確認です。再登録せず、まず最新の顧客一覧を確認してください。該当する人がいれば、その顧客を選択します。ページを再読み込みする前に「登録結果を確認」を押してください。</p>
      <button type="button" className="btn btn-sub" disabled={busy} onClick={()=>void check()}>登録結果を確認</button>
      {checkedEmpty&&<label><input type="checkbox" disabled={busy} onChange={e=>{if(e.target.checked){setUncertain(false);setCheckedEmpty(false);onPendingChange?.(null)}}}/> 最新の一覧に登録されていないことを確認したので、再登録する</label>}
    </div>}
    <form onSubmit={save}><fieldset disabled={busy||uncertain} style={{border:0,padding:0,minWidth:0}}>
      <div className="form-grid">
        <div className="ownership-customer-types"><button type="button" className={`filter-tab ${!form.is_corporate?'active':''}`} onClick={()=>change({is_corporate:false,company_name:''})}>個人</button><button type="button" className={`filter-tab ${form.is_corporate?'active':''}`} onClick={()=>change({is_corporate:true})}>法人</button></div>
        {form.is_corporate&&<label className="form-label required">会社名<input className="form-input" required value={form.company_name} onChange={e=>change({company_name:e.target.value})}/></label>}
        <label className="form-label required">{form.is_corporate?'担当者名':'顧客名（個人名）'}<input className="form-input" required value={form.name} onChange={e=>change({name:e.target.value})}/></label>
        <label className="form-label">{form.is_corporate?'担当者フリガナ':'フリガナ'}<input className="form-input" value={form.name_kana} onChange={e=>change({name_kana:e.target.value})}/></label>
        <label className="form-label">電話番号<input className="form-input" type="tel" value={form.phone} onChange={e=>change({phone:e.target.value})}/></label>
        <label className="form-label">メールアドレス<input className="form-input" type="email" value={form.email} onChange={e=>change({email:e.target.value})}/></label>
        <label className="form-label">郵便番号<input className="form-input" inputMode="numeric" value={form.postal_code} onChange={e=>{const digits=e.target.value.normalize('NFKC').replace(/\D/g,'').slice(0,7);change({postal_code:digits.length<=3?digits:digits.slice(0,3)+'-'+digits.slice(3)})}}/></label>
        <label className="form-label" style={{gridColumn:'1/-1'}}>住所<input className="form-input" value={form.address} onChange={e=>change({address:e.target.value})}/></label>
        <label className="form-label" style={{gridColumn:'1/-1'}}>備考（任意）<textarea className="form-input" value={form.notes} onChange={e=>change({notes:e.target.value})}/></label>
      </div>
      {!!matches.length&&<label className="ownership-customer-separate"><input type="checkbox" checked={separate} onChange={e=>setSeparate(e.target.checked)}/> 下の既存顧客とは別の顧客として登録する</label>}
      <div className="editor-footer">{!uncertain&&<button type="button" className="btn btn-sub" onClick={onCancel}>登録をやめて戻る</button>}<button type="submit" className="btn btn-main" disabled={!!matches.length&&!separate}>{busy?'登録中…':'顧客を登録して選択'}</button></div>
    </fieldset></form>
    {!!matches.length&&<div className="ownership-customer-matches"><h4>登録済みの候補（{matches.length}件）</h4><p>名前・会社名・連絡先が一致する候補です。同じ人と自動判断しません。</p>
      {matches.map(c=><div key={c.id}><span>{customerChoiceLabel(c)}{c.phone&&` ／ ${c.phone}`}{c.email&&` ／ ${c.email}`}</span>{c.id===currentOwnerId?<small>現在の所有者です</small>:<button className="btn btn-sub btn-sm" type="button" disabled={busy} onClick={()=>onSelect(c,false)}>この顧客を選択</button>}</div>)}
    </div>}
    {uncertain&&<button className="btn btn-sub" type="button" disabled={busy} onClick={onCancel}>登録をやめて戻る</button>}
  </section>
}
