import {isActiveBillingUnit,type BillingUnit} from './billing-unit'

export type BillingRecordRemovalRequest={unitId:number;revision:number;mode:'remove'|'restore';reason:string}
export function canRemoveBillingRecord(unit:BillingUnit):boolean {
  return ['issued','received'].includes(unit.lifecycle)&&!!(unit.issuedOn||unit.receivedOn)
}
export function billingRecordRemovalRequest(unit:BillingUnit,mode:BillingRecordRemovalRequest['mode'],reason:string,confirmed:boolean):BillingRecordRemovalRequest {
  if(!Number.isSafeInteger(Number(unit.id))||Number(unit.id)<1||!Number.isSafeInteger(unit.revision)||unit.revision<0
    ||!['remove','restore'].includes(mode)||!canRemoveBillingRecord(unit))throw Error('削除・復元する請求記録を確認してください')
  if((mode==='remove')!==isActiveBillingUnit(unit))throw Error('削除状態が変わっています。画面を読み込み直してください')
  if(!confirmed||!reason.trim()||reason.trim().length>1000)throw Error('理由を入力し、対象の記録を確認してください（理由は1,000文字以内）')
  return {unitId:Number(unit.id),revision:unit.revision,mode,reason:reason.trim()}
}
