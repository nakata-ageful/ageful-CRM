import {isBillingDate,type BillingUnit} from './billing-unit'

/** Display only: the date is the withdrawal date, not a guessed service month. */
export function debitOccurrenceLabel(scheduledDate:string|null|undefined):string {
  if(!scheduledDate||!isBillingDate(scheduledDate))return '口座振替（予定日未登録）'
  const [year,month,day]=scheduledDate.split('-').map(Number)
  return `${year}年${month}月${day}日の口座振替`
}

/** Missing round metadata alone is not an operational warning for a lone historical invoice. */
export function isSinglePastRecord(unit:BillingUnit,periodUnits:readonly BillingUnit[]):boolean {
  return unit.roundLabel==='保存済み単回記録'&&periodUnits.length===1
    &&['issued','received'].includes(unit.lifecycle)
}

export function billingOccurrenceLabel(unit:BillingUnit,omitUnknownRound=false):string {
  if(unit.method==='口座振替')return debitOccurrenceLabel(unit.scheduledDate)
  if(unit.roundLabel==='保存済み単回記録')return omitUnknownRound?'請求・入金記録':'回数要確認'
  return unit.roundLabel
}
