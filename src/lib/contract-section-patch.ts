import type { Contract } from '../types'

// A section save must not resubmit unrelated (possibly stale) billing settings.
export const contractSectionKeys = {
  'equipment-contract': ['equipment_contract_date', 'sales_to_neosys', 'neosys_to_referrer', 'equipment_contract_notes'],
  'land-contract': ['land_contract_date', 'land_contract_notes'],
  'maintenance-contract': ['maintenance_contractor', 'annual_maintenance_ex', 'annual_maintenance_inc',
    'maintenance_contract_date', 'maintenance_start_date', 'maintenance_contract_notes'],
  'maintenance-content': ['plan_weeding', 'plan_inspection', 'plan_emergency', 'land_cost_monthly',
    'local_association_fee', 'communication_fee', 'insurance_fee', 'other_fee', 'has_meti_setup_report',
    'has_meti_periodic_report', 'meti_setup_report_date', 'meti_setup_report_status', 'maintenance_content_notes'],
  subcontract: ['subcontractor', 'subcontract_fee_ex', 'subcontract_fee_inc', 'subcontract_billing_day',
    'subcontract_start_date', 'subcontract_notes'],
  billing: ['billing_method', 'billing_due_day', 'billing_count', 'billing_schedule_days', 'billing_item_flags',
    'has_issuance_fee', 'issuance_fee_ex', 'issuance_fee_inc', 'has_transfer_fee', 'transfer_fee_ex',
    'transfer_fee_inc', 'billing_amount_overrides', 'notes'],
} as const satisfies Record<string, readonly (keyof Contract)[]>

export function contractSectionPatch(section: string, payload: Partial<Contract>): Partial<Contract> {
  if (!Object.hasOwn(contractSectionKeys, section)) throw new Error('保存する契約区分を確認してください')
  const keys = contractSectionKeys[section as keyof typeof contractSectionKeys]
  return Object.fromEntries(keys.filter(key => Object.hasOwn(payload, key)).map(key => [key, payload[key]]))
}
