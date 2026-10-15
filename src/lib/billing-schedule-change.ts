import type {Contract} from '../types'
import {parseScheduleDay} from './billing'
import {isActiveBillingUnit,isBillingDate,isEditableInvoicePlan,type BillingUnit} from './billing-unit'
import {futureMaintenancePeriod,cycleInvoiceDate,cycleRuleForYear,type BillingCycleRule} from './billing-cycle'
import type {InvoiceWriteRequest} from './invoice-write-session'
import {detailPlanCandidate} from './billing-detail-plan'
import {managementActiveOn,type ManagementEvent} from './management-lifecycle'

export type ScheduleDateChange={unit:BillingUnit;date:string;period:string;reason?:string}
export type ScheduleDatePreview={year:number;round:number;date:string;period:string;warning?:string;method:'invoice'|'direct_debit'}
export type ScheduleSettingImpact={before:ScheduleDatePreview|null;after:ScheduleDatePreview|null;savedCount:number;plannedCount:number;protectedCount:number;alignedCount:number;warnings:string[]}
export type ScheduleDateReview={changes:ScheduleDateChange[];editable?:ScheduleDateChange[];manual:BillingUnit[];preserved:number;notice:string;impact?:ScheduleSettingImpact}
/** Calculated suggestions require the old schedule to match; exceptions get an
 * empty editable date. The operator always selects the exact saved unit.
 */
export function reviewScheduleDateChanges(before:Contract,after:Contract,units:readonly BillingUnit[],today:string,rules:readonly BillingCycleRule[]=[],events:readonly ManagementEvent[]=[]):ScheduleDateReview|null {
  const oldDays=before.billing_schedule_days??[],newDays=after.billing_schedule_days??[]
  const sameDay=(a:string,b:string)=>JSON.stringify(parseScheduleDay(a))===JSON.stringify(parseScheduleDay(b))
  const scheduleChanged=!(oldDays.length===newDays.length&&oldDays.every((d,i)=>sameDay(d,newDays[i])))
  const settingsChanged=scheduleChanged||before.billing_method!==after.billing_method||before.billing_count!==after.billing_count
  const own=units.filter(u=>u.projectId===before.project_id&&isActiveBillingUnit(u))
  const changes:ScheduleDateChange[]=[],editable:ScheduleDateChange[]=[],manual:BillingUnit[]=[]
  const count=before.billing_count??oldDays.length
  const compatible=before.billing_method==='請求書'&&after.billing_method==='請求書'&&count===(after.billing_count??newDays.length)&&count>0&&oldDays.length===count&&newDays.length===count&&before.maintenance_start_date===after.maintenance_start_date
  const dateFor=(day:string,year:number,start:string)=>{const {month,day:d}=parseScheduleDay(day);if(!month||!d)return null
    const y= `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`<start?year+1:year
    const value=`${y}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    return isBillingDate(value)?value:null}
  for(const u of own.filter(u=>u.lifecycle==='planned')){
    const round=/^第(\d+)回$/.exec(u.roundLabel),i=round?Number(round[1])-1:-1
    let periodLabel=u.periodStart&&u.periodEnd?`${u.periodStart} ～ ${u.periodEnd}`:'保守期間未確認'
    let expectedNew:string|null=null
    try{
      const period=futureMaintenancePeriod(after,u.serviceYear,rules)
      if(!u.periodStart&&!u.periodEnd)periodLabel=`${period.periodStart} ～ ${period.periodEnd}（参考・期間未保存）`
      if(after.billing_method==='請求書')expectedNew=cycleInvoiceDate(after,u.serviceYear,rules)??(i>=0&&i<newDays.length?dateFor(newDays[i],u.serviceYear,period.periodStart):null)
    }catch{/* Manual input never requires inventing a service period. */}
    if(expectedNew&&expectedNew===u.scheduledDate&&u.method===after.billing_method)continue
    if(scheduleChanged&&compatible&&i>=0&&i<count&&sameDay(oldDays[i],newDays[i])&&expectedNew===u.scheduledDate)continue
    try{
      if(!scheduleChanged||!compatible||!isEditableInvoicePlan(u)||u.frozenLineItems!==null||!isBillingDate(today)||!u.scheduledDate||u.scheduledDate<today||i<0||i>=count||!Number.isSafeInteger(Number(u.id))||Number(u.id)<=0||cycleRuleForYear(rules,before.project_id,u.serviceYear)?.mode==='calendar_prepaid')throw Error('manual')
      const period=futureMaintenancePeriod(before,u.serviceYear,rules)
      if((u.periodStart||u.periodEnd)&&(u.periodStart!==period.periodStart||u.periodEnd!==period.periodEnd))throw Error('manual')
      const oldDate=dateFor(oldDays[i],u.serviceYear,period.periodStart),newDate=dateFor(newDays[i],u.serviceYear,period.periodStart)
      if(!oldDate||oldDate!==u.scheduledDate||!newDate||newDate<today||newDate===oldDate)throw Error('manual')
      if(u.paymentDueOn&&u.paymentDueOn<newDate)throw Error('manual')
      changes.push({unit:structuredClone(u),date:newDate,period:`${period.periodStart} ～ ${period.periodEnd}${!u.periodStart?'（参考・期間未保存）':''}`})
    }catch{
      if(isEditableInvoicePlan(u)&&u.frozenLineItems===null&&Number.isSafeInteger(Number(u.id))&&Number(u.id)>0){
        const reason=!u.scheduledDate?'請求予定日が未登録です。':u.scheduledDate<today?'期限を過ぎた未発行予定です。':cycleRuleForYear(rules,before.project_id,u.serviceYear)?.mode==='calendar_prepaid'?'前年12月請求の繰り返し設定があります。この回だけを変更します。':!compatible?'基本設定から日付を決められないため、変更日を入力してください。':'基本設定と日付・期間が異なる予定です。'
        editable.push({unit:structuredClone(u),date:'',period:periodLabel,reason})
      }else if(settingsChanged)manual.push(structuredClone(u))
    }
  }
  changes.sort((a,b)=>a.unit.scheduledDate!.localeCompare(b.unit.scheduledDate!)||a.unit.id.localeCompare(b.unit.id))
  if(!settingsChanged&&!editable.length)return null
  // Use the same read-only candidate selector as Billing Detail, including paid,
  // cancelled and removed records. Never create a new occurrence in this review.
  const preview=(contract:Contract):ScheduleDatePreview|null=>{
    try{const c=detailPlanCandidate(contract,0,units,today,events,rules);return c?{year:c.year,round:c.round,date:c.date,method:c.method,period:c.periodStart&&c.periodEnd?`${c.periodStart} ～ ${c.periodEnd}`:'保守期間未登録',warning:[c.reviewReason,!c.periodStart?'「保守情報」で保守開始日を確認してください。':null,!c.date?'予定日が未登録です。「編集に戻る」から入力してください。':null,c.amount===null?'保守期間中に管理の終了・再開があります。請求する期間・金額を「請求詳細」で確認してください。':null].filter(Boolean).join(' ')||undefined}:null}catch{return null}
  }
  const nextBefore=preview(before),nextAfter=preview(after),warnings:string[]=[]
  const prepaid=nextAfter&&cycleRuleForYear(rules,after.project_id,nextAfter.year)?.mode==='calendar_prepaid'
  if(prepaid)warnings.push('「前年12月1日請求」が優先されるため、予定は12月1日のままです。「繰り返し設定を変更」で確認してください。')
  if(!nextAfter)warnings.push('表示できる未登録の予定がありません。「請求詳細」と「管理設定」で保守期間・請求方法・管理の継続状況を確認してください。')
  if(nextAfter?.warning)warnings.push(nextAfter.warning)
  if(nextAfter?.date&&!managementActiveOn(events,after.project_id,'all',nextAfter.date))warnings.push('この予定日時点では、すべての取引が終了しています。この日付で請求する内容があるか「管理設定」と「請求詳細」で確認してください。')
  const planned=own.filter(u=>u.lifecycle==='planned')
  return {changes,editable,manual,preserved:own.length-changes.length-editable.length-manual.length,notice:compatible?'':'登録済みの予定は日付を入力して変更します。口座振替は「請求詳細」で確認してください。',impact:{before:nextBefore,after:nextAfter,savedCount:own.length,plannedCount:planned.length,protectedCount:own.filter(u=>u.lifecycle==='issued'||u.lifecycle==='received').length,alignedCount:planned.length-changes.length-editable.length-manual.length,warnings}}
}
export function scheduleDateRequest(change:ScheduleDateChange):InvoiceWriteRequest {
  const u=change.unit
  if(!isEditableInvoicePlan(u)||u.frozenLineItems!==null||!isBillingDate(change.date)||!Number.isSafeInteger(Number(u.id))||Number(u.id)<=0)throw Error('変更対象の予定と請求予定日を確認してください')
  if(change.date===u.scheduledDate)throw Error('変更後の請求予定日が現在と同じです。変更しない回はチェックを外してください。')
  if(u.paymentDueOn&&u.paymentDueOn<change.date)throw Error('請求予定日が保存済みの入金予定日より後になります。「請求詳細」で入金予定日もあわせて確認してください。')
  return {unitId:Number(u.id),revision:u.revision,mode:'plan',value:{recipient_customer_id:u.recipientId,scheduled_date:change.date,planned_amount:u.plannedAmount??null},reason:null}
}
export class ScheduleChangeSaveError extends Error {
  constructor(public settingsSaved:boolean,public completed:number,public total:number,public failed:InvoiceWriteRequest|undefined,cause:unknown,public requests:readonly InvoiceWriteRequest[]=[]){
    super(`${settingsSaved?'請求情報は保存済みです。':'請求情報の保存結果を確認できません。'}${settingsSaved?`予定の変更は${completed}／${total}件の保存完了を確認しました。${failed?`請求記録ID ${failed.unitId} の結果は要確認です。`:''}`:''}再保存せず、この画面を閉じて最新の情報を確認してください。${failed?'「前回の保存結果が未確認です」が表示された場合は「保存結果を再確認」を押してください。':''}\n${cause instanceof Error?cause.message:String(cause)}`)
  }
}
/** Separate existing writes: stop on the first uncertain response. Never rollback financial data or blindly retry. */
export async function saveScheduleDateChanges(saveSettings:()=>Promise<void>,savePlan:(request:InvoiceWriteRequest)=>Promise<unknown>,requests:readonly InvoiceWriteRequest[]){
  try{await saveSettings()}catch(e){throw new ScheduleChangeSaveError(false,0,requests.length,undefined,e,requests)}
  for(let i=0;i<requests.length;i++)try{await savePlan(requests[i])}catch(e){throw new ScheduleChangeSaveError(true,i,requests.length,requests[i],e,requests)}
}
