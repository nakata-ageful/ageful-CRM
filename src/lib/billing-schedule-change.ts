import type {Contract} from '../types'
import {parseScheduleDay} from './billing'
import {isActiveBillingUnit,isBillingDate,isEditableInvoicePlan,type BillingUnit} from './billing-unit'
import {futureMaintenancePeriod,cycleRuleForYear,type BillingCycleRule} from './billing-cycle'
import type {InvoiceWriteRequest} from './invoice-write-session'

export type ScheduleDateChange={unit:BillingUnit;date:string;period:string}
export type ScheduleDateReview={changes:ScheduleDateChange[];manual:BillingUnit[];preserved:number;notice:string}
/** Only propose correspondences that can be explained by the OLD schedule.
 * The caller/operator selects the exact saved unit; never choose by earliest date.
 */
export function reviewScheduleDateChanges(before:Contract,after:Contract,units:readonly BillingUnit[],today:string,rules:readonly BillingCycleRule[]=[]):ScheduleDateReview|null {
  const oldDays=before.billing_schedule_days??[],newDays=after.billing_schedule_days??[]
  const sameDay=(a:string,b:string)=>JSON.stringify(parseScheduleDay(a))===JSON.stringify(parseScheduleDay(b))
  if(oldDays.length===newDays.length&&oldDays.every((d,i)=>sameDay(d,newDays[i])))return null
  const own=units.filter(u=>u.projectId===before.project_id&&isActiveBillingUnit(u))
  const changes:ScheduleDateChange[]=[],manual:BillingUnit[]=[]
  const count=before.billing_count??oldDays.length
  const compatible=before.billing_method==='請求書'&&after.billing_method==='請求書'&&count===(after.billing_count??newDays.length)&&count>0&&oldDays.length===count&&newDays.length===count&&before.maintenance_start_date===after.maintenance_start_date
  const dateFor=(day:string,year:number,start:string)=>{const {month,day:d}=parseScheduleDay(day);if(!month||!d)return null
    const y= `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`<start?year+1:year
    const value=`${y}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    return isBillingDate(value)?value:null}
  for(const u of own.filter(u=>u.lifecycle==='planned')){
    const round=/^第(\d+)回$/.exec(u.roundLabel),i=round?Number(round[1])-1:-1
    if(compatible&&i>=0&&i<count&&sameDay(oldDays[i],newDays[i]))continue
    try{
      if(!compatible||!isEditableInvoicePlan(u)||!isBillingDate(today)||!u.scheduledDate||u.scheduledDate<today||i<0||i>=count||!Number.isSafeInteger(Number(u.id))||Number(u.id)<=0||cycleRuleForYear(rules,before.project_id,u.serviceYear)?.mode==='calendar_prepaid')throw Error('manual')
      const period=futureMaintenancePeriod(before,u.serviceYear,rules)
      if((u.periodStart||u.periodEnd)&&(u.periodStart!==period.periodStart||u.periodEnd!==period.periodEnd))throw Error('manual')
      const oldDate=dateFor(oldDays[i],u.serviceYear,period.periodStart),newDate=dateFor(newDays[i],u.serviceYear,period.periodStart)
      if(!oldDate||oldDate!==u.scheduledDate||!newDate||newDate<today||newDate===oldDate)throw Error('manual')
      if(u.paymentDueOn&&u.paymentDueOn<newDate)throw Error('manual')
      changes.push({unit:structuredClone(u),date:newDate,period:`${period.periodStart} ～ ${period.periodEnd}${!u.periodStart?'（参考・期間未保存）':''}`})
    }catch{manual.push(structuredClone(u))}
  }
  changes.sort((a,b)=>a.unit.scheduledDate!.localeCompare(b.unit.scheduledDate!)||a.unit.id.localeCompare(b.unit.id))
  return {changes,manual,preserved:own.length-changes.length-manual.length,notice:compatible?'':'請求方法・回数も変更される場合や口座振替は、各回の予定を「請求詳細」で個別に確認してください。'}
}
export function scheduleDateRequest(change:ScheduleDateChange):InvoiceWriteRequest {
  const u=change.unit
  if(!isEditableInvoicePlan(u)||!isBillingDate(change.date)||!Number.isSafeInteger(Number(u.id))||Number(u.id)<=0)throw Error('変更対象の予定を確認してください')
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
