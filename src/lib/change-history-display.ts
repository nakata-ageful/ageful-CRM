import {billingFlagLabels,contractTransferLabels} from './contract-transfer-form'
import type {ManagementEvent} from './management-lifecycle'

export type HistoryKind='ownership'|'billing'|'management'
export type HistoryEntry={key:string;kind:HistoryKind;date:string;title:string;reason:string;record:Record<string,unknown>}
const eventLabels:Record<string,string>={created:'請求予定を追加',plan_changed:'請求予定を変更',fixed:'請求額を確認',issued:'請求日を登録',collection_recorded:'入金・振替結果を登録',corrected:'請求・入金記録を訂正',cancelled:'請求予定を取りやめ'}
export const historyKindLabels:Record<HistoryKind,string>={ownership:'所有者変更',billing:'請求の変更',management:'終了・再開'}
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{}
export function buildChangeHistory(transfers:readonly Record<string,unknown>[],events:readonly Record<string,unknown>[],management:readonly ManagementEvent[]):HistoryEntry[]{
  const entries:HistoryEntry[]=[
    ...transfers.map(t=>({key:`ownership:${t.id}`,kind:'ownership' as const,date:String(t.recorded_at??t.transfer_date??''),title:t.event_type==='correction'?'所有者変更を訂正':'所有者を変更',reason:String(record(t.field_decisions).reason??'確認内容の記録なし'),record:t})),
    ...events.map(e=>({key:`billing:${e.id}`,kind:'billing' as const,date:String(e.recorded_at??''),title:eventLabels[String(e.event_type)]??'請求記録を保存',reason:String(e.reason??'確認内容の記録なし'),record:e})),
    ...management.map(m=>({key:`management:${m.id}`,kind:'management' as const,date:String((m as ManagementEvent&{recorded_at?:string}).recorded_at??m.effective_date),title:`${m.scope==='all'?'すべての取引':'保守だけ'}を${m.action==='end'?'終了':'再開'}`,reason:m.reason,record:m})),
  ]
  return entries.sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0)||Number(b.record.id)-Number(a.record.id)||a.key.localeCompare(b.key))
}
function canonical(value:unknown):string {
  return JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):Array.isArray(value)?value.map(canonical):value)??'undefined'
}
const billingLabels:Record<string,string>={recipient_customer_id:'請求先',collection_method:'請求方法',original_method:'登録時の請求方法',planned_amount:'予定額（税込）',frozen_amount:'確定額（税込）',scheduled_date:'請求・振替予定日',issued_on:'請求日',payment_due_on:'入金予定日',received_on:'入金日',period_start:'保守期間の開始日',period_end:'保守期間の終了日',plan_note:'備考',frozen_line_items:'確定した明細',lifecycle:'請求の状態',collection_state:'振替・入金の結果',service_year:'保守期間の開始年',service_month:'対象月',round_number:'対象の回',id:'請求回ID',project_id:'発電所ID',contract_id:'契約ID',revision:'更新番号',updated_at:'更新日時',created_at:'登録日時',frozen_at:'金額の確定日時',recipient_source:'請求先の確認状態',amount_basis:'金額の根拠'}
export function historyFields(before:unknown,after:unknown,kind:'contract'|'billing',all=false){
  const a=record(before),b=record(after),labels:Record<string,string>=kind==='contract'?contractTransferLabels:billingLabels
  const keys=[...new Set([...Object.keys(labels),...Object.keys(a),...Object.keys(b)])]
  const technical=['id','project_id','contract_id','revision','updated_at','created_at','frozen_at','recipient_plan_id','schema_version']
  return keys.filter(k=>(k in a||k in b)&&(all||!technical.includes(k)&&canonical(a[k])!==canonical(b[k]))).map(key=>({key,label:labels[key]??`追加項目（${key}）`,before:a[key],after:b[key]}))
}
export function historyValue(key:string,value:unknown,recipientName:(id:number)=>string):string{
  if(value==null)return '未記入'
  if(key==='recipient_customer_id')return Number.isSafeInteger(value)&&Number(value)>0?recipientName(Number(value)):'請求先要確認'
  const enums:Record<string,string>={invoice:'請求書',direct_debit:'口座振替',planned:'予定',fixed:'金額確認済み',issued:'発行済み',received:'入金済み',cancelled:'取りやめ',review_required:'要確認',pending:'未確認',succeeded:'入金・振替済み',failed:'振替不能',not_applicable:'対象外',default:'基本の請求先',override:'個別指定',confirmed:'確認済み',unconfirmed:'未確認',source_record:'過去の保存記録',operator_confirmed:'担当者が確認',contract_calculation:'契約からの計算'}
  if(['collection_method','original_method','lifecycle','collection_state','recipient_source','amount_basis'].includes(key))return enums[String(value)]??String(value)
  if(typeof value==='number')return `${value.toLocaleString('ja-JP')}${['planned_amount','frozen_amount','billing_amount_ex','billing_amount_inc','annual_maintenance_ex','annual_maintenance_inc','land_cost_monthly','insurance_fee','other_fee','communication_fee','local_association_fee','transfer_fee','subcontract_fee_ex','subcontract_fee_inc','issuance_fee_ex','issuance_fee_inc','transfer_fee_ex','transfer_fee_inc'].includes(key)?'円':''}`
  if(typeof value==='boolean')return value?'あり':'なし'
  if(Array.isArray(value))return value.map(v=>{const item=record(v);return typeof item.name==='string'&&typeof item.amount==='number'?`${item.name}：${item.amount.toLocaleString('ja-JP')}円`:typeof v==='object'?JSON.stringify(v):String(v)}).join('\n')||'なし'
  if(typeof value==='object'&&key==='billing_item_flags')return Object.entries(value).map(([name,included])=>`${(billingFlagLabels as Record<string,string>)[name]??name}：${typeof included==='boolean'?(included?'請求に含める':'含めない'):String(included)}`).join('\n')||'個別設定なし'
  if(typeof value==='object'&&key==='billing_amount_overrides')return Object.entries(value).map(([number,amount])=>`対象 ${number}：${typeof amount==='number'?amount.toLocaleString('ja-JP')+'円':String(amount)}`).join('\n')||'個別金額なし'
  if(typeof value==='object')return JSON.stringify(value)
  return String(value)
}
export function historyDate(value:string):string{
  if(!value)return '記録日不明'
  if(!value.includes('T'))return value
  const parsed=new Date(value)
  return Number.isFinite(parsed.getTime())?parsed.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):value
}
