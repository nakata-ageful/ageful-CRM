import type { Contract, Project } from '../types'
import { copyJson } from './billing-json'
import { isBillingDate } from './billing-unit'

type Kind = 'text' | 'number' | 'boolean' | 'date' | 'strings' | 'amounts' | 'flags' | 'protected'
// Explicit keys: adding a model field must require a policy review at type-check time.
export const contractFieldKinds = {
  id:'protected', project_id:'protected', created_at:'protected', ownership_transfer_date:'protected',
  billing_method:'text', billing_due_day:'text', billing_amount_ex:'number', billing_amount_inc:'number',
  annual_maintenance_ex:'number', annual_maintenance_inc:'number', land_cost_monthly:'number',
  insurance_fee:'number', other_fee:'number', communication_fee:'number', local_association_fee:'number',
  transfer_fee:'number', transfer_account:'number', sale_contract_date:'date', equipment_contract_date:'date',
  land_contract_date:'date', maintenance_contract_date:'date', sales_to_neosys:'text', neosys_to_referrer:'text',
  contractor_name:'text', billing_count:'number', subcontractor:'text', subcontract_fee_ex:'number',
  subcontract_fee_inc:'number', subcontract_billing_day:'text', subcontract_start_date:'date',
  maintenance_start_date:'date', maintenance_contractor:'text', plan_inspection:'text', plan_weeding:'text',
  plan_emergency:'text', notes:'text', equipment_contract_notes:'text', land_contract_notes:'text',
  maintenance_contract_notes:'text', maintenance_content_notes:'text', subcontract_notes:'text',
  has_meti_setup_report:'boolean', has_meti_periodic_report:'boolean', meti_setup_report_date:'date',
  meti_setup_report_status:'text', has_issuance_fee:'boolean', issuance_fee_ex:'number', issuance_fee_inc:'number',
  has_transfer_fee:'boolean', transfer_fee_ex:'number', transfer_fee_inc:'number', billing_schedule_days:'strings',
  billing_amount_overrides:'amounts', billing_item_flags:'flags',
} as const satisfies Record<keyof Contract, Kind>
export const projectFieldKinds = {
  id:'protected', customer_id:'protected', old_owner:'protected', created_at:'protected',
  summary_notes:'text', meti_notes:'text', power_company_notes:'text', project_no:'text', project_name:'text',
  plant_name:'text', site_postal_code:'text', site_prefecture:'text', site_address:'text', latitude:'number',
  longitude:'number', google_coordinates:'text', panel_kw:'number', panel_count:'number', panel_maker:'text',
  panel_model:'text', panel_notes:'text', pcs_kw:'number', pcs_count:'number', pcs_maker:'text', pcs_model:'text',
  pcs_notes:'text', grid_id:'text', grid_certified_at:'date', fit_period:'number', fit_term_years:'number',
  fit_end_date:'date', power_supply_start_date:'date', customer_number:'text', generation_point_id:'text',
  meter_reading_day:'text', monitoring_system:'text', monitoring_model:'text', monitoring_id:'text',
  monitoring_user:'text', monitoring_pw:'text', has_4g:'boolean', monitoring_notes:'text', key_number:'text',
  local_association:'text', sales_company:'text', referrer:'text', customer_referrer:'text', project_referrer:'text',
  power_change_date:'date', handover_date:'date', sales_price:'number', reference_price:'number', land_cost:'number',
  amuras_member_no:'text', notes:'text',
} as const satisfies Record<keyof Project, Kind>

export type FieldChoice = { mode:'keep' } | { mode:'clear' } | { mode:'change'; value:unknown }
type Choices = { contract?:Partial<Record<keyof Contract,FieldChoice>>; project?:Partial<Record<keyof Project,FieldChoice>> }
const own = (o:object,k:string) => Object.prototype.hasOwnProperty.call(o,k)
function valid(kind:Kind,value:unknown):boolean {
  if (value === null) return true
  if (kind === 'text') return typeof value === 'string'
  if (kind === 'date') return typeof value === 'string' && isBillingDate(value)
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (kind === 'boolean') return typeof value === 'boolean'
  if (kind === 'strings') return Array.isArray(value) && value.every(v=>typeof v==='string')
  if (kind === 'amounts' || kind === 'flags') return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every(v=>kind==='flags' ? typeof v==='boolean' : typeof v==='number' && Number.isSafeInteger(v) && v>=0)
  return false
}
function select(before:Record<string,unknown>,rules:Record<string,Kind>,choices:Record<string,FieldChoice>) {
  for (const key of Object.keys(before)) if (!own(rules,key)) throw new Error(`未分類の項目です: ${key}`)
  const after=copyJson(before)
  const decisions:Record<string,FieldChoice>={}
  for (const [key,choice] of Object.entries(choices)) {
    if (!own(rules,key) || rules[key]==='protected') throw new Error(`選択できないシステム項目です: ${key}`)
    if (!choice || !['keep','clear','change'].includes(choice.mode)) throw new Error(`選択内容が不正です: ${key}`)
    if (choice.mode==='change' && !valid(rules[key],choice.value)) throw new Error(`値の形式を確認してください: ${key}`)
    if (choice.mode==='clear') after[key]=null
    if (choice.mode==='change') after[key]=copyJson(choice.value)
  }
  for (const key of Object.keys(rules)) {
    if (rules[key]!=='protected') decisions[key]=copyJson(choices[key] ?? { mode:'keep' })
  }
  return { after, decisions }
}

/** D-026 selection draft only. No DB writes, system owner/date changes or invoice recalculation. */
export function prepareOwnershipFields(project:Project,contract:Contract,choices:Choices={}) {
  if (contract.project_id!==project.id) throw new Error('発電所と契約が一致しません')
  const before={project:copyJson(project),contract:copyJson(contract)}
  const p=select(before.project,projectFieldKinds,choices.project ?? {})
  const c=select(before.contract,contractFieldKinds,choices.contract ?? {})
  if (typeof p.after.project_name!=='string' || !p.after.project_name.trim()) throw new Error('発電所名は空欄にできません')
  // Display falls back to this legacy date; clearing only the new key would resurrect A's date.
  if (own(choices.contract ?? {},'equipment_contract_date') && c.after.equipment_contract_date===null
    && c.after.sale_contract_date!=null) throw new Error('設備売買契約日を空欄にする場合は旧売買契約日も引き継がない指定が必要です')
  return { before, after:{project:p.after,contract:c.after}, decisions:{project:p.decisions,contract:c.decisions},
    snapshotSchemaVersion:1, readyToWrite:false as const }
}
