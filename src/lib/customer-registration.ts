import type {Customer,CustomerInput} from '../types'
import type {CustomerChoice} from './customer-search'

export type RegistrationCustomer=CustomerChoice&Partial<Pick<Customer,'email'|'phone'|'is_corporate'>>
export const emptyCustomerInput:CustomerInput={name:'',name_kana:'',company_name:'',is_corporate:false,email:'',phone:'',postal_code:'',address:'',notes:''}
const normalize=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ja').replace(/\s+/g,'')
const phoneDigits=(value:string)=>value.normalize('NFKC').replace(/\D/g,'')
export function validateCustomerRegistration(form:CustomerInput):CustomerInput{
  const input=Object.fromEntries(Object.entries(form).map(([k,v])=>[k,typeof v==='string'?v.trim():v])) as CustomerInput
  if(!input.name)throw Error(input.is_corporate?'担当者名は必須です':'顧客名は必須です')
  if(input.is_corporate&&!input.company_name)throw Error('会社名は必須です')
  if(input.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))throw Error('メールアドレスの形式を確認してください')
  if(!input.is_corporate)input.company_name=''
  return input
}
/** Suggestions only: never equate people, merge rows or auto-select by name. */
export function registrationMatches(form:CustomerInput,customers:readonly RegistrationCustomer[]):RegistrationCustomer[]{
  const name=normalize(form.name),company=normalize(form.company_name),email=normalize(form.email),phone=phoneDigits(form.phone)
  return customers.filter(c=>!!name&&normalize(c.name)===name
    ||form.is_corporate&&!!company&&normalize(c.company_name??'')===company
    ||!!email&&normalize(c.email??'')===email
    ||!!phone&&phoneDigits(c.phone??'')===phone)
}
export function definiteCustomerRejection(error:unknown):boolean{
  // Explicit input/constraint/permission rejections roll back the insert. Unknown
  // transport/server replies may have committed; do not blindly retry those.
  return !!error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'&&/^(22|23|42)/.test(error.code)
}
