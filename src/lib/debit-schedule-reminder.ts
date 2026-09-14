import type {BillingRow} from '../types'
import {isBillingDate} from './billing-unit'
import {toIsoDate} from './billing'
/** Legacy reminder only: calendar date is not evidence of bank success/failure. */
export function debitScheduleReminder(row:BillingRow,today:string):boolean{
 if(!isBillingDate(today)||row.contract?.billing_method!=='口座振替')return false
 const days=row.contract.billing_schedule_days??[]
 if(days.length!==1)return false
 const [year,month]=today.split('-').map(Number)
 const date=toIsoDate(year,days[0],month)
 if(!date||!isBillingDate(date)||date>today||date.slice(0,7)!==today.slice(0,7))return false
 // A past annual receipt cannot acknowledge this month's debit.
 const handled=row.records.some(r=>r.payments?.length?r.payments.some(p=>p.scheduled_date===date&&!!p.received_date):r.billing_scheduled_date===date&&!!(r.received_date||r.transfer_failed))
 return !handled
}
