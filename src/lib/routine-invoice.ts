import type {Contract} from '../types'
import type {BillingHistoryData} from '../components/BillingHistorySection'
import type {DetailPlanCandidate} from './billing-detail-plan'
import {validateDetailPlan} from './billing-detail-plan'
import type {MaintenanceScheduleItem} from './maintenance-schedule'
import {isBillingDate,type BillingUnit} from './billing-unit'
import {managementActiveOn} from './management-lifecycle'

export type RoutineInvoiceContext={
  contract:Contract;item:MaintenanceScheduleItem;versions:Record<string,number>;last:number;cycleRevision?:number
}
export type AddRoutineInvoice=(context:RoutineInvoiceContext,item:MaintenanceScheduleItem,reason:string)=>Promise<BillingUnit>

/** Only unambiguous normal occurrences can skip the separate plan-review form.
 * The displayed candidate's identity is retained, never replaced by the detail's next candidate.
 */
export function routineInvoiceContext(contract:Contract,candidate:DetailPlanCandidate,data:BillingHistoryData,today:string):RoutineInvoiceContext|null {
  if(candidate.method!=='invoice'||candidate.reviewReason||!isBillingDate(candidate.date)||candidate.date<today
    ||candidate.amount==null||!candidate.periodStart||!candidate.periodEnd||contract.billing_method!=='請求書'
    ||!data.recipients?.some(r=>r.id===candidate.recipientId)
    ||data.ownershipChangedProjects?.includes(contract.project_id))return null
  const events=data.managementEvents??[],own=data.units.filter(u=>u.projectId===contract.project_id)
  if(!managementActiveOn(events,contract.project_id,'all',candidate.date)
    ||!managementActiveOn(events,contract.project_id,'all',candidate.periodStart)
    ||!managementActiveOn(events,contract.project_id,'maintenance',candidate.date)
    ||events.some(e=>e.project_id===contract.project_id&&e.effective_date>=candidate.periodStart!&&e.effective_date<=candidate.periodEnd!)
    ||own.some(u=>u.scheduledDate===candidate.date))return null
  const item:MaintenanceScheduleItem={...candidate,periodStart:candidate.periodStart,periodEnd:candidate.periodEnd}
  try{validateDetailPlan(item,own,contract.project_id,'通常請求の発行内容を確認',contract.maintenance_start_date,data.cycleRules,contract)}catch{return null}
  // The overview reads contracts(*, annual_records(*)). The exact contract CAS
  // expects the bare row, not that joined child collection.
  const bareContract={...contract}
  delete (bareContract as Contract&{annual_records?:unknown}).annual_records
  return {contract:bareContract,item,versions:Object.fromEntries(own.map(u=>[u.id,u.revision])),
    last:Math.max(0,...events.filter(e=>e.project_id===contract.project_id).map(e=>e.id)),
    ...(data.cycleRulesReady?{cycleRevision:Math.max(0,...(data.cycleRules??[]).filter(r=>r.project_id===contract.project_id).map(r=>r.id))}:{})}
}

export function routineInvoiceKey(projectId:number,item:{date:string;round:number;year?:number;serviceYear?:number}) {
  return `${projectId}:${item.year??item.serviceYear??''}:${item.round}:${item.date}`
}

/** A stale/ambiguous response must never be issued. Validate all reviewed identity fields. */
export function exactRoutinePlan(unit:BillingUnit,context:RoutineInvoiceContext,item:MaintenanceScheduleItem):boolean {
  return Number.isSafeInteger(Number(unit.id))&&Number(unit.id)>0&&unit.projectId===context.contract.project_id
    &&unit.serviceYear===item.year&&unit.roundLabel===`第${item.round}回`&&unit.method==='請求書'
    &&unit.periodStart===item.periodStart&&unit.periodEnd===item.periodEnd&&unit.scheduledDate===item.date
    &&unit.recipientId===item.recipientId&&unit.plannedAmount===item.amount&&unit.lifecycle==='planned'
    &&!unit.issuedOn&&!unit.receivedOn&&unit.frozenAmount===null&&unit.frozenAt===null
}
