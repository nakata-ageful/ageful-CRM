import type { Contract } from '../types'
import { type FieldChoice } from './ownership-field-selection'

/** Every model key needs a human label; additions fail type checking until classified. */
export const contractTransferLabels = {
  id:'内部ID',project_id:'発電所ID',created_at:'登録日時',updated_at:'更新日時',ownership_transfer_date:'所有権移転日（自動更新）',
  billing_method:'請求方法',billing_due_day:'請求日（旧設定）',billing_amount_ex:'請求金額（税抜）',billing_amount_inc:'請求金額（税込）',
  annual_maintenance_ex:'年次保守料（税抜）',annual_maintenance_inc:'年次保守料（税込）',land_cost_monthly:'土地代',
  insurance_fee:'火災保険料',other_fee:'その他費用',communication_fee:'通信費',local_association_fee:'自治会費',
  transfer_fee:'振替手数料（旧設定）',transfer_account:'振替口座（旧設定値）',sale_contract_date:'売買契約日（旧設定）',
  equipment_contract_date:'設備売買契約日',land_contract_date:'土地契約日',maintenance_contract_date:'保守契約日',
  sales_to_neosys:'販売店→ネオシス',neosys_to_referrer:'ネオシス→紹介者',contractor_name:'契約者名（旧設定）',
  billing_count:'年間請求回数',subcontractor:'保守委託先',subcontract_fee_ex:'委託料（税抜）',subcontract_fee_inc:'委託料（税込）',
  subcontract_billing_day:'委託料支払期日（毎年）',subcontract_start_date:'委託開始日',maintenance_start_date:'保守開始日',
  maintenance_contractor:'受託会社',plan_inspection:'点検',plan_weeding:'除草',plan_emergency:'駆けつけ',notes:'請求情報の備考',
  equipment_contract_notes:'設備契約の備考',land_contract_notes:'土地契約の備考',maintenance_contract_notes:'保守契約の備考',
  maintenance_content_notes:'保守内容の備考',subcontract_notes:'委託契約の備考',has_meti_setup_report:'経産省 設置報告',
  has_meti_periodic_report:'経産省 定期報告',meti_setup_report_date:'設置報告 申請日',meti_setup_report_status:'設置報告 ステータス',
  has_issuance_fee:'発行手数料の有無',issuance_fee_ex:'発行手数料（税抜）',issuance_fee_inc:'発行手数料（税込）',
  has_transfer_fee:'振替手数料の有無',transfer_fee_ex:'振替手数料（税抜）',transfer_fee_inc:'振替手数料（税込）',
  billing_schedule_days:'請求予定日',billing_amount_overrides:'各回・各月の個別金額',billing_item_flags:'請求に含める項目',
} satisfies Record<keyof Contract,string>
export type ContractChoices = Partial<Record<keyof Contract,FieldChoice>>
export const billingFlagLabels = {annual_maintenance:'年次保守料',land_cost:'土地代',insurance:'火災保険料',local_association:'自治会費',communication:'通信費',other:'その他費用'}
export const contractTransferOptions:Partial<Record<keyof Contract,readonly string[]>>={
  billing_method:['請求書','口座振替'],
  plan_inspection:['なし','年1回','年2回','年3回','年4回','無制限'],
  plan_weeding:['なし','年1回','年2回','年3回','年4回','無制限'],
  plan_emergency:['なし','年1回','年2回','年3回','年4回','無制限'],
  meti_setup_report_status:['未','申請中','受理','不備'],
}
export function validateContractBillingSettings(contract:Record<string,unknown>,choices:ContractChoices) {
  for(const [key,options] of Object.entries(contractTransferOptions)) {
    const choice=choices[key as keyof Contract]
    if(choice?.mode==='change'&&!options.includes(String(choice.value)))throw Error(`${contractTransferLabels[key as keyof Contract]}を選択してください`)
  }
  // Preserving a legacy contract never silently repairs or normalizes it.
  const billingKeys=['billing_method','billing_count','billing_schedule_days','billing_amount_overrides','billing_item_flags',
    'annual_maintenance_ex','annual_maintenance_inc','billing_amount_ex','billing_amount_inc','land_cost_monthly','insurance_fee',
    'other_fee','communication_fee','local_association_fee','has_issuance_fee','issuance_fee_ex','issuance_fee_inc','has_transfer_fee','transfer_fee_ex','transfer_fee_inc']
  if(!billingKeys.some(k=>choices[k as keyof Contract]&&choices[k as keyof Contract]!.mode!=='keep'))return
  if(!['請求書','口座振替'].includes(String(contract.billing_method)))throw Error('請求方法を選択してください')
  const debit=contract.billing_method==='口座振替',days=contract.billing_schedule_days
  if(!Array.isArray(days)||!days.length)throw Error('請求予定日を入力してください')
  const rounds=debit?12:days.length
  if(debit&&days.length!==1)throw Error('口座振替の予定日は毎月の1日分を指定してください')
  if(contract.billing_count!=null&&contract.billing_count!==rounds)throw Error('請求回数と予定日の数が一致しません（口座振替は12回）')
  for(const day of days){
    const match=String(day).match(debit?/^(\d{1,2})日$/:/^(\d{1,2})月(\d{1,2})日$/)
    if(!match)throw Error('請求予定日は「6月15日」、口座振替は「25日」の形式です')
    const month=debit?1:Number(match[1]),d=Number(match[debit?1:2]),date=new Date(Date.UTC(2000,month-1,d))
    if(date.getUTCMonth()!==month-1||date.getUTCDate()!==d)throw Error('請求予定日が存在しません')
  }
  for(const [key,value] of Object.entries((contract.billing_amount_overrides??{}) as object))
    if(!/^[1-9]\d*$/.test(key)||Number(key)>rounds||typeof value!=='number'||!Number.isSafeInteger(value)||value<0)throw Error('個別金額と対象回・月を確認してください')
  for(const [key,value] of Object.entries((contract.billing_item_flags??{}) as object))
    if(!Object.hasOwn(billingFlagLabels,key)||typeof value!=='boolean')throw Error('請求に含める項目を確認してください')
  for(const prefix of [debit?'transfer':'issuance'])if(contract[`has_${prefix}_fee`]===true) {
    const amount=contract[`${prefix}_fee_inc`]
    if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<0)throw Error('手数料ありの場合は税込金額を入力してください')
  }
}
