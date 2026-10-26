import {hasSupabaseEnv,supabase} from './supabase'
import {projectStore,customerStore} from './mock-store'
import type {CertificateRequest} from './meti-certificate'
import type {Customer,Project} from '../types'

export class CertificateSaveError extends Error {
  constructor(message:string,readonly uncertain:boolean){super(message)}
}
export async function saveCertificate(request:CertificateRequest):Promise<void>{
  if(hasSupabaseEnv){
    const {data,error}=await supabase!.rpc('meti_certificate_apply',{p_request:request})
    if(error){if(error.code==='PGRST202')throw new CertificateSaveError('PDFの反映機能を準備中です。入力内容を保存せずに閉じてください。',false);throw new CertificateSaveError(error.message,!error.code)}
    if(data?.applied!==true)throw Error('保存結果を確認できませんでした。画面を開き直して登録内容を確認してください。')
    return
  }
  const project=projectStore.getAll().find(p=>p.id===request.projectId)
  if(!project||project.archived_at||project.customer_id!==request.customerId)throw Error('発電所が更新されています。開き直してください。')
  const customer=customerStore.getAll().find(c=>c.id===request.customerId)
  for(const [key,value]of Object.entries(request.before))if((project[key as keyof Project]??null)!==value&&(project[key as keyof Project]??null)!==request.patch[key as keyof typeof request.patch])throw Error('登録内容が更新されています。開き直してください。')
  if(request.updateCustomer&&(!customer||(customer.address!==request.customerBefore&&customer.address!==request.customerAddress)))throw Error('顧客情報が更新されています。開き直してください。')
  projectStore.update(project.id,request.patch)
  if(request.updateCustomer)customerStore.update(customer!.id,{address:request.customerAddress} as Partial<Customer>)
}
