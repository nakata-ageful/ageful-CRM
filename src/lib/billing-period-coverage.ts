import type {Contract} from '../types'
import {isBillingDate} from './billing-unit'
import {cycleCompatibility,cycleRuleForYear,type BillingCycleRule} from './billing-cycle'

export type PeriodEvidence={projectId:number;serviceYear:number;method:string;lifecycle:string;periodStart?:string|null;periodEnd?:string|null;removedAt?:string|null}

/** Explicit ranges only: neither a payment date nor the historical start proves coverage.
 * Suppress a reference only when a completed long transition and its next January rule
 * explain it together. Ambiguous overlaps stay actionable, never become "handled".
 */
export function inspectCandidatePeriod(contract:Contract,year:number,period:{periodStart:string|null;periodEnd:string|null},units:readonly PeriodEvidence[],rules:readonly BillingCycleRule[]=[]):{superseded:boolean;reason?:string}{
  units=units.filter(u=>!u.removedAt)
  if(!period.periodStart||!period.periodEnd)return {superseded:false,reason:'対象の保守期間が未確認です。「保守情報」と保存済み記録を確認してください'}
  const overlaps=units.filter(u=>u.projectId===contract.project_id&&u.serviceYear!==year
    &&isBillingDate(u.periodStart??'')&&isBillingDate(u.periodEnd??'')&&u.periodStart!<=period.periodEnd!&&period.periodStart!<=u.periodEnd!)
  // Also check a same-year long record: its unknown round must not create another claim.
  const long=units.filter(u=>u.projectId===contract.project_id&&isBillingDate(u.periodStart??'')&&isBillingDate(u.periodEnd??'')
    &&u.periodEnd!>=`${u.serviceYear+1}-12-31`&&u.periodStart!<=period.periodStart!&&period.periodStart!<=u.periodEnd!)
  const u=long.length===1?long[0]:undefined
  if(u&&cycleCompatibility(contract)&&u.method==='請求書'&&['issued','received'].includes(u.lifecycle)){
    const nextYear=Number(u.periodEnd!.slice(0,4))+1,next=cycleRuleForYear(rules,contract.project_id,nextYear)
    const conflicting=units.some(other=>other!==u&&other.projectId===contract.project_id
      &&(other.serviceYear===year||isBillingDate(other.periodStart??'')&&isBillingDate(other.periodEnd??'')&&other.periodStart!<=period.periodEnd!&&period.periodStart!<=other.periodEnd!))
    if(!conflicting&&u.periodEnd===`${nextYear-1}-12-31`&&next?.mode==='calendar_prepaid'&&next.effective_year===nextYear&&year<nextYear)
      return {superseded:true}
  }
  const sameYearMismatch=units.some(other=>other.projectId===contract.project_id&&other.serviceYear===year
    &&isBillingDate(other.periodStart??'')&&isBillingDate(other.periodEnd??'')&&(other.periodStart!==period.periodStart||other.periodEnd!==period.periodEnd))
  if(sameYearMismatch)return {superseded:false,reason:'保存済みの保守期間と候補の期間が異なります。移行期間と今後の繰り返し設定を確認してください。自動で請求済みとは扱いません'}
  if(overlaps.length||long.length)return {superseded:false,reason:'保存済みの保守期間と重なります。対象期間と請求済みの範囲を確認してください。自動で請求済みとは扱いません'}
  return {superseded:false}
}
