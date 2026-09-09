import {supabase,billingRuntimeEnabled} from './supabase'
import {billingUnitFromStorage} from './billing-unit-storage'
import type {TransferBillingUnit} from './ownership-billing-plan'
import {durableBillingOperation} from './durable-billing-operation'

// Deployment opt-in AND authenticated server readiness. Never silently fall back to old writers.
export {billingRuntimeEnabled}
export type BillingRuntimeSnapshot={units:TransferBillingUnit[];transfers:Record<string,unknown>[];events:Record<string,unknown>[]}
export async function loadBillingRuntime():Promise<BillingRuntimeSnapshot>{
  if(!supabase||!billingRuntimeEnabled)throw Error('新しい請求機能はまだ有効化されていません')
  const {data,error}=await supabase.rpc('billing_runtime_snapshot')
  if(error)throw error
  if(data?.version!==1||data?.ready!==true||!Array.isArray(data.units)||!Array.isArray(data.transfers)||!Array.isArray(data.events))throw Error('請求データの移行・アクセス保護が未完了です。旧画面へは自動で切り替えません')
  const units:TransferBillingUnit[]=data.units.map((row:Record<string,unknown>)=>{
    if(!['pending','succeeded','failed','not_applicable'].includes(String(row.collection_state)))throw Error('振替状態が不正です')
    return {...billingUnitFromStorage(row),collectionState:row.collection_state as TransferBillingUnit['collectionState'],
      periodStart:row.period_start as string|null,periodEnd:row.period_end as string|null,planNote:row.plan_note as string}
  })
  if(new Set(units.map(u=>u.id)).size!==units.length)throw Error('請求回が重複しています')
  return {units,transfers:data.transfers,events:data.events}
}
async function operation<T>(reload:()=>Promise<T>){
  if(!supabase||!billingRuntimeEnabled)throw Error('新しい請求機能は無効です')
  const {data,error}=await supabase.auth.getUser()
  if(error||!data.user)throw Error('ログインが必要です')
  const scope=`${new URL(import.meta.env.VITE_SUPABASE_URL).host}:${data.user.id}`
  return {scope,journal:durableBillingOperation({storage:localStorage,scope,operationId:()=>crypto.randomUUID(),reload,
    definitelyRejected:e=>!!e&&typeof e==='object'&&'code'in e&&['P0001','23514','23503','23502','22P02','22007','22008','42501'].includes(String(e.code)),
    write:async(id,request)=>{const {error}=await supabase!.rpc('billing_runtime_write',{p_key:id,p_request:request});if(error)throw Object.assign(new Error(error.message),{code:error.code})},
  })}
}
export async function saveBillingRuntime<T>(request:Record<string,unknown>|null,reload:()=>Promise<T>){
  if(!navigator.locks)throw Error('安全な保存に対応するブラウザーで開いてください')
  const {scope,journal}=await operation(reload)
  return navigator.locks.request(`ageful.billing:${scope}`,{ifAvailable:true},async lock=>{
    if(!lock)throw Error('別の画面で保存中です。完了後に再確認してください')
    return request?journal.save(request):journal.recover()
  })
}
export async function hasPendingBillingRuntime(){return !!(await operation(async()=>{})).journal.pending()}
