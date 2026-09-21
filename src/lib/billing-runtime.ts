import {supabase,billingRuntimeEnabled,billingRuntimePreview} from './supabase'
import {billingUnitFromStorage} from './billing-unit-storage'
import type {TransferBillingUnit} from './ownership-billing-plan'
import {durableBillingOperation} from './durable-billing-operation'
import {managementEventFromStorage,type ManagementEvent} from './management-lifecycle'

// Deployment opt-in AND authenticated server readiness. Never silently fall back to old writers.
export {billingRuntimeEnabled}
export type BillingRuntimeSnapshot={units:TransferBillingUnit[];transfers:Record<string,unknown>[];events:Record<string,unknown>[];managementEvents:ManagementEvent[]}
export async function loadBillingRuntime():Promise<BillingRuntimeSnapshot>{
  if(billingRuntimePreview)return previewSnapshot()
  if(!supabase||!billingRuntimeEnabled)throw Error('新しい請求機能はまだ有効化されていません')
  const {data,error}=await supabase.rpc('billing_runtime_snapshot')
  if(error)throw error
  if(data?.version!==2||data?.ready!==true||!Array.isArray(data.units)||!Array.isArray(data.transfers)||!Array.isArray(data.events)||!Array.isArray(data.management_events))throw Error('請求データの移行・アクセス保護が未完了です。旧画面へは自動で切り替えません')
  const units:TransferBillingUnit[]=data.units.map((row:Record<string,unknown>)=>{
    if(!['pending','succeeded','failed','not_applicable'].includes(String(row.collection_state)))throw Error('振替状態が不正です')
    return {...billingUnitFromStorage(row),collectionState:row.collection_state as TransferBillingUnit['collectionState'],
      periodStart:row.period_start as string|null,periodEnd:row.period_end as string|null,planNote:row.plan_note as string}
  })
  if(new Set(units.map(u=>u.id)).size!==units.length)throw Error('請求回が重複しています')
  return {units,transfers:data.transfers,events:data.events,managementEvents:data.management_events.map(managementEventFromStorage)}
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
  if(billingRuntimePreview)throw Error('確認用モードでは保存しません')
  if(!navigator.locks)throw Error('安全な保存に対応するブラウザーで開いてください')
  const {scope,journal}=await operation(reload)
  return navigator.locks.request(`ageful.billing:${scope}`,{ifAvailable:true},async lock=>{
    if(!lock)throw Error('別の画面で保存中です。完了後に再確認してください')
    return request?journal.save(request):journal.recover()
  })
}
export async function hasPendingBillingRuntime(){return billingRuntimePreview?false:!!(await operation(async()=>{})).journal.pending()}

function previewSnapshot():BillingRuntimeSnapshot{
 const units:TransferBillingUnit[]=[
  {id:'preview-paid-a',projectId:1,serviceYear:2025,roundLabel:'第1回',method:'請求書',scheduledDate:'2025-12-01',issuedOn:'2025-12-01',paymentDueOn:'2025-12-31',receivedOn:'2025-12-20',recipientId:7,lifecycle:'received',collectionState:'succeeded',frozenAmount:165000,frozenLineItems:[{name:'保守料',amount:165000}],frozenAt:'2025-12-01T00:00:00.000Z',plannedAmount:null,revision:0,periodStart:'2025-01-01',periodEnd:'2025-12-31',planNote:'確認用：所有者変更前の入金済み'},
  {id:'preview-plan-b',projectId:1,serviceYear:2026,roundLabel:'第2回',method:'請求書',scheduledDate:'2026-12-01',issuedOn:null,paymentDueOn:null,receivedOn:null,recipientId:2,lifecycle:'planned',collectionState:'pending',frozenAmount:null,frozenLineItems:null,frozenAt:null,plannedAmount:165000,revision:0,periodStart:'2026-01-01',periodEnd:'2026-12-31',planNote:'確認用：次回から新所有者'},
  {id:'preview-debit-invoice',projectId:4,serviceYear:2026,roundLabel:'9月分',method:'請求書',scheduledDate:'2026-09-15',issuedOn:'2026-09-17',paymentDueOn:null,receivedOn:null,recipientId:2,lifecycle:'issued',collectionState:'pending',frozenAmount:48270,frozenLineItems:[{name:'保守料',amount:27940},{name:'土地代',amount:20000},{name:'手数料',amount:330}],frozenAt:'2026-09-17T00:00:00.000Z',plannedAmount:null,revision:0,periodStart:null,periodEnd:null,planNote:'確認用：口座振替不能後に請求書へ切替'},
 ]
 return {units,transfers:[{id:1,project_id:1,from_customer_id:7,to_customer_id:2,effective_date:'2026-08-15'}],events:[],managementEvents:[]}
}
