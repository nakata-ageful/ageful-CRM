import type {Contract} from '../types'
import {BILLING_ITEMS,isItemBillable} from './billing'

export function billingItemSummary(contract:Contract|null|undefined){
  const items=BILLING_ITEMS.map(item=>({key:item.key,label:item.label,amount:contract?.[item.field]??null,included:isItemBillable(contract,item.key)}))
  return {items,recordedTotal:items.reduce((s,i)=>s+(i.amount??0),0),includedTotal:items.reduce((s,i)=>s+(i.included?i.amount??0:0),0),
    excludedTotal:items.reduce((s,i)=>s+(!i.included?i.amount??0:0),0),
    hasOverrides:Object.keys(contract?.billing_amount_overrides??{}).length>0,
    hasFees:!!(contract?.has_issuance_fee||contract?.has_transfer_fee)}
}
/** Only flags are writable here. Never copy money, dates or occurrence records into this patch. */
export function billingItemSelectionPatch(flags:Record<string,boolean>){
  for(const [key,value] of Object.entries(flags))if(!BILLING_ITEMS.some(item=>item.key===key)||typeof value!=='boolean')throw Error('請求対象の項目を確認してください')
  return {billing_item_flags:Object.fromEntries(BILLING_ITEMS.map(item=>[item.key,flags[item.key]!==false]))}
}
