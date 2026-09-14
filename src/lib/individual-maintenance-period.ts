import {isBillingDate} from './billing-unit'
import {maintenancePeriod} from './maintenance-period-label'
import type {TransferBillingUnit} from './ownership-billing-plan'
export type IndividualPeriod={periodStart:string;periodEnd:string}
export function validateIndividualPeriod(period:IndividualPeriod,year:number,projectId:number,units:readonly TransferBillingUnit[],startDate?:string|null){
 if(!isBillingDate(period.periodStart)||!isBillingDate(period.periodEnd)||period.periodStart>period.periodEnd||Number(period.periodStart.slice(0,4))!==year)throw Error('保守期間の開始日・終了日・開始年を確認してください')
 for(const unit of units.filter(u=>u.projectId===projectId)){
  const saved=unit.periodStart&&unit.periodEnd?{periodStart:unit.periodStart,periodEnd:unit.periodEnd}:startDate?maintenancePeriod(startDate,unit.serviceYear):null
  if(!saved)throw Error('保存済み記録の保守期間を先に確認してください')
  if(unit.serviceYear===year){if(saved.periodStart!==period.periodStart||saved.periodEnd!==period.periodEnd)throw Error('同じ開始年の保存済み保守期間と異なります。過去記録は変更しません')}
  else if(saved.periodStart<=period.periodEnd&&period.periodStart<=saved.periodEnd)throw Error('保存済みの別の保守期間と重複しています')
 }
 return period
}
