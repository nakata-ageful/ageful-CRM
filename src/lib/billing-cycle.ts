import type {Contract} from '../types'
import type {BillingUnit} from './billing-unit'
import {maintenancePeriod} from './maintenance-period-label'

export type BillingCycleRule={id:number;project_id:number;effective_year:number;mode:'calendar_prepaid'|'anniversary';recorded_at:string;reason:string}
export function cycleRuleForYear(rules:readonly BillingCycleRule[],projectId:number,year:number){
  return rules.filter(r=>r.project_id===projectId&&r.effective_year<=year)
    .sort((a,b)=>b.effective_year-a.effective_year||b.id-a.id)[0]
}
export function cycleCompatibility(contract:Contract){
  return contract.billing_method==='請求書'&&(contract.billing_count??contract.billing_schedule_days?.length)===1
}
/** Future defaults only. Stored periods and historical reference displays never use this function. */
export function futureMaintenancePeriod(contract:Contract,year:number,rules:readonly BillingCycleRule[]=[]){
  const rule=cycleRuleForYear(rules,contract.project_id,year)
  if(rule?.mode==='calendar_prepaid'){
    if(!cycleCompatibility(contract))throw Error('1月〜12月・前年12月請求の設定は「請求書・年1回」で利用します。請求情報と繰り返し設定を確認してください')
    return {periodStart:`${year}-01-01`,periodEnd:`${year}-12-31`}
  }
  return maintenancePeriod(contract.maintenance_start_date,year)
}
export function cycleInvoiceDate(contract:Contract,year:number,rules:readonly BillingCycleRule[]=[]){
  const rule=cycleRuleForYear(rules,contract.project_id,year)
  return rule?.mode==='calendar_prepaid'&&cycleCompatibility(contract)?`${year-1}-12-01`:null
}
export function validateCycleOccurrence(contract:Contract,year:number,periodEnd:string,rules:readonly BillingCycleRule[]=[]){
  const next=cycleRuleForYear(rules,contract.project_id,year+1)
  if(!next)return
  const cutoff=next.mode==='calendar_prepaid'?`${year+1}-01-01`:maintenancePeriod(contract.maintenance_start_date,year+1).periodStart
  if(periodEnd>=cutoff)throw Error('繰り返し設定の次の保守期間と重なります。移行期間などの終了日を個別に確認してください')
}
export function validateCycleRule(contract:Contract,units:readonly BillingUnit[],year:number,mode:BillingCycleRule['mode'],reason:string){
  if(!Number.isInteger(year)||year<2001||year>2199||!['calendar_prepaid','anniversary'].includes(mode)||!reason.trim())throw Error('適用開始年・繰り返し方法・確認内容を入力してください')
  if(!contract.maintenance_start_date)throw Error('当初の保守開始日を確認してください')
  if(mode==='calendar_prepaid'&&!cycleCompatibility(contract))throw Error('この設定は「請求書・年1回」の発電所で利用します')
  const period=(y:number)=>mode==='calendar_prepaid'?{periodStart:`${y}-01-01`,periodEnd:`${y}-12-31`}:maintenancePeriod(contract.maintenance_start_date,y)
  const first=period(year)
  for(const u of units.filter(u=>u.projectId===contract.project_id)){
    const saved=u.periodStart&&u.periodEnd?{periodStart:u.periodStart,periodEnd:u.periodEnd}:maintenancePeriod(contract.maintenance_start_date,u.serviceYear)
    if(u.serviceYear<year&&saved.periodEnd>=first.periodStart)throw Error('切替前の保守期間が新しい期間と重なります。「請求詳細」で移行期間の終了日を先に確認・修正してください')
    if(u.serviceYear>=year){
      const expected=period(u.serviceYear)
      if(!u.periodStart||!u.periodEnd||saved.periodStart!==expected.periodStart||saved.periodEnd!==expected.periodEnd)throw Error(`${u.serviceYear}年の保存済み記録の保守期間を先に確認・修正してください。保存済みの期間は自動変更しません`)
    }
  }
}
export function cycleRuleFromStorage(value:unknown):BillingCycleRule{
  const r=value as BillingCycleRule
  if(!r||!Number.isSafeInteger(r.id)||r.id<1||!Number.isSafeInteger(r.project_id)||r.project_id<1||!Number.isInteger(r.effective_year)||r.effective_year<2001||r.effective_year>2199||!['calendar_prepaid','anniversary'].includes(r.mode)||typeof r.recorded_at!=='string'||typeof r.reason!=='string')throw Error('請求の繰り返し設定の取得内容が不正です')
  return r
}
