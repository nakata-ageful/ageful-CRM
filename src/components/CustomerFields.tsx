import type {CustomerInput} from '../types'

/** Shared by list, customer detail and ownership registration. Layout order is also DOM/tab order. */
export function CustomerFields({value,onChange}:{value:CustomerInput;onChange:(patch:Partial<CustomerInput>)=>void}){
  return <div className="customer-fields-grid">
    <label className="form-label">種別<select className="form-input" value={value.is_corporate?'corporate':'individual'} onChange={e=>onChange(e.target.value==='corporate'?{is_corporate:true}:{is_corporate:false,company_name:'',company_name_kana:''})}><option value="individual">個人</option><option value="corporate">法人</option></select></label>
    {value.is_corporate&&<>
      <label className="form-label required">会社名<input className="form-input" required value={value.company_name} onChange={e=>onChange({company_name:e.target.value})} placeholder="株式会社〇〇"/></label>
      <label className="form-label">会社名フリガナ<input className="form-input" value={value.company_name_kana??''} onChange={e=>onChange({company_name_kana:e.target.value})} placeholder="カブシキガイシャ〇〇"/></label>
    </>}
    <label className="form-label customer-row-start required">{value.is_corporate?'担当者名':'顧客名（個人名）'}<input className="form-input" required value={value.name} onChange={e=>onChange({name:e.target.value})}/></label>
    <label className="form-label customer-span-two">{value.is_corporate?'担当者フリガナ':'フリガナ'}<input className="form-input" value={value.name_kana} onChange={e=>onChange({name_kana:e.target.value})}/></label>
    <label className="form-label customer-row-start">電話番号<input className="form-input" type="tel" value={value.phone} onChange={e=>onChange({phone:e.target.value})}/></label>
    <label className="form-label customer-span-two">メールアドレス<input className="form-input" type="email" value={value.email} onChange={e=>onChange({email:e.target.value})}/></label>
    <label className="form-label customer-row-start">郵便番号<input className="form-input" inputMode="numeric" placeholder="000-0000" value={value.postal_code} onChange={e=>{const digits=e.target.value.normalize('NFKC').replace(/\D/g,'').slice(0,7);onChange({postal_code:digits.length<=3?digits:digits.slice(0,3)+'-'+digits.slice(3)})}}/></label>
    <label className="form-label customer-span-two">住所<input className="form-input" value={value.address} onChange={e=>onChange({address:e.target.value})}/></label>
    <label className="form-label customer-full-row">備考<textarea className="form-input" rows={3} value={value.notes} onChange={e=>onChange({notes:e.target.value})}/></label>
  </div>
}
