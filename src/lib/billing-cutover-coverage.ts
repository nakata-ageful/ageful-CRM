import type {BillingRow} from '../types'
import {computeUpcomingInvoices,toIsoDate,withdrawalAmount,invoiceAmount} from './billing'
import {isBillingDate} from './billing-unit'
import {managementActiveOn,type ManagementEvent} from './management-lifecycle'
import type {BillingUnit} from './billing-unit'
import {debitScheduleReminder} from './debit-schedule-reminder'

type StoredUnit={project_id:number;recipient_customer_id:number;collection_method:string;scheduled_date:string|null;lifecycle:string;planned_amount:number|null}
export type CoverageCandidate={projectId:number;recipientId:number;method:'invoice'|'direct_debit';date:string;round:number;amount:number;status:'missing'|'matches'|'review';reason?:string}
export type ScheduleSetupItem=CoverageCandidate&{projectName:string;customerName:string}
export type ScheduleSetupIssue={projectId:number;projectName:string;reason:string}
/** Read-only pre-cutover comparison. Calculated amounts are proposals, NEVER historical actuals.
 * Does not authorize activation, create records or decide ambiguous date/round correspondence.
 */
export function inspectFutureBillingCoverage(rows:readonly BillingRow[],recipients:ReadonlyMap<number,number>,units:readonly StoredUnit[],startMonth:string,months:number,managementEvents:readonly ManagementEvent[]=[]){
  if(!/^\d{4}-\d{2}$/.test(startMonth)||!isBillingDate(`${startMonth}-01`)||!Number.isInteger(months)||months<1||months>24)throw Error('比較対象の年月と期間を確認してください')
  const [year,month]=startMonth.split('-').map(Number),candidates:CoverageCandidate[]=[],issues:{projectId:number;reason:string}[]=[]
  for(const row of rows){
    const recipientId=recipients.get(row.project_id),c=row.contract
    if(!c)continue
    if(!recipientId){issues.push({projectId:row.project_id,reason:'請求先が不明'});continue}
    if(!['請求書','口座振替'].includes(c.billing_method??'')){issues.push({projectId:row.project_id,reason:'請求方法が未設定'});continue}
    const days=c.billing_schedule_days??[]
    if(!days.length){issues.push({projectId:row.project_id,reason:'請求予定日が未設定'});continue}
    if(c.billing_method==='口座振替'&&days.length!==1){issues.push({projectId:row.project_id,reason:'振替日の設定が複数ある'});continue}
    for(let offset=0;offset<months;offset++){
      const date=new Date(Date.UTC(year,month-1+offset,1)),y=date.getUTCFullYear(),m=date.getUTCMonth()+1
      const expected=c.billing_method==='請求書'
        ?computeUpcomingInvoices([row],new Map([[m,y]])).map(i=>({date:i.scheduledDateISO,round:i.round,amount:i.amount}))
        :[{date:toIsoDate(y,days[0],m),round:m,amount:withdrawalAmount(c,m)}]
      for(const item of expected){
        if(!item.date||!isBillingDate(item.date)||Number(item.date.slice(5,7))!==m||!Number.isSafeInteger(item.amount)||item.amount<0){issues.push({projectId:row.project_id,reason:'予定日または計算額が不正'});continue}
        const method=c.billing_method==='請求書'?'invoice':'direct_debit'
        if(!managementActiveOn(managementEvents,row.project_id,'all',item.date))continue
        const maintenanceEnded=!managementActiveOn(managementEvents,row.project_id,'maintenance',item.date)
        let amount=item.amount
        if(maintenanceEnded){
          const withoutMaintenance={...c,billing_item_flags:{...c.billing_item_flags,annual_maintenance:false}}
          amount=method==='invoice'?invoiceAmount(withoutMaintenance,item.round,days.length):withdrawalAmount(withoutMaintenance,m)
        }
        const matching=units.filter(u=>u.project_id===row.project_id&&u.scheduled_date===item.date)
        let status:CoverageCandidate['status']='missing',reason:string|undefined
        if(matching.length){
          const u=matching[0]
          if(matching.length===1&&u.lifecycle==='planned'&&u.collection_method===method&&u.recipient_customer_id===recipientId&&u.planned_amount===amount)status='matches'
          else {status='review';reason='同日の保存記録と予定の金額・方法・請求先・回の対応を照合'}
        }
        if(maintenanceEnded){status='review';reason='保守終了後の対象費目・前払い期間・個別金額を確認してください（自動日割りなし）'}
        candidates.push({projectId:row.project_id,recipientId,method,date:item.date,round:item.round,amount,status,reason})
      }
    }
  }
  // Identical dates are not sufficient evidence to match separate installment rounds.
  for(const c of candidates)if(candidates.filter(other=>other.projectId===c.projectId&&other.date===c.date).length>1){c.status='review';c.reason='同日に複数回があり、回の対応確認が必要'}
  const undated=units.filter(u=>u.lifecycle==='planned'&&!u.scheduled_date).length
  return {startMonth,months,candidates,issues,undatedSavedPlans:undated,
    summary:{expected:candidates.length,matching:candidates.filter(c=>c.status==='matches').length,missing:candidates.filter(c=>c.status==='missing').length,review:candidates.filter(c=>c.status==='review').length},
    // A bounded comparison is not proof of perpetual schedule coverage.
    authorizesCutover:false as const}
}

/** Keeps legacy-visible near-term reminders visible during per-project schedule setup.
 * Read-only: never creates a ledger occurrence or authorizes cutover by itself.
 */
export function legacyScheduleSetupItems(rows:readonly BillingRow[],recipients:ReadonlyMap<number,number>,units:readonly BillingUnit[],today:string):ScheduleSetupItem[]{
 return legacyScheduleSetupReview(rows,recipients,units,today).items
}

export function legacyScheduleSetupReview(rows:readonly BillingRow[],recipients:ReadonlyMap<number,number>,units:readonly BillingUnit[],today:string):{
 items:ScheduleSetupItem[];issues:ScheduleSetupIssue[]
}{
 if(!isBillingDate(today))throw Error('集計日が不正です')
 const startMonth=today.slice(0,7)
 const unsafe=rows.filter(r=>(r.contract_count??(r.contract?1:0))!==1)
 const safe=rows.filter(r=>!unsafe.includes(r))
 const stored:StoredUnit[]=units.map((u):StoredUnit=>({project_id:u.projectId,recipient_customer_id:u.recipientId??0,
  collection_method:u.method==='請求書'?'invoice':'direct_debit',scheduled_date:u.scheduledDate,lifecycle:u.lifecycle,planned_amount:u.plannedAmount??null}))
 const coverage=inspectFutureBillingCoverage(safe,recipients,stored,startMonth,3)
 const items=coverage.candidates.filter(c=>c.status==='missing'&&(c.method==='invoice'||c.date.startsWith(startMonth)))
  .filter(c=>c.method!=='direct_debit'||debitScheduleReminder(safe.find(r=>r.project_id===c.projectId)!,today))
  .map(c=>{const row=safe.find(r=>r.project_id===c.projectId)!;return {...c,projectName:row.project_name,customerName:row.customer_name}})
  .sort((a,b)=>a.date.localeCompare(b.date)||a.projectId-b.projectId)
 const issues=[...unsafe.map(row=>({projectId:row.project_id,projectName:row.project_name,reason:'契約が複数または未設定のため、請求に使う契約の確認が必要です'})),
  ...coverage.issues.map(issue=>{const row=safe.find(r=>r.project_id===issue.projectId)!;return {...issue,projectName:row.project_name}})]
 return {items,issues}
}
