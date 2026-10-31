import {hasSupabaseEnv,supabase} from './supabase'
import {projectStore} from './mock-store'
import type {PowerContractRequest} from './power-contract'
import type {Project} from '../types'
export class PowerContractSaveError extends Error{constructor(message:string,readonly uncertain:boolean){super(message)}}
export async function savePowerContract(request:PowerContractRequest){
 if(hasSupabaseEnv){
  const {data,error}=await supabase!.rpc('power_contract_apply',{p_request:request})
  if(error)throw new PowerContractSaveError(error.code==='PGRST202'?'PDFの保存機能を準備中です。内容を反映せずに閉じてください。':error.message,!error.code)
  if(data?.applied!==true)throw new PowerContractSaveError('保存結果を確認できませんでした。同じ内容で再確認してください。',true)
  return
 }
 const p=projectStore.getAll().find(p=>p.id===request.projectId)
 if(!p||p.archived_at||p.customer_id!==request.customerId)throw new PowerContractSaveError('発電所が更新されています。開き直してください。',false)
 for(const [key,value]of Object.entries(request.before))if((p[key as keyof Project]??null)!==value&&(p[key as keyof Project]??null)!==request.patch[key as keyof typeof request.patch])throw new PowerContractSaveError('登録内容が更新されています。開き直してください。',false)
 projectStore.update(p.id,request.patch)
}
