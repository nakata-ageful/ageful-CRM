import type {BillingUnit} from './billing-unit'
import {isBillingDate} from './billing-unit'
import {maintenancePeriod} from './maintenance-period-label'

export type DetailPeriodGroup = {
  key:string; label:string; start:string|null; end:string|null; inferred:boolean; units:BillingUnit[]
}

/** Group by service coverage, NOT issue/payment date. Never backfill the ledger during rendering. */
export function billingDetailPeriods(units:readonly BillingUnit[], startDate?:string|null):DetailPeriodGroup[] {
  const groups=new Map<string,DetailPeriodGroup>()
  for(const unit of units){
    let start=unit.periodStart??null,end=unit.periodEnd??null,inferred=false
    const invalid=!!(start||end)&&(!start||!end||!isBillingDate(start)||!isBillingDate(end)||start>end)
    if(!start&&!end){
      try{({periodStart:start,periodEnd:end}=maintenancePeriod(startDate,unit.serviceYear));inferred=true}catch{/* Missing anchor remains unknown. */}
    }
    const key=invalid?`invalid:${unit.id}`:start&&end?`${unit.serviceYear}:${start}:${end}`:`unknown:${unit.serviceYear}`
    const group=groups.get(key)??{key,start:invalid?null:start,end:invalid?null:end,inferred:false,
      label:invalid?'保守期間要確認':start&&end?`${start} ～ ${end}`:`保守期間未設定（記録年：${unit.serviceYear}）`,units:[]}
    group.inferred ||= inferred
    group.units.push(unit);groups.set(key,group)
  }
  return [...groups.values()].sort((a,b)=>(b.start??String(b.units[0].serviceYear)).localeCompare(a.start??String(a.units[0].serviceYear)))
    .map(group=>({...group,units:[...group.units].sort((a,b)=>{
      const round=(u:BillingUnit)=>Number(/^第(\d+)回$/.exec(u.roundLabel)?.[1]??/^(\d+)月分$/.exec(u.roundLabel)?.[1]??999)
      return round(a)-round(b)||(a.scheduledDate??a.issuedOn??'9999').localeCompare(b.scheduledDate??b.issuedOn??'9999')||a.id.localeCompare(b.id)
    })}))
}
