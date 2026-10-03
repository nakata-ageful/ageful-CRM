import type {Contract} from '../types'
import {invoiceAmount,withdrawalAmount,parseScheduleDay} from './billing'
import {isBillingDate,type BillingUnit} from './billing-unit'
import {maintenancePeriod} from './maintenance-period-label'
import type {MaintenanceScheduleItem} from './maintenance-schedule'
import {managementActiveOn,managementBillingContract,type ManagementEvent} from './management-lifecycle'
import {validateIndividualPeriod} from './individual-maintenance-period'
import {futureMaintenancePeriod,cycleInvoiceDate,cycleRuleForYear,validateCycleOccurrence,type BillingCycleRule} from './billing-cycle'

export type DetailPlanCandidate = Omit<MaintenanceScheduleItem,'periodStart'|'periodEnd'> & {periodStart:string|null;periodEnd:string|null}

export function detailPlanCount(contract:Contract):number {
  return contract.billing_count??(contract.billing_method==='口座振替'?12:contract.billing_schedule_days?.length||1)
}

/** A reference only. No inferred payer/amount/date is written until the operator confirms. */
export function detailPlanCandidate(contract:Contract,recipientId:number,units:readonly BillingUnit[],today:string,events:readonly ManagementEvent[]=[],rules:readonly BillingCycleRule[]=[]):DetailPlanCandidate|null {
  if(!isBillingDate(today)||!['請求書','口座振替'].includes(contract.billing_method??''))return null
  const count=detailPlanCount(contract)
  if(!Number.isInteger(count)||count<1||count>96)return null
  const debit=contract.billing_method==='口座振替'
  const calendarYear=Number(today.slice(0,4)),calendarMonth=Number(today.slice(5,7))
  let year=calendarYear
  try{if(today<futureMaintenancePeriod(contract,year,rules).periodStart)year--}catch{/* No guessed maintenance anchor. */}
  const options:{year:number;round:number;date:string;month:number}[]=[]
  if(debit){
    const rawDay=parseScheduleDay(contract.billing_schedule_days?.[0]??'').day
    const day=rawDay&&rawDay>=1&&rawDay<=31?rawDay:null
    for(let offset=0;offset<12;offset++){
      const monthDate=new Date(Date.UTC(calendarYear,calendarMonth-1+offset,1)),cy=monthDate.getUTCFullYear(),month=monthDate.getUTCMonth()+1
      const date=day?`${cy}-${String(month).padStart(2,'0')}-${String(Math.min(day,new Date(Date.UTC(cy,month,0)).getUTCDate())).padStart(2,'0')}`:''
      let serviceYear=cy,round=month
      try{const current=maintenancePeriod(contract.maintenance_start_date,cy);if(date&&date<current.periodStart)serviceYear--
        const period=maintenancePeriod(contract.maintenance_start_date,serviceYear);round=(cy-serviceYear)*12+month-Number(period.periodStart.slice(5,7))+1
      }catch{/* Reference still visible but cannot be saved without a service period. */}
      if(round>=1&&round<=count)options.push({year:serviceYear,round,date,month})
    }
  }else{
    for(let serviceYear=year;serviceYear<=year+2;serviceYear++){
      const prepaidDate=cycleInvoiceDate(contract,serviceYear,rules)
      if(prepaidDate){options.push({year:serviceYear,round:1,date:prepaidDate,month:12});continue}
      for(let round=1;round<=count;round++){
        const {month,day}=parseScheduleDay(contract.billing_schedule_days?.[round-1]??'')
        let cy=serviceYear
        try{const period=futureMaintenancePeriod(contract,serviceYear,rules)
          if(month&&day&&`${cy}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`<period.periodStart)cy++
        }catch{/* Year is only a reference until the operator chooses coverage. */}
        const date=month&&day?`${cy}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`:''
        options.push({year:serviceYear,round,date:isBillingDate(date)?date:'',month:month??1})
      }
    }
  }
  const own=units.filter(u=>u.projectId===contract.project_id)
  const next=options.find(o=>!own.some(u=>u.serviceYear===o.year&&(u.roundLabel===`第${o.round}回`||u.roundLabel==='保存済み単回記録'||u.roundLabel.endsWith('月分'))))
  if(!next)return null
  let period:{periodStart:string|null;periodEnd:string|null}={periodStart:null,periodEnd:null}
  try{period=futureMaintenancePeriod(contract,next.year,rules)}catch{if(cycleRuleForYear(rules,contract.project_id,next.year)?.mode==='calendar_prepaid')return null}
  const sameYear=own.filter(u=>u.serviceYear===next.year)
  const stored=sameYear.find(u=>u.periodStart&&u.periodEnd)
  if(stored)period={periodStart:stored.periodStart!,periodEnd:stored.periodEnd!}
  if(!managementActiveOn(events,contract.project_id,'all',period.periodStart||next.date||today))return null
  const changes=period.periodStart&&period.periodEnd&&events.some(e=>e.project_id===contract.project_id&&e.effective_date>=period.periodStart!&&e.effective_date<=period.periodEnd!)
  const effective=managementBillingContract(contract,events,next.date||today)
  return {...next,...period,method:debit?'direct_debit':'invoice',recipientId,
    amount:changes?null:debit?withdrawalAmount(effective,next.month):invoiceAmount(effective,next.round,count)}
}

/** Mirrors the existing insert-only RPC's correspondence boundary, including cancelled/legacy records. */
export function validateDetailPlan(item:MaintenanceScheduleItem,units:readonly BillingUnit[],projectId:number,reason:string,startDate?:string|null,rules:readonly BillingCycleRule[]=[],contract?:Contract):void {
  if(!reason.trim()||!isBillingDate(item.date)||!isBillingDate(item.periodStart)||!isBillingDate(item.periodEnd)
    ||item.periodStart>item.periodEnd||Number(item.periodStart.slice(0,4))!==item.year||item.year<2000||item.year>2199
    ||!Number.isSafeInteger(item.round)||item.round<1||item.round>96||!Number.isSafeInteger(item.recipientId)||item.recipientId<1
    ||item.amount===null||!Number.isSafeInteger(item.amount)||item.amount<0||!['invoice','direct_debit'].includes(item.method))throw Error('保守期間・回・請求先・予定日・金額・確認内容を確認してください')
  const own=units.filter(u=>u.projectId===projectId)
  if(own.some(u=>u.serviceYear===item.year&&(u.roundLabel===`第${item.round}回`||u.roundLabel==='保存済み単回記録'||u.roundLabel.endsWith('月分'))))
    throw Error('この期間の保存済み記録との対応確認が必要です。既存の記録を選んで確認してください')
  if(own.some(u=>u.serviceYear===item.year&&u.periodStart&&u.periodEnd&&(u.periodStart!==item.periodStart||u.periodEnd!==item.periodEnd)))
    throw Error('同じ期間の保存済み記録と保守期間が異なります')
  if(startDate!==undefined)validateIndividualPeriod(item,item.year,projectId,own,startDate)
  if(contract)validateCycleOccurrence(contract,item.year,item.periodEnd,rules)
}
