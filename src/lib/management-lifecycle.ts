import {isBillingDate} from './billing-unit'
import type {TransferBillingUnit} from './ownership-billing-plan'
import type {Contract} from '../types'
import {BILLING_ITEMS} from './billing'
export type ManagementEvent={id:number;project_id:number;scope:'maintenance'|'all';action:'end'|'resume';effective_date:string;reason:string}
export type ManagementChoice={unitId:string;expectedRevision:number;action:'keep'|'amount'|'cancel';amount:number|null}
export type ManagementRequest={projectId:number;expectedLast:number;scope:ManagementEvent['scope'];action:ManagementEvent['action'];date:string;choices:ManagementChoice[];reason:string}
export function managementActiveOn(events:readonly ManagementEvent[],project:number,scope:ManagementEvent['scope'],date:string){
  if(!isBillingDate(date))throw Error('日付を確認してください')
  const last=events.filter(e=>e.project_id===project&&e.scope===scope&&(e.effective_date<date||e.effective_date===date&&e.action==='resume'))
    .sort((a,b)=>b.effective_date.localeCompare(a.effective_date)||b.id-a.id)[0]
  return !last||last.action==='resume'
}
export function managementEventFromStorage(row:Record<string,unknown>):ManagementEvent{
  if(!Number.isSafeInteger(row.id)||Number(row.id)<=0||!Number.isSafeInteger(row.project_id)||Number(row.project_id)<=0
    ||!['maintenance','all'].includes(String(row.scope))||!['end','resume'].includes(String(row.action))
    ||typeof row.effective_date!=='string'||!isBillingDate(row.effective_date)||typeof row.reason!=='string')throw Error('管理の終了・再開履歴を確認できません')
  return row as ManagementEvent
}
/** Effective fee eligibility, not a change to contract values or historical occurrence amounts. */
export function managementBillingContract(contract:Contract,events:readonly ManagementEvent[],date:string):Contract{
  if(!managementActiveOn(events,contract.project_id,'all',date))return {...contract,billing_item_flags:Object.fromEntries(BILLING_ITEMS.map(i=>[i.key,false]))}
  if(!managementActiveOn(events,contract.project_id,'maintenance',date))return {...contract,billing_item_flags:{...contract.billing_item_flags,annual_maintenance:false}}
  return contract
}
export function validateManagementRequest(r:ManagementRequest,events:readonly ManagementEvent[],units:readonly TransferBillingUnit[]){
  if(!['maintenance','all'].includes(r.scope)||!['end','resume'].includes(r.action)||!isBillingDate(r.date)||r.date<'2000-01-01'||r.date>'2200-12-31'||!r.reason.trim())throw Error('対象・日付・備考を入力してください')
  const own=events.filter(e=>e.project_id===r.projectId)
  if(Math.max(0,...own.map(e=>e.id))!==r.expectedLast)throw Error('履歴が更新されています')
  const prior=own.filter(e=>e.scope===r.scope).sort((a,b)=>b.effective_date.localeCompare(a.effective_date)||b.id-a.id)[0]
  if(!prior&&r.action==='resume'||prior?.action===r.action)throw Error('現在の終了・再開状態を確認してください')
  if(prior&&r.date<=prior.effective_date)throw Error('前回より後の日付を指定してください')
  const plans=units.filter(u=>u.projectId===r.projectId&&u.lifecycle==='planned')
  if(plans.length!==r.choices.length||new Set(r.choices.map(c=>c.unitId)).size!==r.choices.length)throw Error('予定の全件を確認してください')
  for(const c of r.choices){
    const u=plans.find(u=>u.id===c.unitId)
    if(!u||u.revision!==c.expectedRevision)throw Error('予定が更新されています')
    if(!['keep','amount','cancel'].includes(c.action))throw Error('各回の扱いを選択してください')
    if(c.action!=='keep'&&(u.collectionState!=='pending'||u.issuedOn||u.receivedOn||u.frozenAt))throw Error('実績・振替不能の回は変更できません')
    if(c.action==='amount'?(c.amount==null||!Number.isSafeInteger(c.amount)||c.amount<0):c.amount!==null)throw Error('変更後の予定額を確認してください')
  }
}
