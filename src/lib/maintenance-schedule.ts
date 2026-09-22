import type {Contract} from '../types'
import type {TransferBillingUnit} from './ownership-billing-plan'
import {maintenancePeriod} from './maintenance-period-label'
import {validateIndividualPeriod,type IndividualPeriod} from './individual-maintenance-period'
import {invoiceAmount} from './billing'
import {managementActiveOn,managementBillingContract,type ManagementEvent} from './management-lifecycle'
export type MaintenanceScheduleItem={year:number;periodStart:string;periodEnd:string;round:number;method:'invoice'|'direct_debit';date:string;recipientId:number;amount:number|null;exclusion?:string}
export function selectedMaintenanceScheduleItems(items:readonly (MaintenanceScheduleItem&{include:boolean})[]):MaintenanceScheduleItem[]{
 return items.filter(item=>item.include).map(item=>({
  year:item.year,periodStart:item.periodStart,periodEnd:item.periodEnd,round:item.round,method:item.method,
  date:item.date,recipientId:item.recipientId,amount:item.amount,
 }))
}
/** Identity is the selected service period, never the year of issue or payment. */
export function maintenanceSchedule(contract:Contract,year:number,recipientId:number,units:readonly TransferBillingUnit[],events:readonly ManagementEvent[],individual?:IndividualPeriod):MaintenanceScheduleItem[]{
 if(!Number.isInteger(year)||year<2000||year>2199||!Number.isSafeInteger(recipientId)||recipientId<1)throw Error('対象保守期間と請求先を確認してください')
 const period=validateIndividualPeriod(individual??maintenancePeriod(contract.maintenance_start_date,year),year,contract.project_id,units,contract.maintenance_start_date)
 const method=contract.billing_method==='請求書'?'invoice':contract.billing_method==='口座振替'?'direct_debit':null
 if(!method)throw Error('請求方法が未設定です')
 const count=contract.billing_count??(method==='direct_debit'?12:contract.billing_schedule_days?.length)
 if(!count||!Number.isInteger(count)||count<1||count>96)throw Error('年間請求回数を確認してください')
 const own=units.filter(u=>u.projectId===contract.project_id&&u.serviceYear===year)
 const changes=events.filter(e=>e.project_id===contract.project_id&&e.effective_date>=period.periodStart&&e.effective_date<=period.periodEnd)
 const active=managementActiveOn(events,contract.project_id,'all',period.periodStart)||changes.some(e=>e.scope==='all'&&e.action==='resume')
 const effective=managementBillingContract(contract,events,period.periodStart)
 return Array.from({length:count},(_,i)=>{
  const round=i+1,existing=own.find(u=>u.roundLabel===`第${round}回`||u.roundLabel==='保存済み単回記録'||u.roundLabel.endsWith('月分'))
  const exclusion=!active?'対象保守期間の開始時点では全取引終了です。再開後の期間を確認してください':existing?
   existing.roundLabel===`第${round}回`?`この保守期間の第${round}回は保存済みです${existing.lifecycle==='cancelled'?'（取りやめ済み）':''}`:'この保守期間の保存記録は回の対応確認が必要です':undefined
  return {...period,year,round,method,date:'',recipientId,amount:method==='invoice'&&!changes.length?invoiceAmount(effective,round,count):null,exclusion}
 })
}
