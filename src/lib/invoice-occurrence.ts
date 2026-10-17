import type {Contract} from '../types'
import {isBillingDate} from './billing-unit'
import {parseScheduleDay} from './billing'
import {invoiceServiceYear} from './invoice-schedule-date'
import {cycleCompatibility,cycleInvoiceDate,cycleRuleForYear,type BillingCycleRule} from './billing-cycle'

export const invoicePeriodChoiceReason='12月1日の請求が今年分か翌年分かを確認してください。「請求情報」の「繰り返し設定を変更」で設定できます。'

/** Resolve date -> service year identically for Detail and reminders. Explicit
 * next-January prepayment wins over an unsaved same-date old-default proposal.
 * No saved occurrence is changed or treated as paid by this function.
 */
export function invoiceOccurrenceYear(contract:Contract,date:string,round:number,rules:readonly BillingCycleRule[]=[]):number|null {
  if(!isBillingDate(date)||!Number.isInteger(round)||round<1)return null
  const calendarYear=Number(date.slice(0,4))
  if(round===1&&date.endsWith('-12-01')&&cycleCompatibility(contract)
    &&cycleRuleForYear(rules,contract.project_id,calendarYear+1)?.mode==='calendar_prepaid')return calendarYear+1
  const year=invoiceServiceYear(contract,date,round)
  if(year==null)return null
  if(cycleRuleForYear(rules,contract.project_id,year)?.mode==='calendar_prepaid')
    return cycleInvoiceDate(contract,year,rules)===date?year:null
  return year
}

/** January coverage + December 1 alone cannot prove advance vs arrears billing. */
export function invoicePeriodChoiceRequired(contract:Contract,year:number,rules:readonly BillingCycleRule[]=[]):boolean {
  const day=parseScheduleDay(contract.billing_schedule_days?.[0]??'')
  return cycleCompatibility(contract)&&contract.maintenance_start_date?.slice(5)==='01-01'
    &&day.month===12&&day.day===1&&!cycleRuleForYear(rules,contract.project_id,year)
}
