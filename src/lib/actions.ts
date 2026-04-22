import { hasSupabaseEnv, supabase } from './supabase'
import {
  customerStore, projectStore, contractStore, annualRecordStore,
  maintenanceResponseStore, periodicMaintenanceStore, attachmentStore,
  prospectStore,
} from './mock-store'
import type {
  Customer, Project, Contract, AnnualRecord, MaintenanceResponse, PeriodicMaintenance,
  Attachment, CustomerInput, MaintenanceResponseInput, PeriodicMaintenanceInput,
  AnnualRecordInput, AnnualRecordStatus, CsvImportRow, BillingImportRow, Prospect, ProspectInput,
} from '../types'
import { buildTaskMap, buildSubTaskMap } from './prospect-tasks'

function db() {
  if (!supabase) throw new Error('Supabase not configured')
  return supabase
}

function toInt(v: string): number | null {
  if (!v || v.trim() === '') return null
  // カンマ、スペース、円、全角数字を処理
  const cleaned = v.replace(/[,，\s円¥￥]/g, '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30))
  const n = parseInt(cleaned, 10)
  return isNaN(n) ? null : n
}

function toFloat(v: string): number | null {
  if (!v || v.trim() === '') return null
  const n = parseFloat(v.replace(/,/g, ''))
  return isNaN(n) ? null : n
}

function toDate(v: string): string | null {
  if (!v || v.trim() === '') return null
  let s = v.trim()
  // 日付部分だけ抽出（YYYY/MM/DD, YYYY.MM.DD, YYYY-MM-DD）、後続テキストは除去
  const m = s.match(/(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/)
  if (m) {
    const yyyy = m[1]
    const mm = m[2].padStart(2, '0')
    const dd = m[3].padStart(2, '0')
    return `${yyyy}-${mm}-${dd}`
  }
  // YYYY/MM や YYYY.MM のみ（日なし）
  const m2 = s.match(/(\d{4})[\/.\-](\d{1,2})/)
  if (m2) {
    return `${m2[1]}-${m2[2].padStart(2, '0')}-01`
  }
  return null
}

// ── Validation helpers ────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** ilike パターン内の特殊文字（% と _）をエスケープする */
function escapeIlike(value: string): string {
  return value.replace(/%/g, '\\%').replace(/_/g, '\\_')
}

// ── Customer CRUD ─────────────────────────────────────────

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  // メール形式チェック（警告のみ、処理は継続する）
  if (input.email && !EMAIL_RE.test(input.email)) {
    console.warn(`[createCustomer] メールアドレスの形式が不正です: ${input.email}`)
  }

  const payload = {
    name: input.name,
    company_name: input.company_name || null,
    is_corporate: input.is_corporate,
    email: input.email || null,
    phone: input.phone || null,
    postal_code: input.postal_code || null,
    address: input.address || null,
  }
  if (!hasSupabaseEnv) return customerStore.create(payload)
  const { data, error } = await db().from('customers').insert(payload).select().single()
  if (error) throw error
  return data as Customer
}

export async function updateCustomer(id: number, input: CustomerInput): Promise<Customer> {
  const payload = {
    name: input.name,
    company_name: input.company_name || null,
    is_corporate: input.is_corporate,
    email: input.email || null,
    phone: input.phone || null,
    postal_code: input.postal_code || null,
    address: input.address || null,
  }
  if (!hasSupabaseEnv) {
    const updated = customerStore.update(id, payload)
    if (!updated) throw new Error('Not found')
    return updated
  }
  const { data, error } = await db().from('customers').update(payload).eq('id', id).select().single()
  if (error) throw error
  return data as Customer
}

export async function deleteCustomer(id: number): Promise<void> {
  if (!hasSupabaseEnv) { customerStore.delete(id); return }
  const { error } = await db().from('customers').delete().eq('id', id)
  if (error) throw error
}

// ── Project CRUD ──────────────────────────────────────────

export type ProjectInput = {
  customer_id: number
  project_no: string
  project_name: string
  plant_name: string
  site_postal_code: string
  site_prefecture: string
  site_address: string
  latitude: string
  longitude: string
  panel_kw: string
  panel_count: string
  panel_maker: string
  panel_model: string
  pcs_kw: string
  pcs_count: string
  pcs_maker: string
  pcs_model: string
  grid_id: string
  grid_certified_at: string
  fit_period: string
  power_supply_start_date: string
  customer_number: string
  generation_point_id: string
  meter_reading_day: string
  monitoring_system: string
  monitoring_id: string
  monitoring_user: string
  monitoring_pw: string
  has_4g: boolean
  key_number: string
  local_association: string
  old_owner: string
  sales_company: string
  referrer: string
  power_change_date: string
  handover_date: string
  sales_price: string
  reference_price: string
  land_cost: string
  amuras_member_no: string
  notes: string
}

function projectPayload(input: Omit<ProjectInput, 'customer_id'>): Omit<Project, 'id' | 'created_at' | 'customer_id'> {
  return {
    project_no: input.project_no || null,
    project_name: input.project_name,
    plant_name: input.plant_name || null,
    site_postal_code: input.site_postal_code || null,
    site_prefecture: input.site_prefecture || null,
    site_address: input.site_address || null,
    latitude: toFloat(input.latitude),
    longitude: toFloat(input.longitude),
    panel_kw: toFloat(input.panel_kw),
    panel_count: toInt(input.panel_count),
    panel_maker: input.panel_maker || null,
    panel_model: input.panel_model || null,
    pcs_kw: toFloat(input.pcs_kw),
    pcs_count: toInt(input.pcs_count),
    pcs_maker: input.pcs_maker || null,
    pcs_model: input.pcs_model || null,
    grid_id: input.grid_id || null,
    grid_certified_at: toDate(input.grid_certified_at),
    fit_period: toInt(input.fit_period),
    power_supply_start_date: toDate(input.power_supply_start_date),
    customer_number: input.customer_number || null,
    generation_point_id: input.generation_point_id || null,
    meter_reading_day: input.meter_reading_day || null,
    monitoring_system: input.monitoring_system || null,
    monitoring_id: input.monitoring_id || null,
    monitoring_user: input.monitoring_user || null,
    monitoring_pw: input.monitoring_pw || null,
    has_4g: input.has_4g ?? null,
    key_number: input.key_number || null,
    local_association: input.local_association || null,
    old_owner: input.old_owner || null,
    sales_company: input.sales_company || null,
    referrer: input.referrer || null,
    power_change_date: toDate(input.power_change_date),
    handover_date: toDate(input.handover_date),
    sales_price: toInt(input.sales_price),
    reference_price: toInt(input.reference_price),
    land_cost: toInt(input.land_cost),
    amuras_member_no: input.amuras_member_no || null,
    notes: input.notes || null,
  }
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const payload = { customer_id: input.customer_id, ...projectPayload(input) }
  if (!hasSupabaseEnv) return projectStore.create(payload)
  const { data, error } = await db().from('projects').insert(payload).select().single()
  if (error) throw error
  return data as Project
}

export async function updateProject(id: number, input: Omit<ProjectInput, 'customer_id'>): Promise<Project> {
  const payload = projectPayload(input)
  if (!hasSupabaseEnv) {
    const updated = projectStore.update(id, payload)
    if (!updated) throw new Error('Not found')
    return updated
  }
  const { data, error } = await db().from('projects').update(payload).eq('id', id).select().single()
  if (error) throw error
  return data as Project
}

export async function deleteProject(id: number): Promise<void> {
  if (!hasSupabaseEnv) { projectStore.delete(id); return }
  const { error } = await db().from('projects').delete().eq('id', id)
  if (error) throw error
}

// ── Maintenance Response CRUD ─────────────────────────────

async function generateResponseNo(): Promise<string> {
  const yy = String(new Date().getFullYear()).slice(-2)
  const prefix = yy
  if (!hasSupabaseEnv) {
    const all = maintenanceResponseStore.getAll()
    const thisYearNos = all
      .map(m => m.response_no)
      .filter((no): no is string => no != null && no.startsWith(prefix))
      .map(no => parseInt(no.slice(2), 10))
      .filter(n => !isNaN(n))
    const max = thisYearNos.length > 0 ? Math.max(...thisYearNos) : 0
    return `${prefix}${String(max + 1).padStart(3, '0')}`
  }
  const { data } = await db()
    .from('maintenance_responses')
    .select('response_no')
    .like('response_no', `${prefix}%`)
    .order('response_no', { ascending: false })
    .limit(1)
  if (data && data.length > 0 && data[0].response_no) {
    const num = parseInt(data[0].response_no.slice(2), 10)
    return `${prefix}${String((isNaN(num) ? 0 : num) + 1).padStart(3, '0')}`
  }
  return `${prefix}001`
}

export async function createMaintenanceResponse(input: MaintenanceResponseInput): Promise<MaintenanceResponse> {
  const autoNo = await generateResponseNo()
  const payload = {
    project_id: input.project_id,
    response_no: autoNo,
    status: '対応中' as const,
    inquiry_date: input.inquiry_date || null,
    occurrence_date: input.occurrence_date || null,
    target_area: input.target_area || null,
    situation: input.situation || null,
    response_content: input.response_content || null,
    report: input.report || null,
  }
  if (!hasSupabaseEnv) return maintenanceResponseStore.create(payload)
  const { data, error } = await db().from('maintenance_responses').insert(payload).select().single()
  if (error) throw error
  return data as MaintenanceResponse
}

export async function updateMaintenanceResponse(
  id: number,
  input: Partial<MaintenanceResponseInput & { status: '対応中' | '完了' }>
): Promise<void> {
  const payload: Partial<MaintenanceResponse> = {
    inquiry_date: input.inquiry_date || null,
    occurrence_date: input.occurrence_date || null,
    target_area: input.target_area || null,
    situation: input.situation || null,
    response_content: input.response_content || null,
    report: input.report || null,
    status: input.status,
  }
  if (!hasSupabaseEnv) { maintenanceResponseStore.update(id, payload); return }
  const { error } = await db().from('maintenance_responses').update(payload).eq('id', id)
  if (error) throw error
}

export async function completeMaintenanceResponse(id: number): Promise<void> {
  if (!hasSupabaseEnv) { maintenanceResponseStore.update(id, { status: '完了' }); return }
  const { error } = await db().from('maintenance_responses').update({ status: '完了' }).eq('id', id)
  if (error) throw error
}

export async function deleteMaintenanceResponse(id: number): Promise<void> {
  if (!hasSupabaseEnv) { maintenanceResponseStore.delete(id); return }
  const { error } = await db().from('maintenance_responses').delete().eq('id', id)
  if (error) throw error
}

// ── Periodic Maintenance CRUD ─────────────────────────────

export async function createPeriodicMaintenance(input: PeriodicMaintenanceInput): Promise<PeriodicMaintenance> {
  const payload = {
    project_id: input.project_id,
    record_date: input.record_date,
    work_type: input.work_type || null,
    content: input.content || null,
  }
  if (!hasSupabaseEnv) return periodicMaintenanceStore.create(payload)
  const { data, error } = await db().from('periodic_maintenance').insert(payload).select().single()
  if (error) throw error
  return data as PeriodicMaintenance
}

export async function deletePeriodicMaintenance(id: number): Promise<void> {
  if (!hasSupabaseEnv) { periodicMaintenanceStore.delete(id); return }
  const { error } = await db().from('periodic_maintenance').delete().eq('id', id)
  if (error) throw error
}

// ── Annual Record CRUD ────────────────────────────────────

export async function upsertAnnualRecord(input: AnnualRecordInput): Promise<AnnualRecord> {
  const payload = {
    contract_id: input.contract_id,
    year: input.year,
    billing_scheduled_date: null,
    billing_date: input.billing_date || null,
    payment_due_date: null,
    received_date: input.received_date || null,
    line_items: null,
    maintenance_record: input.maintenance_record || null,
    escort_record: input.escort_record || null,
    transfer_failed: null,
    payments: null,
    // ステータスは常に請求日・入金日から自動算出（手動設定による不整合を防ぐ）
    status: (input.billing_date
      ? (input.received_date ? '入金済' : '請求済')
      : '') as AnnualRecordStatus,
  }
  if (!hasSupabaseEnv) {
    const existing = annualRecordStore.getByContractId(input.contract_id).find(r => r.year === input.year)
    if (existing) {
      return annualRecordStore.update(existing.id, payload) ?? existing
    }
    return annualRecordStore.create(payload)
  }
  const { data, error } = await db()
    .from('annual_records')
    .upsert(payload, { onConflict: 'contract_id,year' })
    .select()
    .single()
  if (error) throw error
  return data as AnnualRecord
}

export async function updateAnnualRecordStatus(id: number, status: AnnualRecordStatus): Promise<void> {
  if (!hasSupabaseEnv) { annualRecordStore.update(id, { status }); return }
  const { error } = await db().from('annual_records').update({ status }).eq('id', id)
  if (error) throw error
}

export async function updateAnnualRecord(
  id: number,
  input: Partial<Pick<AnnualRecord, 'billing_scheduled_date' | 'billing_date' | 'payment_due_date' | 'received_date' | 'line_items' | 'payments' | 'transfer_failed' | 'status'>>
): Promise<void> {
  if (!hasSupabaseEnv) { annualRecordStore.update(id, input); return }
  const { error } = await db().from('annual_records').update(input).eq('id', id)
  if (error) throw error
}

export async function createAnnualRecord(
  contractId: number,
  year: number,
  input: Partial<Pick<AnnualRecord, 'billing_scheduled_date' | 'billing_date' | 'payment_due_date' | 'received_date' | 'line_items' | 'payments' | 'transfer_failed'>>
): Promise<AnnualRecord> {
  const status = (input.billing_date
    ? (input.received_date ? '入金済' : '請求済')
    : '') as AnnualRecordStatus
  const payload = { contract_id: contractId, year, status, ...input }
  if (!hasSupabaseEnv) return annualRecordStore.create(payload as Omit<AnnualRecord, 'id'>)
  const { data, error } = await db().from('annual_records').insert(payload).select().single()
  if (error) throw error
  return data as AnnualRecord
}

export async function deleteAnnualRecord(id: number): Promise<void> {
  if (!hasSupabaseEnv) { annualRecordStore.delete(id); return }
  const { error } = await db().from('annual_records').delete().eq('id', id)
  if (error) throw error
}

// ── Contract CRUD ─────────────────────────────────────────

export async function createContract(projectId: number, input: Partial<Omit<Contract, 'id' | 'created_at' | 'project_id'>>): Promise<Contract> {
  const payload = { project_id: projectId, ...input }
  if (!hasSupabaseEnv) return contractStore.create(payload as Omit<Contract, 'id' | 'created_at'>)
  const { data, error } = await db().from('contracts').insert(payload).select().single()
  if (error) throw error
  return data as Contract
}

export async function updateContract(id: number, input: Partial<Omit<Contract, 'id' | 'created_at'>>): Promise<void> {
  if (!hasSupabaseEnv) { contractStore.update(id, input); return }
  const { error } = await db().from('contracts').update(input).eq('id', id)
  if (error) throw error
}

// ── CSV Bulk Import ────────────────────────────────────────

export async function bulkImportProjects(
  rows: CsvImportRow[]
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0
  let failed = 0
  const errors: string[] = []
  const custIdCache: Record<string, number> = {}

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      // 顧客の名寄せ / 作成
      let customerId: number
      const custKey = row.customer_name || row.company_name || '（名前未設定）'
      if (custIdCache[custKey]) {
        customerId = custIdCache[custKey]
      } else if (!hasSupabaseEnv) {
        const existing = row.customer_name || row.company_name ? customerStore.findByName(custKey) : null
        if (existing) {
          customerId = existing.id
        } else {
          const newCust = customerStore.create({
            name: row.customer_name || row.company_name || '（名前未設定）',
            company_name: row.company_name || null,
            is_corporate: !!row.company_name,
            email: row.email || null,
            phone: row.phone || null,
            postal_code: row.postal_code || null,
            address: row.customer_address || null,
          })
          customerId = newCust.id
        }
        custIdCache[custKey] = customerId
      } else {
        const customerName = row.customer_name || row.company_name || '（名前未設定）'
        const { data: existingArr } = await db()
          .from('customers')
          .select('id')
          .eq('name', customerName)
          .limit(1)
        const existing = existingArr?.[0] ?? null
        if (existing) {
          customerId = (existing as { id: number }).id
        } else {
          const { data: newCust, error: custErr } = await db()
            .from('customers')
            .insert({
              name: customerName,
              company_name: row.company_name || null,
              is_corporate: !!row.company_name,
              email: row.email || null,
              phone: row.phone || null,
              postal_code: row.postal_code?.replace(/[〒　\s]/g, '') || null,
              address: row.customer_address || null,
            })
            .select()
            .single()
          if (custErr) throw custErr
          customerId = (newCust as { id: number }).id
        }
        custIdCache[custKey] = customerId
      }

      // 案件作成
      // 4G対応: '有'/'可'/'要' → true, '無'/'ー'/'-' → false, 空 → null
      function parseHas4g(v?: string): boolean | null {
        if (!v || v.trim() === '') return null
        const t = v.trim()
        if (['有', '可', '要', '済'].includes(t)) return true
        if (['無', 'ー', '-', 'ー', 'なし'].includes(t)) return false
        return null
      }

      const projPayload = {
        customer_id: customerId,
        project_no: row.project_number || null,
        project_name: row.project_name || '（案件名未設定）',
        plant_name: row.plant_name || null,
        site_postal_code: row.site_postal_code?.replace(/[〒　\s]/g, '') || null,
        site_prefecture: row.site_address ? row.site_address.match(/^(.{2,3}[都道府県])/)?.[1] ?? null : null,
        site_address: row.site_address || null,
        latitude: toFloat(row.latitude),
        longitude: toFloat(row.longitude),
        panel_kw: toFloat(row.panel_kw),
        panel_count: toInt(row.panel_count),
        panel_maker: row.panel_manufacturer || null,
        panel_model: row.panel_model || null,
        pcs_kw: toFloat(row.pcs_kw),
        pcs_count: toInt(row.pcs_count),
        pcs_maker: row.pcs_manufacturer || null,
        pcs_model: row.pcs_model || null,
        grid_id: row.grid_id || null,
        grid_certified_at: toDate(row.grid_certified_at),
        fit_period: toInt(row.fit_period),
        power_supply_start_date: toDate(row.power_supply_start_date),
        customer_number: row.customer_number || null,
        generation_point_id: row.generation_point_id || null,
        meter_reading_day: row.meter_reading_day || null,
        monitoring_system: row.monitoring_system || null,
        monitoring_id: row.monitoring_id || null,
        monitoring_user: null,
        monitoring_pw: row.monitoring_pw || null,
        has_4g: parseHas4g(row.has_4g_str),
        key_number: row.key_number || null,
        local_association: row.local_association || null,
        old_owner: row.old_owner || null,
        sales_company: row.sales_company || null,
        referrer: row.referrer || null,
        power_change_date: toDate(row.power_change_date ?? ''),
        handover_date: toDate(row.handover_date),
        sales_price: toInt(row.sales_price),
        reference_price: toInt(row.reference_price),
        land_cost: toInt(row.land_cost),
        amuras_member_no: row.amuras_member_no || null,
        notes: row.notes || null,
      }

      let projectId: number
      // 既存案件の重複チェック（案件名 + 顧客ID）
      if (!hasSupabaseEnv) {
        const existingProj = projectStore.getAll().find(p => p.project_name === projPayload.project_name && p.customer_id === customerId)
        if (existingProj) {
          projectId = existingProj.id
        } else {
          const proj = projectStore.create(projPayload)
          projectId = proj.id
        }
      } else {
        const { data: existingProj } = await db()
          .from('projects')
          .select('id')
          .eq('project_name', projPayload.project_name)
          .eq('customer_id', customerId)
          .limit(1)
        if (existingProj?.[0]) {
          projectId = (existingProj[0] as { id: number }).id
        } else {
          const { data: projData, error: projErr } = await db().from('projects').insert(projPayload).select('id').single()
          if (projErr) throw projErr
          projectId = (projData as { id: number }).id
        }
      }

      // 契約情報があれば作成
      if (row.billing_method || row.billing_amount_inc || row.annual_maintenance_inc || row.maintenance_start_date
          || row.land_cost_monthly || row.insurance_fee || row.other_fee
          || row.sale_contract_date || row.equipment_contract_date || row.land_contract_date || row.maintenance_contract_date
          || row.sales_to_neosys || row.neosys_to_referrer || row.contractor_name || row.transfer_fee) {
        const contractPayload = {
          project_id: projectId,
          billing_method: row.billing_method || null,
          billing_due_day: row.billing_due_day || null,
          billing_amount_ex: toInt(row.billing_amount_ex ?? ''),
          billing_amount_inc: toInt(row.billing_amount_inc ?? ''),
          annual_maintenance_ex: toInt(row.annual_maintenance_ex ?? ''),
          annual_maintenance_inc: toInt(row.annual_maintenance_inc ?? ''),
          land_cost_monthly: toInt(row.land_cost_monthly ?? ''),
          insurance_fee: toInt(row.insurance_fee ?? ''),
          other_fee: toInt(row.other_fee ?? ''),
          transfer_fee: toInt(row.transfer_fee ?? ''),
          transfer_account: null,
          sale_contract_date: toDate(row.sale_contract_date ?? ''),
          equipment_contract_date: toDate(row.equipment_contract_date ?? ''),
          land_contract_date: toDate(row.land_contract_date ?? ''),
          maintenance_contract_date: toDate(row.maintenance_contract_date ?? ''),
          sales_to_neosys: row.sales_to_neosys || null,
          neosys_to_referrer: row.neosys_to_referrer || null,
          contractor_name: row.contractor_name || null,
          subcontractor: row.subcontractor || null,
          subcontract_fee_ex: toInt(row.subcontract_fee_ex ?? ''),
          subcontract_fee_inc: toInt(row.subcontract_fee_inc ?? ''),
          subcontract_billing_day: null,
          subcontract_start_date: toDate(row.subcontract_start_date ?? ''),
          maintenance_start_date: toDate(row.maintenance_start_date ?? ''),
          billing_count: null,
          plan_inspection: null, plan_weeding: null, plan_emergency: null,
          notes: row.contract_notes || null,
        }
        // 既存契約があれば更新、なければ作成
        if (!hasSupabaseEnv) {
          const existingContract = contractStore.getByProjectId(projectId)
          if (existingContract) {
            contractStore.update(existingContract.id, contractPayload)
          } else {
            contractStore.create(contractPayload)
          }
        } else {
          const { data: existingContracts } = await db()
            .from('contracts')
            .select('id')
            .eq('project_id', projectId)
            .limit(1)
          if (existingContracts?.[0]) {
            const { error: cErr } = await db().from('contracts').update(contractPayload).eq('id', (existingContracts[0] as { id: number }).id)
            if (cErr) throw cErr
          } else {
            const { error: cErr } = await db().from('contracts').insert(contractPayload)
            if (cErr) throw cErr
          }
        }
      }

      success++
    } catch (e) {
      failed++
      errors.push(`行${i + 2}（${row.project_name || '?'}）: ${String(e)}`)
    }
  }

  return { success, failed, errors }
}

// ── 請求CSV一括インポート ─────────────────────────────────

export async function bulkImportBilling(
  rows: BillingImportRow[]
): Promise<{ success: number; failed: number; skipped: number; errors: string[] }> {
  let success = 0
  let failed = 0
  let skipped = 0
  const errors: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      // 案件名で既存プロジェクトを検索
      let projectId: number | null = null

      if (!hasSupabaseEnv) {
        const allProjects = projectStore.getAll()
        // 案件名の部分一致（請求CSVは短縮名の場合がある）
        const match = allProjects.find(p =>
          p.project_name === row.project_name
          || p.project_name.includes(row.project_name)
          || row.project_name.includes(p.project_name)
        )
        if (match) projectId = match.id
      } else {
        // まず完全一致
        const { data: exact } = await db()
          .from('projects')
          .select('id')
          .eq('project_name', row.project_name)
          .limit(1)
        if (exact?.[0]) {
          projectId = (exact[0] as { id: number }).id
        } else {
          // 部分一致（案件名を含む）— 特殊文字をエスケープ
          const { data: partial } = await db()
            .from('projects')
            .select('id, project_name')
            .ilike('project_name', `%${escapeIlike(row.project_name)}%`)
            .limit(1)
          if (partial?.[0]) {
            projectId = (partial[0] as { id: number }).id
          }
        }
      }

      if (!projectId) {
        skipped++
        errors.push(`行${i + 1}「${row.project_name}」: 該当する案件が見つかりません`)
        continue
      }

      // 既存の契約を確認（なければ作成）
      let contractId: number | null = null
      if (!hasSupabaseEnv) {
        const existing = contractStore.getByProjectId(projectId)
        if (existing) {
          contractId = existing.id
        }
      } else {
        const { data: existingContracts } = await db()
          .from('contracts')
          .select('id')
          .eq('project_id', projectId)
          .limit(1)
        if (existingContracts?.[0]) {
          contractId = (existingContracts[0] as { id: number }).id
        }
      }

      const contractPayload = {
        project_id: projectId,
        billing_method: row.billing_method || null,
        billing_due_day: row.billing_due_day || null,
        billing_amount_ex: toInt(row.billing_amount_ex),
        billing_amount_inc: toInt(row.billing_amount_inc),
        annual_maintenance_ex: toInt(row.annual_maintenance_ex),
        annual_maintenance_inc: toInt(row.annual_maintenance_inc),
        land_cost_monthly: toInt(row.land_cost_monthly),
        insurance_fee: toInt(row.insurance_fee),
        other_fee: toInt(row.work_fee),
        transfer_fee: toInt(row.transfer_fee),
        transfer_account: null,
        sale_contract_date: null,
        equipment_contract_date: null,
        land_contract_date: null,
        maintenance_contract_date: null,
        sales_to_neosys: null,
        neosys_to_referrer: null,
        contractor_name: null,
        subcontractor: row.subcontractor || null,
        subcontract_fee_ex: toInt(row.subcontract_fee_ex),
        subcontract_fee_inc: toInt(row.subcontract_fee_inc),
        subcontract_billing_day: row.subcontract_billing_day || null,
        subcontract_start_date: toDate(row.subcontract_start_date),
        maintenance_start_date: toDate(row.maintenance_start),
        billing_count: null,
        plan_inspection: null, plan_weeding: null, plan_emergency: null,
        notes: [row.notes, row.auto_recovery ? `自動復旧: ${row.auto_recovery}` : ''].filter(Boolean).join('\n') || null,
      }

      if (contractId) {
        // 既存契約を更新
        if (!hasSupabaseEnv) {
          contractStore.update(contractId, contractPayload)
        } else {
          const { error: cErr } = await db().from('contracts').update(contractPayload).eq('id', contractId)
          if (cErr) throw cErr
        }
      } else {
        // 新規契約作成
        if (!hasSupabaseEnv) {
          const newContract = contractStore.create(contractPayload)
          contractId = newContract.id
        } else {
          const { data: cData, error: cErr } = await db().from('contracts').insert(contractPayload).select('id').single()
          if (cErr) throw cErr
          contractId = (cData as { id: number }).id
        }
      }

      // 年度別レコード作成
      for (const yr of row.years) {
        const receivedDate = toDate(yr.received_date)
        const billingDate = toDate(yr.billing_date)
        // ステータス自動算出
        let status: '' | '請求済' | '入金済' = ''
        if (receivedDate) status = '入金済'
        else if (billingDate) status = '請求済'

        const annualPayload = {
          contract_id: contractId!,
          year: yr.year,
          billing_scheduled_date: null,
          billing_date: billingDate,
          payment_due_date: null,
          received_date: receivedDate,
          line_items: null,
          maintenance_record: yr.maintenance_record || null,
          escort_record: yr.escort_record || null,
          transfer_failed: false,
          payments: null,
          status,
        }

        if (!hasSupabaseEnv) {
          const existing = annualRecordStore.getByContractId(contractId!).find(r => r.year === yr.year)
          if (existing) {
            annualRecordStore.update(existing.id, annualPayload)
          } else {
            annualRecordStore.create(annualPayload)
          }
        } else {
          const { error: aErr } = await db()
            .from('annual_records')
            .upsert(annualPayload, { onConflict: 'contract_id,year' })
          if (aErr) throw aErr
        }
      }

      success++
    } catch (e) {
      failed++
      errors.push(`行${i + 1}「${row.project_name}」: ${String(e)}`)
    }
  }

  return { success, failed, skipped, errors }
}

// ── Prospect CRUD ─────────────────────────────────────────

export async function createProspect(input: ProspectInput): Promise<Prospect> {
  // 顧客+案件を同時作成（見込み段階から案件情報を入力可能にするため）
  const customer = await createCustomer({
    name: input.customer_name,
    company_name: '',
    is_corporate: false,
    email: '',
    phone: '',
    postal_code: '',
    address: input.site_address || '',
  })

  await createProject({
    customer_id: customer.id,
    project_no: '', project_name: input.project_name, plant_name: '',
    site_postal_code: '', site_prefecture: '', site_address: input.site_address || '',
    latitude: '', longitude: '',
    panel_kw: input.panel_kw || '', panel_count: '',
    panel_maker: '', panel_model: '', pcs_kw: '', pcs_count: '', pcs_maker: '', pcs_model: '',
    grid_id: '', grid_certified_at: '', fit_period: '', power_supply_start_date: '',
    customer_number: '', generation_point_id: '', meter_reading_day: '',
    monitoring_system: '', monitoring_id: '', monitoring_user: '', monitoring_pw: '',
    has_4g: false, key_number: '', local_association: '', old_owner: '',
    sales_company: '', referrer: input.referrer || '',
    power_change_date: '', handover_date: '',
    sales_price: input.equipment || '',
    reference_price: '', land_cost: input.land_cost || '',
    amuras_member_no: '', notes: '',
  })

  const payload = {
    customer_name: input.customer_name,
    project_name: input.project_name,
    loan_company: input.loan_company || null,
    equipment: toInt(input.equipment),
    land_cost: toInt(input.land_cost),
    loan_amount: toInt(input.loan_amount),
    apply_status: '未' as const,
    contract_status: '未' as const,
    apply_tasks: buildTaskMap('apply', input.loan_company),
    contract_tasks: buildTaskMap('contract', input.loan_company),
    apply_sub_tasks: buildSubTaskMap('apply', input.loan_company),
    contract_sub_tasks: buildSubTaskMap('contract', input.loan_company),
    apply_memo: null,
    contract_memo: null,
    site_address: input.site_address || null,
    panel_kw: toFloat(input.panel_kw),
    referrer: input.referrer || null,
    lead_date: input.lead_date || null,
    apply_submit_date: null,
    apply_result_date: null,
    sale_contract_date: null,
    land_contract_date: null,
    handover_date: null,
    converted_customer_id: customer.id,
    converted_at: new Date().toISOString(),
  }
  if (!hasSupabaseEnv) return prospectStore.create(payload)
  const { data, error } = await db().from('prospects').insert(payload).select().single()
  if (error) throw error
  return data as Prospect
}

export async function updateProspect(id: number, data: Partial<Omit<Prospect, 'id' | 'created_at'>>, customerId?: number | null): Promise<void> {
  if (!hasSupabaseEnv) {
    prospectStore.update(id, data)
    // モック: 顧客・案件への同期
    if (customerId) syncProspectToCustomerProject(data, customerId)
    return
  }
  const { error } = await db().from('prospects').update(data).eq('id', id)
  if (error) throw error
  // 顧客・案件への同期
  if (customerId) syncProspectToCustomerProject(data, customerId)
}

/** 見込みの共有フィールド変更を顧客・案件に反映 */
async function syncProspectToCustomerProject(
  data: Partial<Omit<Prospect, 'id' | 'created_at'>>,
  customerId: number,
) {
  // 顧客テーブルへの同期
  const customerUpdate: Record<string, unknown> = {}
  if ('customer_name' in data) customerUpdate.name = data.customer_name
  if ('site_address' in data) customerUpdate.address = data.site_address || ''

  if (Object.keys(customerUpdate).length > 0) {
    if (!hasSupabaseEnv) {
      customerStore.update(customerId, customerUpdate)
    } else {
      await db().from('customers').update(customerUpdate).eq('id', customerId)
    }
  }

  // 案件テーブルへの同期（customer_id から案件を引く）
  const projectUpdate: Record<string, unknown> = {}
  if ('project_name' in data) projectUpdate.project_name = data.project_name
  if ('site_address' in data) projectUpdate.site_address = data.site_address || ''
  if ('panel_kw' in data) projectUpdate.panel_kw = data.panel_kw
  if ('referrer' in data) projectUpdate.referrer = data.referrer || ''
  if ('equipment' in data) projectUpdate.sales_price = data.equipment
  if ('land_cost' in data) projectUpdate.land_cost = data.land_cost
  if ('handover_date' in data) projectUpdate.handover_date = data.handover_date

  if (Object.keys(projectUpdate).length > 0) {
    if (!hasSupabaseEnv) {
      const proj = projectStore.getAll().find((p: { customer_id: number }) => p.customer_id === customerId)
      if (proj) projectStore.update(proj.id, projectUpdate)
    } else {
      await db().from('projects').update(projectUpdate).eq('customer_id', customerId)
    }
  }
}

export async function deleteProspect(id: number): Promise<void> {
  if (!hasSupabaseEnv) { prospectStore.delete(id); return }
  const { error } = await db().from('prospects').delete().eq('id', id)
  if (error) throw error
}

export async function convertProspectToCustomer(prospect: Prospect): Promise<number> {
  // 顧客作成
  const customer = await createCustomer({
    name: prospect.customer_name,
    company_name: '',
    is_corporate: false,
    email: '',
    phone: '',
    postal_code: '',
    address: prospect.site_address || '',
  })

  // 案件作成
  const project = await createProject({
    customer_id: customer.id,
    project_no: '', project_name: prospect.project_name, plant_name: '',
    site_postal_code: '', site_prefecture: '', site_address: prospect.site_address || '',
    latitude: '', longitude: '',
    panel_kw: prospect.panel_kw?.toString() ?? '', panel_count: '',
    panel_maker: '', panel_model: '', pcs_kw: '', pcs_count: '', pcs_maker: '', pcs_model: '',
    grid_id: '', grid_certified_at: '', fit_period: '', power_supply_start_date: '',
    customer_number: '', generation_point_id: '', meter_reading_day: '',
    monitoring_system: '', monitoring_id: '', monitoring_user: '', monitoring_pw: '',
    has_4g: false, key_number: '', local_association: '', old_owner: '',
    sales_company: '', referrer: prospect.referrer || '',
    power_change_date: '', handover_date: prospect.handover_date || '',
    sales_price: prospect.equipment?.toString() ?? '',
    reference_price: '', land_cost: prospect.land_cost?.toString() ?? '',
    amuras_member_no: '', notes: '',
  })

  // 契約作成（ローン情報を備考へ）
  const contractPayload = {
    project_id: project.id,
    billing_method: null, billing_due_day: null,
    billing_amount_ex: null, billing_amount_inc: null,
    annual_maintenance_ex: null, annual_maintenance_inc: null,
    land_cost_monthly: null, insurance_fee: null, other_fee: null,
    transfer_fee: null, transfer_account: null,
    sale_contract_date: prospect.sale_contract_date ?? null,
    equipment_contract_date: null,
    land_contract_date: prospect.land_contract_date ?? null,
    maintenance_contract_date: null,
    sales_to_neosys: null, neosys_to_referrer: null, contractor_name: null,
    subcontractor: null, subcontract_fee_ex: null, subcontract_fee_inc: null,
    subcontract_billing_day: null, subcontract_start_date: null,
    maintenance_start_date: null,
    billing_count: null,
    plan_inspection: null, plan_weeding: null, plan_emergency: null,
    notes: `ローン会社: ${prospect.loan_company ?? '未設定'} / 融資額: ${prospect.loan_amount?.toLocaleString('ja-JP') ?? '未設定'}円`,
  }
  if (!hasSupabaseEnv) {
    contractStore.create(contractPayload)
  } else {
    const { error } = await db().from('contracts').insert(contractPayload)
    if (error) throw error
  }

  // 変換済みフラグを更新
  await updateProspect(prospect.id, {
    converted_customer_id: customer.id,
    converted_at: new Date().toISOString(),
  })

  return customer.id
}

// ── Attachment ─────────────────────────────────────────────

export async function uploadAttachment(
  customerId: number,
  file: File,
  description: string,
): Promise<Attachment> {
  const fileType = file.type.includes('pdf') ? 'pdf'
    : file.type.startsWith('image/') ? 'image'
    : 'other'

  if (!hasSupabaseEnv) {
    // モード：Object URL（セッション中のみ有効）
    const url = URL.createObjectURL(file)
    return attachmentStore.create({
      customer_id: customerId,
      file_name: file.name,
      file_url: url,
      file_type: fileType,
      description: description || null,
    })
  }

  const db = supabase!
  const path = `customers/${customerId}/${Date.now()}_${file.name}`
  const { error: uploadErr } = await db.storage.from('attachments').upload(path, file)
  if (uploadErr) throw uploadErr

  const { data: { publicUrl } } = db.storage.from('attachments').getPublicUrl(path)

  const { data, error } = await db.from('attachments').insert({
    customer_id: customerId,
    file_name: file.name,
    file_url: publicUrl,
    file_type: fileType,
    description: description || null,
  }).select().single()
  if (error) throw error
  return data as Attachment
}

export async function deleteAttachment(id: number, fileUrl: string): Promise<void> {
  if (!hasSupabaseEnv) { attachmentStore.delete(id); return }

  const db = supabase!
  // Storage からも削除
  const path = fileUrl.split('/attachments/')[1]
  if (path) await db.storage.from('attachments').remove([path])
  const { error } = await db.from('attachments').delete().eq('id', id)
  if (error) throw error
}

// ── 全データエクスポート ─────────────────────────────────

export type ExportData = {
  version: 1
  exported_at: string
  customers: Record<string, unknown>[]
  projects: Record<string, unknown>[]
  contracts: Record<string, unknown>[]
  annual_records: Record<string, unknown>[]
  maintenance_responses: Record<string, unknown>[]
  periodic_maintenance: Record<string, unknown>[]
  prospects: Record<string, unknown>[]
}

export async function exportAllData(): Promise<ExportData> {
  if (!hasSupabaseEnv) {
    return {
      version: 1,
      exported_at: new Date().toISOString(),
      customers: customerStore.getAll(),
      projects: projectStore.getAll(),
      contracts: contractStore.getAll(),
      annual_records: annualRecordStore.getAll(),
      maintenance_responses: maintenanceResponseStore.getAll(),
      periodic_maintenance: periodicMaintenanceStore.getAll(),
      prospects: prospectStore.getAll(),
    }
  }
  const client = db()
  const [customers, projects, contracts, annualRecords, maintenance, periodic, prospects] = await Promise.all([
    client.from('customers').select('*').order('id'),
    client.from('projects').select('*').order('id'),
    client.from('contracts').select('*').order('id'),
    client.from('annual_records').select('*').order('id'),
    client.from('maintenance_responses').select('*').order('id'),
    client.from('periodic_maintenance').select('*').order('id'),
    client.from('prospects').select('*').order('id'),
  ])
  return {
    version: 1,
    exported_at: new Date().toISOString(),
    customers: (customers.data ?? []) as Record<string, unknown>[],
    projects: (projects.data ?? []) as Record<string, unknown>[],
    contracts: (contracts.data ?? []) as Record<string, unknown>[],
    annual_records: (annualRecords.data ?? []) as Record<string, unknown>[],
    maintenance_responses: (maintenance.data ?? []) as Record<string, unknown>[],
    periodic_maintenance: (periodic.data ?? []) as Record<string, unknown>[],
    prospects: (prospects.data ?? []) as Record<string, unknown>[],
  }
}

// ── 全データ復元インポート ───────────────────────────────

export async function restoreAllData(
  data: ExportData,
  onProgress?: (msg: string) => void,
): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = []
  const log = (msg: string) => onProgress?.(msg)

  // IDマッピング: old_id → new_id
  const customerIdMap = new Map<number, number>()
  const projectIdMap = new Map<number, number>()
  const contractIdMap = new Map<number, number>()

  // 1. customers（名前で重複チェック）
  log(`顧客を復元中... (${data.customers.length}件)`)
  for (const row of data.customers) {
    try {
      const { id: oldId, created_at: _ca, updated_at: _ua, project_count: _pc, ...payload } = row as Record<string, unknown>
      let newId: number
      if (!hasSupabaseEnv) {
        const existing = customerStore.findByName(row.name as string)
        if (existing) {
          newId = existing.id
        } else {
          const created = customerStore.create(payload as Parameters<typeof customerStore.create>[0])
          newId = created.id
        }
      } else {
        const { data: existingArr } = await db().from('customers').select('id').eq('name', row.name as string).limit(1)
        if (existingArr?.[0]) {
          newId = (existingArr[0] as { id: number }).id
        } else {
          const { data: d, error } = await db().from('customers').insert(payload).select('id').single()
          if (error) throw error
          newId = (d as { id: number }).id
        }
      }
      customerIdMap.set(oldId as number, newId)
    } catch (e) {
      errors.push(`顧客「${row.name}」: ${String(e)}`)
    }
  }

  // 2. projects（顧客ID + 案件名で重複チェック）
  log(`案件を復元中... (${data.projects.length}件)`)
  for (const row of data.projects) {
    try {
      const { id: oldId, created_at: _ca, updated_at: _ua, customer_id: oldCustId, ...rest } = row as Record<string, unknown>
      const newCustId = customerIdMap.get(oldCustId as number)
      if (!newCustId) { errors.push(`案件「${row.project_name}」: 顧客ID ${oldCustId} が見つかりません`); continue }
      const payload = { ...rest, customer_id: newCustId }
      let newId: number
      if (!hasSupabaseEnv) {
        const existing = projectStore.getAll().find(p => p.project_name === row.project_name && p.customer_id === newCustId)
        if (existing) {
          newId = existing.id
        } else {
          const created = projectStore.create(payload as Parameters<typeof projectStore.create>[0])
          newId = created.id
        }
      } else {
        const { data: existingArr } = await db().from('projects').select('id').eq('project_name', row.project_name).eq('customer_id', newCustId).limit(1)
        if (existingArr?.[0]) {
          newId = (existingArr[0] as { id: number }).id
        } else {
          const { data: d, error } = await db().from('projects').insert(payload).select('id').single()
          if (error) throw error
          newId = (d as { id: number }).id
        }
      }
      projectIdMap.set(oldId as number, newId)
    } catch (e) {
      errors.push(`案件「${row.project_name}」: ${String(e)}`)
    }
  }

  // 3. contracts（案件IDで重複チェック — 1案件1契約）
  log(`契約を復元中... (${data.contracts.length}件)`)
  for (const row of data.contracts) {
    try {
      const { id: oldId, created_at: _ca, updated_at: _ua, project_id: oldProjId, ...rest } = row as Record<string, unknown>
      const newProjId = projectIdMap.get(oldProjId as number)
      if (!newProjId) { errors.push(`契約ID ${oldId}: 案件ID ${oldProjId} が見つかりません`); continue }
      const payload = { ...rest, project_id: newProjId }
      let newId: number
      if (!hasSupabaseEnv) {
        const existing = contractStore.getByProjectId(newProjId)
        if (existing) {
          newId = existing.id
        } else {
          const created = contractStore.create(payload as Parameters<typeof contractStore.create>[0])
          newId = created.id
        }
      } else {
        const { data: existingArr } = await db().from('contracts').select('id').eq('project_id', newProjId).limit(1)
        if (existingArr?.[0]) {
          newId = (existingArr[0] as { id: number }).id
        } else {
          const { data: d, error } = await db().from('contracts').insert(payload).select('id').single()
          if (error) throw error
          newId = (d as { id: number }).id
        }
      }
      contractIdMap.set(oldId as number, newId)
    } catch (e) {
      errors.push(`契約ID ${row.id}: ${String(e)}`)
    }
  }

  // 4. annual_records（contract_id + year で重複チェック）
  log(`年度記録を復元中... (${data.annual_records.length}件)`)
  for (const row of data.annual_records) {
    try {
      const { id: _oldId, created_at: _ca, updated_at: _ua, contract_id: oldContId, ...rest } = row as Record<string, unknown>
      const newContId = contractIdMap.get(oldContId as number)
      if (!newContId) continue
      const payload = { ...rest, contract_id: newContId }
      if (!hasSupabaseEnv) {
        const existing = annualRecordStore.getByContractId(newContId).find(r => r.year === row.year)
        if (!existing) {
          annualRecordStore.create(payload as Parameters<typeof annualRecordStore.create>[0])
        }
      } else {
        const { error } = await db().from('annual_records').upsert(payload, { onConflict: 'contract_id,year' })
        if (error) throw error
      }
    } catch (e) {
      errors.push(`年度記録 (契約${row.contract_id}/年${row.year}): ${String(e)}`)
    }
  }

  // 5. maintenance_responses（response_no で重複チェック）
  log(`保守対応を復元中... (${data.maintenance_responses.length}件)`)
  for (const row of data.maintenance_responses) {
    try {
      const { id: _oldId, created_at: _ca, updated_at: _ua, project_id: oldProjId, project_name: _pn, customer_name: _cn, ...rest } = row as Record<string, unknown>
      const newProjId = projectIdMap.get(oldProjId as number)
      if (!newProjId) continue
      const payload = { ...rest, project_id: newProjId }
      // response_noがあれば重複チェック
      if (row.response_no) {
        if (!hasSupabaseEnv) {
          const existing = maintenanceResponseStore.getAll().find(m => m.response_no === row.response_no)
          if (existing) continue
        } else {
          const { data: existingArr } = await db().from('maintenance_responses').select('id').eq('response_no', row.response_no).limit(1)
          if (existingArr?.[0]) continue
        }
      }
      if (!hasSupabaseEnv) {
        maintenanceResponseStore.create(payload as Parameters<typeof maintenanceResponseStore.create>[0])
      } else {
        const { error } = await db().from('maintenance_responses').insert(payload)
        if (error) throw error
      }
    } catch (e) {
      errors.push(`保守対応 ${row.response_no}: ${String(e)}`)
    }
  }

  // 6. periodic_maintenance（案件ID + 日付 + 作業種別で重複チェック）
  log(`定期保守を復元中... (${data.periodic_maintenance.length}件)`)
  for (const row of data.periodic_maintenance) {
    try {
      const { id: _oldId, created_at: _ca, updated_at: _ua, project_id: oldProjId, ...rest } = row as Record<string, unknown>
      const newProjId = projectIdMap.get(oldProjId as number)
      if (!newProjId) continue
      const payload = { ...rest, project_id: newProjId }
      if (!hasSupabaseEnv) {
        const existing = periodicMaintenanceStore.getByProjectId(newProjId).find(
          p => p.record_date === row.record_date && p.work_type === row.work_type
        )
        if (existing) continue
        periodicMaintenanceStore.create(payload as Parameters<typeof periodicMaintenanceStore.create>[0])
      } else {
        let query = db().from('periodic_maintenance').select('id').eq('project_id', newProjId).eq('record_date', row.record_date)
        if (row.work_type) query = query.eq('work_type', row.work_type)
        const { data: existingArr } = await query.limit(1)
        if (existingArr?.[0]) continue
        const { error } = await db().from('periodic_maintenance').insert(payload)
        if (error) throw error
      }
    } catch (e) {
      errors.push(`定期保守: ${String(e)}`)
    }
  }

  // 7. prospects（顧客名 + 案件名で重複チェック）
  log(`見込みを復元中... (${data.prospects.length}件)`)
  for (const row of data.prospects) {
    try {
      const { id: _oldId, created_at: _ca, updated_at: _ua, converted_customer_id: oldConvId, ...rest } = row as Record<string, unknown>
      const newConvId = oldConvId ? (customerIdMap.get(oldConvId as number) ?? null) : null
      const payload = { ...rest, converted_customer_id: newConvId }
      if (!hasSupabaseEnv) {
        const existing = prospectStore.getAll().find(p => p.customer_name === row.customer_name && p.project_name === row.project_name)
        if (existing) continue
        prospectStore.create(payload as Parameters<typeof prospectStore.create>[0])
      } else {
        const { data: existingArr } = await db().from('prospects').select('id').eq('customer_name', row.customer_name).eq('project_name', row.project_name).limit(1)
        if (existingArr?.[0]) continue
        const { error } = await db().from('prospects').insert(payload)
        if (error) throw error
      }
    } catch (e) {
      errors.push(`見込み「${row.project_name}」: ${String(e)}`)
    }
  }

  const totalItems = data.customers.length + data.projects.length + data.contracts.length
    + data.annual_records.length + data.maintenance_responses.length
    + data.periodic_maintenance.length + data.prospects.length
  log(`完了: ${totalItems}件中 ${totalItems - errors.length}件成功`)

  return { success: errors.length === 0, errors }
}
