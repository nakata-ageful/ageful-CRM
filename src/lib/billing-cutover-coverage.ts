import type {BillingRow} from '../types'
import {annualBillableTotalInc,computeUpcomingInvoices,toIsoDate,withdrawalAmount,invoiceAmount} from './billing'
import {isBillingDate} from './billing-unit'
import {managementActiveOn,type ManagementEvent} from './management-lifecycle'
import type {BillingUnit} from './billing-unit'
import {debitScheduleReminder} from './debit-schedule-reminder'
import {cycleRuleForYear,cycleCompatibility,futureMaintenancePeriod,type BillingCycleRule} from './billing-cycle'
import {inspectCandidatePeriod} from './billing-period-coverage'

type StoredUnit={project_id:number;service_year?:number;recipient_customer_id:number;recipient_source?:string;collection_method:string;scheduled_date:string|null;lifecycle:string;planned_amount:number|null;round_number?:number|null;service_month?:number|null;period_start?:string|null;period_end?:string|null;removed_at?:string|null}
export type CoverageCandidate={projectId:number;recipientId:number;method:'invoice'|'direct_debit';date:string;round:number;amount:number;status:'missing'|'matches'|'handled'|'review'|'overdue';reason?:string;serviceYear?:number;periodStart?:string;periodEnd?:string}
export type ScheduleSetupItem=CoverageCandidate&{projectName:string;customerName:string}
export type ScheduleSetupIssue={
  projectId:number;projectName:string;reason:string
  category:'no_billing_candidate'|'action_required'
  code:'contract_count'|'method_missing_without_amount'|'method_missing_with_amount'|'schedule_missing_with_amount'|'other'
}
/** Read-only pre-cutover comparison. Calculated amounts are proposals, NEVER historical actuals.
 * Does not authorize activation, create records or decide ambiguous date/round correspondence.
 */
export function inspectFutureBillingCoverage(rows:readonly BillingRow[],recipients:ReadonlyMap<number,number>,units:readonly StoredUnit[],startMonth:string,months:number,managementEvents:readonly ManagementEvent[]=[],rules:readonly BillingCycleRule[]=[]){
  if(!/^\d{4}-\d{2}$/.test(startMonth)||!isBillingDate(`${startMonth}-01`)||!Number.isInteger(months)||months<1||months>24)throw Error('比較対象の年月と期間を確認してください')
  const [year,month]=startMonth.split('-').map(Number),candidates:CoverageCandidate[]=[],issues:{projectId:number;reason:string}[]=[]
  for(const row of rows){
    const recipientId=recipients.get(row.project_id),c=row.contract
    if(!c)continue
    if(!recipientId){issues.push({projectId:row.project_id,reason:'請求先が不明'});continue}
    if(!['請求書','口座振替'].includes(c.billing_method??'')){issues.push({projectId:row.project_id,reason:'請求方法が未設定'});continue}
    const days=c.billing_schedule_days??[]
    const own=units.filter(u=>u.project_id===row.project_id)
    const periodEvidence=own.filter(u=>!u.removed_at&&u.service_year!=null).map(u=>({projectId:u.project_id,serviceYear:u.service_year!,method:u.collection_method==='invoice'?'請求書':'口座振替',lifecycle:u.lifecycle,periodStart:u.period_start,periodEnd:u.period_end}))
    const hasCycle=rules.some(r=>r.project_id===row.project_id&&r.mode==='calendar_prepaid')
    if(!days.length&&!hasCycle){issues.push({projectId:row.project_id,reason:'請求予定日が未設定'});continue}
    if(c.billing_method==='口座振替'&&days.length!==1){issues.push({projectId:row.project_id,reason:'振替日の設定が複数ある'});continue}
    for(let offset=0;offset<months;offset++){
      const date=new Date(Date.UTC(year,month-1+offset,1)),y=date.getUTCFullYear(),m=date.getUTCMonth()+1
      const prepaid=cycleRuleForYear(rules,row.project_id,y+1)?.mode==='calendar_prepaid'
      if(prepaid&&!cycleCompatibility(c)){issues.push({projectId:row.project_id,reason:'繰り返し設定は「請求書・年1回」です。請求情報と設定を確認してください'});break}
      if(!prepaid&&!days.length){issues.push({projectId:row.project_id,reason:'請求予定日が未設定'});break}
      const expected:{date:string|null;round:number;amount:number;serviceYear?:number}[]=prepaid
        ?m===12?[{date:`${y}-12-01`,round:1,amount:invoiceAmount(c,1,1),serviceYear:y+1}]:[]
        :c.billing_method==='請求書'
        // The new ledger must decide correspondence. Legacy date-only "handled"
        // records may describe another period, so they cannot suppress this check.
        ?computeUpcomingInvoices([{...row,records:[]}],new Map([[m,y]])).map(i=>({date:i.scheduledDateISO,round:i.round,amount:i.amount}))
        :[{date:toIsoDate(y,days[0],m),round:m,amount:withdrawalAmount(c,m)}]
      for(const item of expected){
        if(!item.date||!isBillingDate(item.date)||Number(item.date.slice(5,7))!==m||!Number.isSafeInteger(item.amount)||item.amount<0){issues.push({projectId:row.project_id,reason:'予定日または計算額が不正'});continue}
        const method=c.billing_method==='請求書'?'invoice':'direct_debit'
        let serviceYear=item.serviceYear,periodStart:string|undefined,periodEnd:string|undefined,periodReason:string|undefined
        if(method==='invoice'){
          try{
            if(serviceYear==null){serviceYear=y;if(item.date<futureMaintenancePeriod(c,y,rules).periodStart)serviceYear--}
            const period=futureMaintenancePeriod(c,serviceYear,rules)
            periodStart=period.periodStart;periodEnd=period.periodEnd
            const assessment=inspectCandidatePeriod(c,serviceYear,period,periodEvidence,rules)
            if(assessment.superseded)continue
            periodReason=assessment.reason
          }catch{serviceYear=item.serviceYear;periodReason='保守期間が未確認です。請求予定は隠さず、登録前に対象期間を確認してください'}
        }
        if(!managementActiveOn(managementEvents,row.project_id,'all',item.date))continue
        // Tombstone identity prevents re-creation of that occurrence only. It is
        // not evidence that another year/round or a long maintenance range was paid.
        let debitYear=y,debitRound=m
        if(method==='direct_debit')try{
          const anchor=futureMaintenancePeriod(c,y,rules)
          if(item.date<anchor.periodStart)debitYear--
          const period=futureMaintenancePeriod(c,debitYear,rules)
          debitRound=(y-debitYear)*12+m-Number(period.periodStart.slice(5,7))+1
        }catch{/* Legacy debit source may have a calendar year rather than a period anchor. */}
        const occurrenceDate=item.date
        if(own.some(u=>u.removed_at&&(method==='invoice'?u.service_year===serviceYear&&u.round_number===item.round
          :u.scheduled_date===occurrenceDate||u.collection_method==='direct_debit'&&u.scheduled_date?.slice(0,7)===occurrenceDate.slice(0,7)
            ||u.service_month===m&&[y,debitYear].includes(u.service_year??0)
            ||u.service_year===debitYear&&u.round_number===debitRound)))continue
        const maintenanceEnded=!managementActiveOn(managementEvents,row.project_id,'maintenance',item.date)
        let amount=item.amount
        if(maintenanceEnded){
          const withoutMaintenance={...c,billing_item_flags:{...c.billing_item_flags,annual_maintenance:false}}
          amount=method==='invoice'?invoiceAmount(withoutMaintenance,item.round,item.serviceYear==null?days.length:1):withdrawalAmount(withoutMaintenance,m)
        }
        const matching=units.filter(u=>!u.removed_at&&u.project_id===row.project_id&&u.scheduled_date===item.date)
        let status:CoverageCandidate['status']='missing',reason:string|undefined
        if(matching.length){
          const u=matching[0]
          const periodMatches=!periodStart||!u.period_start&&!u.period_end&&item.serviceYear==null||u.period_start===periodStart&&u.period_end===periodEnd
          const sameRound=(method==='invoice'?u.round_number===item.round:u.service_month===m)&&(serviceYear==null||u.service_year===serviceYear)&&periodMatches
          if(matching.length===1&&sameRound&&u.collection_method===method&&['fixed','issued','received'].includes(u.lifecycle))status='handled'
          else if(matching.length===1&&sameRound&&u.lifecycle==='planned'&&u.collection_method===method
            &&(u.recipient_customer_id===recipientId||u.recipient_source==='override')&&u.planned_amount===amount)status='matches'
          else {status='review';reason='同日の保存記録と予定の金額・方法・請求先・回の対応を照合'}
        }else if(method==='invoice'){
          // A manually moved date cannot be equated with the contract's calendar
          // date. Keep it visible for human correspondence, but never advertise
          // it as an unsaved new claim that could be charged twice.
          const nearby=units.filter(u=>!u.removed_at&&u.project_id===row.project_id&&u.round_number===item.round
            &&u.scheduled_date&&u.service_year!=null&&(serviceYear==null?[y,y+1].includes(u.service_year):u.service_year===serviceYear)
            &&Math.abs(Date.parse(`${u.scheduled_date}T00:00:00Z`)-Date.parse(`${item.date}T00:00:00Z`))<300*86400000)
          if(nearby.length){status='review';reason='別日に保存された同じ回の可能性があります。保守期間・第何回かを確認してください'}
          else if(serviceYear!=null&&own.some(u=>!u.removed_at&&u.service_year===serviceYear)){
            status='review';reason='同じ保守開始年の保存記録があります。予定日・対象期間・第何回かの対応を確認してください。別の回は自動で請求済みとは扱いません'
          }
        }
        if(method==='invoice'&&serviceYear!=null&&own.some(u=>u.removed_at&&u.service_year===serviceYear&&u.round_number==null)){
          status='review';reason='削除済みの記録の回数が未確認です。別の回は隠しません。「請求詳細」の削除済み記録と、第何回の請求かを照合してください'
        }
        // Old imports with no anchor keep their existing date/round correspondence;
        // any actual overlap overrides "handled" instead of erasing an alert.
        if(periodReason&&periodStart){status='review';reason=periodReason}
        if(method==='invoice'&&status==='missing'&&row.records.length&&
          !computeUpcomingInvoices([row],new Map([[m,y]])).some(i=>i.scheduledDateISO===item.date&&i.round===item.round)){
          status='review';reason='旧形式の請求記録があります。対象の保守期間・回と保存済み請求の対応を確認してください'
        }
        if(maintenanceEnded&&status!=='handled'){status='review';reason='保守終了後の対象費目・前払い期間・個別金額を確認してください（自動日割りなし）'}
        candidates.push({projectId:row.project_id,recipientId,method,date:item.date,round:item.round,amount,status,reason,
          ...(serviceYear==null?{}:{serviceYear}),...(periodStart&&periodEnd?{periodStart,periodEnd}:{})})
      }
    }
  }
  // Identical dates are not sufficient evidence to match separate installment rounds.
  for(const c of candidates)if(candidates.filter(other=>other.projectId===c.projectId&&other.date===c.date).length>1){c.status='review';c.reason='同日に複数回があり、回の対応確認が必要'}
  const undated=units.filter(u=>u.lifecycle==='planned'&&!u.scheduled_date).length
  return {startMonth,months,candidates,issues,undatedSavedPlans:undated,
    summary:{expected:candidates.length,matching:candidates.filter(c=>c.status==='matches').length,handled:candidates.filter(c=>c.status==='handled').length,missing:candidates.filter(c=>c.status==='missing').length,review:candidates.filter(c=>c.status==='review').length},
    // A bounded comparison is not proof of perpetual schedule coverage.
    authorizesCutover:false as const}
}

/** Keeps legacy-visible near-term reminders visible during per-project schedule setup.
 * Read-only: never creates a ledger occurrence or authorizes cutover by itself.
 */
export function legacyScheduleSetupItems(rows:readonly BillingRow[],recipients:ReadonlyMap<number,number>,units:readonly BillingUnit[],today:string,
 cutoverOn?:string,managementEvents:readonly ManagementEvent[]=[],rules:readonly BillingCycleRule[]=[]):ScheduleSetupItem[]{
 return legacyScheduleSetupReview(rows,recipients,units,today,cutoverOn,managementEvents,rules).items
}

export function legacyScheduleSetupReview(rows:readonly BillingRow[],recipients:ReadonlyMap<number,number>,units:readonly BillingUnit[],today:string,
 cutoverOn?:string,managementEvents:readonly ManagementEvent[]=[],rules:readonly BillingCycleRule[]=[]):{
 items:ScheduleSetupItem[];issues:ScheduleSetupIssue[]
}{
 if(!isBillingDate(today))throw Error('集計日が不正です')
 if(cutoverOn&&(!isBillingDate(cutoverOn)||cutoverOn>today))throw Error('切替日が不正です')
 const startMonth=today.slice(0,7)
 const unsafe=rows.filter(r=>(r.contract_count??(r.contract?1:0))!==1)
 const safe=rows.filter(r=>!unsafe.includes(r))
 const stored:StoredUnit[]=units.map((u):StoredUnit=>({project_id:u.projectId,service_year:u.serviceYear,recipient_customer_id:u.recipientId??0,recipient_source:u.recipientSource,
  collection_method:u.method==='請求書'?'invoice':'direct_debit',scheduled_date:u.scheduledDate,lifecycle:u.lifecycle,planned_amount:u.plannedAmount??null,
  round_number:/^第(\d+)回$/.test(u.roundLabel)?Number(u.roundLabel.slice(1,-1)):null,
  service_month:/^\d+月分$/.test(u.roundLabel)?Number(u.roundLabel.slice(0,-2)):null,period_start:u.periodStart,period_end:u.periodEnd,removed_at:u.removedAt}))
 const coverage=inspectFutureBillingCoverage(safe,recipients,stored,startMonth,3,managementEvents,rules)
 const overdue:CoverageCandidate[]=[]
 if(cutoverOn){
  const [fromYear,fromMonth]=cutoverOn.slice(0,7).split('-').map(Number)
  const [toYear,toMonth]=startMonth.split('-').map(Number)
  const elapsed=(toYear-fromYear)*12+toMonth-fromMonth
  for(let offset=0;offset<elapsed;offset+=24){
   const first=new Date(Date.UTC(fromYear,fromMonth-1+offset,1))
   const monthKey=`${first.getUTCFullYear()}-${String(first.getUTCMonth()+1).padStart(2,'0')}`
   const past=inspectFutureBillingCoverage(safe,recipients,stored,monthKey,Math.min(24,elapsed-offset),managementEvents,rules)
   overdue.push(...past.candidates.filter(c=>c.method==='invoice'&&c.date>=cutoverOn&&c.status!=='matches'&&c.status!=='handled'))
  }
 }
 const overdueReason='切替後の請求予定日を過ぎています。未発行か記録漏れか、別日に変更した回がないか確認してください（自動発行なし）'
 const candidates=[...overdue,...coverage.candidates].map(c=>c.method==='invoice'&&c.date<today&&cutoverOn!=null&&c.date>=cutoverOn&&c.status==='missing'
  ?{...c,status:'overdue' as const,reason:overdueReason}:c)
 // A saved row on the expected date is not automatically safe.  Keep amount,
 // method and recipient mismatches visible instead of silently hiding them.
 const items=candidates.filter(c=>c.status!=='matches'&&c.status!=='handled'&&(c.method==='invoice'||c.date.startsWith(startMonth)))
  .filter(c=>c.method!=='direct_debit'||debitScheduleReminder(safe.find(r=>r.project_id===c.projectId)!,today))
  .map(c=>{const row=safe.find(r=>r.project_id===c.projectId)!;return {...c,projectName:row.project_name,customerName:row.customer_name}})
  .sort((a,b)=>a.date.localeCompare(b.date)||a.projectId-b.projectId)
 const issues:ScheduleSetupIssue[]=[...unsafe.map(row=>({projectId:row.project_id,projectName:row.project_name,
   reason:'契約が複数または未設定のため、請求に使う契約の確認が必要です',category:'action_required' as const,code:'contract_count' as const})),
  ...coverage.issues.map(issue=>{const row=safe.find(r=>r.project_id===issue.projectId)!,contract=row.contract
   const hasAmount=annualBillableTotalInc(contract)>0||Object.values(contract?.billing_amount_overrides??{}).some(value=>Number(value)>0)
   if(issue.reason==='請求方法が未設定')return {...issue,projectName:row.project_name,
    category:hasAmount?'action_required' as const:'no_billing_candidate' as const,
    code:hasAmount?'method_missing_with_amount' as const:'method_missing_without_amount' as const,
    reason:hasAmount?'金額はありますが、請求方法が未設定です':'請求方法も請求対象額も未設定です。自社請求なしの候補ですが、まだ確定していません'}
   if(issue.reason==='請求予定日が未設定'&&hasAmount)return {...issue,projectName:row.project_name,category:'action_required' as const,code:'schedule_missing_with_amount' as const,
    reason:'金額はありますが、請求予定日が未設定です'}
   return {...issue,projectName:row.project_name,category:'action_required' as const,code:'other' as const}
  })]
 return {items,issues}
}
