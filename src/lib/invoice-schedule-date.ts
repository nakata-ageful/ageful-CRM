import type {Contract} from '../types'
import {parseScheduleDay} from './billing'
import {isBillingDate} from './billing-unit'

/** 第1回は保守開始年。前払いを翌年へ送らず、回の月日が一周した時だけ翌年へ進む。
 * 保存済みの日付には適用しない。前年12月前払いの明示設定は呼び出し側で優先する。
 */
function roundDate(contract:Contract,round:number){
  if(!Number.isInteger(round)||round<1||round>96)return null
  let offset=0,previous=''
  for(let i=0;i<round;i++){
    const {month,day}=parseScheduleDay(contract.billing_schedule_days?.[i]??'')
    if(!month||!day)return null
    const md=`${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`
    if(!isBillingDate(`2000-${md}`))return null
    if(previous&&md<previous)offset++
    previous=md
  }
  return {offset,md:previous}
}
export function invoiceScheduleDate(contract:Contract,serviceYear:number,round:number):string|null{
  if(!Number.isInteger(serviceYear)||serviceYear<2000||serviceYear>2199)return null
  const value=roundDate(contract,round)
  const date=value?`${serviceYear+value.offset}-${value.md}`:null
  return date&&isBillingDate(date)?date:null
}
/** Inverse used by alerts, so a prepayment belongs to the same period as Detail. */
export function invoiceServiceYear(contract:Contract,date:string,round:number):number|null{
  const value=roundDate(contract,round)
  if(!value||!isBillingDate(date))return null
  const year=Number(date.slice(0,4))-value.offset
  return invoiceScheduleDate(contract,year,round)===date?year:null
}
