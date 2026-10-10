import type {BillingUnit} from './billing-unit'
import {validateIndividualPeriod,type IndividualPeriod} from './individual-maintenance-period'

export type SavedMaintenancePeriodChange=IndividualPeriod&{year:number;reason:string}

/** Only period metadata is submitted; invoice, payer and payment fields are never copied. */
export function savedMaintenancePeriodChange(projectId:number,year:number,period:IndividualPeriod,reason:string,units:readonly BillingUnit[],startDate:string|null):SavedMaintenancePeriodChange{
 if(!Number.isInteger(year)||year<2000||year>2199)throw Error('保存記録の開始年を確認してください')
 if(!units.some(u=>!u.removedAt&&u.projectId===projectId&&u.serviceYear===year))throw Error('対象の保存記録がありません')
 if(!startDate)throw Error('発電所の保守開始日を先に設定してください')
 if(!reason.trim())throw Error('期間を修正する理由を入力してください')
 if(period.periodEnd>'2200-12-31')throw Error('保守期間の終了日を確認してください')
 validateIndividualPeriod(period,year,projectId,units.filter(u=>u.serviceYear!==year),startDate)
 return {year,periodStart:period.periodStart,periodEnd:period.periodEnd,reason:reason.trim()}
}
