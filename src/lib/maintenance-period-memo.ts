import type {Contract} from '../types'
import {isBillingDate} from './billing-unit'

export const maintenanceMemoKey='maintenance_period_start_memo_date' as const
export const maintenanceMemoReady=(source:object|null|undefined)=>!!source&&Object.hasOwn(source,maintenanceMemoKey)
/** A memo-only patch. Never derive or change an invoice/period anchor. */
export function maintenanceMemoPayload(source:Partial<Contract>|null|undefined,value:string|null|undefined):Partial<Contract>{
 if(value===undefined)return {}
 const date=value||null
 if(date!==null&&!isBillingDate(date))throw Error('保守期間開始日を正しい日付で入力してください')
 if(!maintenanceMemoReady(source)){
  if(date!==null)throw Error('日付メモの保存先が未準備です。画面を再読み込みしてください')
  return {}
 }
 if(date===(source?.[maintenanceMemoKey]??null))return {}
 return {[maintenanceMemoKey]:date}
}
