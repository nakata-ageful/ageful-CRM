import { hasSupabaseEnv, supabase } from './supabase'
import { customerStore, maintenanceStore, projectStore, specStore, invoiceStore } from './mock-store'
import type { Customer, MaintenanceLog, Project, Invoice, CustomerInput, MaintenanceInput, CsvImportRow } from '../types'

// ── Project input ──────────────────────────────────────────
export type ProjectInput = {
  customer_id: number
  project_number: string
  project_name: string
  site_address: string
  key_number: string
  // FIT・系統情報
  grid_id: string
  grid_certified_at: string
  fit_period: string
  fit_end_date: string
  power_supply_start_date: string
  generation_point_id: string
  customer_number: string
  // 日程
  handover_date: string
  abolition_date: string
  // 販売情報
  sales_company: string
  referrer: string
  sales_price: string
  reference_price: string
  land_cost: string
  // 保守管理
  amuras_member_no: string
  monitoring_system: string
  notes: string
  // 座標
  latitude: string
  longitude: string
}

function db() {
  if (!supabase) throw new Error('Supabase not configured')
  return supabase
}

function toInt(v: string): number | null {
  if (!v || v.trim() === '') return null
  const n = parseInt(v.replace(/,/g, ''), 10)
  return isNaN(n) ? null : n
}

function toFloat(v: string): number | null {
  if (!v || v.trim() === '') return null
  const n = parseFloat(v.replace(/,/g, ''))
  return isNaN(n) ? null : n
}

function toDate(v: string): string | null {
  if (!v || v.trim() === '') return null
  // YYYY/MM/DD → YYYY-MM-DD
  return v.trim().replace(/\//g, '-')
}

function projectPayload(input: Omit<ProjectInput, 'customer_id'>) {
  return {
    project_number: input.project_number || null,
    project_name: input.project_name,
    site_address: input.site_address || null,
    key_number: input.key_number || null,
    grid_id: input.grid_id || null,
    grid_certified_at: toDate(input.grid_certified_at),
    fit_period: toInt(input.fit_period),
    fit_end_date: toDate(input.fit_end_date),
    power_supply_start_date: toDate(input.power_supply_start_date),
    generation_point_id: input.generation_point_id || null,
    customer_number: input.customer_number || null,
    handover_date: toDate(input.handover_date),
    abolition_date: toDate(input.abolition_date),
    sales_company: input.sales_company || null,
    referrer: input.referrer || null,
    sales_price: toInt(input.sales_price),
    reference_price: toInt(input.reference_price),
    land_cost: toInt(input.land_cost),
    amuras_member_no: input.amuras_member_no || null,
    monitoring_system: input.monitoring_system || null,
    notes: input.notes || null,
    latitude: toFloat(input.latitude),
    longitude: toFloat(input.longitude),
  }
}

// ── Customer CRUD ─────────────────────────────────────────

export async function createCustomer(input: CustomerInput): Promise<Customer> {
  if (!hasSupabaseEnv) {
    return customerStore.create({
      type: input.type,
      company_name: input.company_name || null,
      contact_name: input.contact_name,
      email: input.email || null,
      phone: input.phone || null,
      postal_code: input.postal_code || null,
      address: input.address || null,
      notes: input.notes || null,
    })
  }

  const { data, error } = await db()
    .from('customers')
    .insert({
      type: input.type,
      company_name: input.company_name || null,
      contact_name: input.contact_name,
      email: input.email || null,
      phone: input.phone || null,
      postal_code: input.postal_code || null,
      address: input.address || null,
      notes: input.notes || null,
    })
    .select()
    .single()
  if (error) throw error
  return data as Customer
}

export async function updateCustomer(id: number, input: CustomerInput): Promise<Customer> {
  if (!hasSupabaseEnv) {
    const updated = customerStore.update(id, {
      type: input.type,
      company_name: input.company_name || null,
      contact_name: input.contact_name,
      email: input.email || null,
      phone: input.phone || null,
      postal_code: input.postal_code || null,
      address: input.address || null,
      notes: input.notes || null,
    })
    if (!updated) throw new Error('Not found')
    return updated
  }

  const { data, error } = await db()
    .from('customers')
    .update({
      type: input.type,
      company_name: input.company_name || null,
      contact_name: input.contact_name,
      email: input.email || null,
      phone: input.phone || null,
      postal_code: input.postal_code || null,
      address: input.address || null,
      notes: input.notes || null,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Customer
}

export async function deleteCustomer(id: number): Promise<void> {
  if (!hasSupabaseEnv) {
    customerStore.delete(id)
    return
  }
  const { error } = await db().from('customers').delete().eq('id', id)
  if (error) throw error
}

// ── Maintenance CRUD ──────────────────────────────────────

export async function createMaintenanceLog(input: MaintenanceInput): Promise<MaintenanceLog> {
  if (!hasSupabaseEnv) {
    return maintenanceStore.create({
      project_id: input.project_id,
      inquiry_date: input.inquiry_date || null,
      occurrence_date: input.occurrence_date || null,
      work_type: input.work_type || null,
      target_area: input.target_area || null,
      situation: input.situation || null,
      response: input.response || null,
      report: input.report || null,
    })
  }

  const { data, error } = await db()
    .from('maintenance_logs')
    .insert({
      project_id: input.project_id,
      inquiry_date: input.inquiry_date || null,
      occurrence_date: input.occurrence_date || null,
      work_type: input.work_type || null,
      target_area: input.target_area || null,
      situation: input.situation || null,
      response: input.response || null,
      report: input.report || null,
      status: 'pending',
    })
    .select()
    .single()
  if (error) throw error
  return data as MaintenanceLog
}

export async function updateMaintenanceStatus(id: number, status: MaintenanceLog['status']): Promise<void> {
  if (!hasSupabaseEnv) {
    maintenanceStore.updateStatus(id, status)
    return
  }
  const { error } = await db().from('maintenance_logs').update({ status }).eq('id', id)
  if (error) throw error
}

export async function deleteMaintenanceLog(id: number): Promise<void> {
  if (!hasSupabaseEnv) {
    maintenanceStore.delete(id)
    return
  }
  const { error } = await db().from('maintenance_logs').delete().eq('id', id)
  if (error) throw error
}

// ── Project CRUD ───────────────────────────────────────────

export async function createProject(input: ProjectInput): Promise<Project> {
  const payload = { customer_id: input.customer_id, ...projectPayload(input) }
  if (!hasSupabaseEnv) {
    return projectStore.create(payload as Omit<Project, 'id' | 'created_at'>)
  }
  const { data, error } = await db()
    .from('projects')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data as Project
}

export async function updateProject(id: number, input: ProjectInput): Promise<Project> {
  const payload = projectPayload(input)
  if (!hasSupabaseEnv) {
    const updated = projectStore.update(id, payload as Partial<Omit<Project, 'id' | 'created_at'>>)
    if (!updated) throw new Error('Not found')
    return updated
  }
  const { data, error } = await db()
    .from('projects')
    .update(payload)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data as Project
}

// ── Invoice status update ──────────────────────────────────

export async function updateInvoiceStatus(id: number, status: Invoice['status']): Promise<void> {
  if (!hasSupabaseEnv) {
    invoiceStore.updateStatus(id, status)
    return
  }
  const paid_at = status === 'paid' ? new Date().toISOString().slice(0, 10) : null
  const { error } = await db()
    .from('invoices')
    .update({ status, ...(paid_at ? { paid_at } : {}) })
    .eq('id', id)
  if (error) throw error
}

// ── CSV Bulk Import ────────────────────────────────────────

export async function bulkImportProjects(
  rows: CsvImportRow[]
): Promise<{ success: number; failed: number; errors: string[] }> {
  let success = 0
  let failed = 0
  const errors: string[] = []

  // 顧客名ごとにIDをキャッシュ（同一顧客を複数行で使う場合）
  const custIdCache: Record<string, number> = {}

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    try {
      // ── 顧客の名寄せ / 作成 ──────────────────────────────
      let customerId: number

      if (custIdCache[row.customer_name]) {
        customerId = custIdCache[row.customer_name]
      } else if (!hasSupabaseEnv) {
        // モック: 既存顧客を contact_name で検索
        const existing = customerStore.findByName(row.customer_name)
        if (existing) {
          customerId = existing.id
        } else {
          const newCust = customerStore.create({
            type: row.company_name ? 'corporate' : 'individual',
            company_name: row.company_name || null,
            contact_name: row.customer_name,
            email: row.email || null,
            phone: row.phone || null,
            postal_code: row.postal_code || null,
            address: row.customer_address || null,
            notes: null,
          })
          customerId = newCust.id
        }
        custIdCache[row.customer_name] = customerId
      } else {
        // Supabase: 既存顧客を contact_name で検索
        const { data: existing } = await db()
          .from('customers')
          .select('id')
          .eq('contact_name', row.customer_name)
          .limit(1)
          .single()

        if (existing) {
          customerId = (existing as { id: number }).id
        } else {
          const { data: newCust, error: custErr } = await db()
            .from('customers')
            .insert({
              type: row.company_name ? 'corporate' : 'individual',
              company_name: row.company_name || null,
              contact_name: row.customer_name,
              email: row.email || null,
              phone: row.phone || null,
              postal_code: row.postal_code || null,
              address: row.customer_address || null,
            })
            .select()
            .single()
          if (custErr) throw custErr
          customerId = (newCust as { id: number }).id
        }
        custIdCache[row.customer_name] = customerId
      }

      // ── 案件作成 ─────────────────────────────────────────
      const projPayload = {
        customer_id: customerId,
        ...projectPayload({
          project_number: row.project_number,
          project_name: row.project_name,
          site_address: row.site_address,
          key_number: row.key_number,
          grid_id: row.grid_id,
          grid_certified_at: row.grid_certified_at,
          fit_period: row.fit_period,
          fit_end_date: row.fit_end_date,
          power_supply_start_date: row.power_supply_start_date,
          generation_point_id: row.generation_point_id,
          customer_number: row.customer_number,
          handover_date: row.handover_date,
          abolition_date: row.abolition_date,
          sales_company: row.sales_company,
          referrer: row.referrer,
          sales_price: row.sales_price,
          reference_price: row.reference_price,
          land_cost: row.land_cost,
          amuras_member_no: row.amuras_member_no,
          monitoring_system: row.monitoring_system,
          notes: row.notes,
          latitude: row.latitude,
          longitude: row.longitude,
        }),
      }

      let projectId: number

      if (!hasSupabaseEnv) {
        const p = projectStore.create(projPayload as Omit<Project, 'id' | 'created_at'>)
        projectId = p.id
      } else {
        const { data: p, error: projErr } = await db()
          .from('projects')
          .insert(projPayload)
          .select()
          .single()
        if (projErr) throw projErr
        projectId = (p as { id: number }).id
      }

      // ── 発電スペック作成（入力があれば）───────────────────
      const hasSpec = row.panel_kw || row.panel_manufacturer || row.pcs_kw || row.pcs_manufacturer
      if (hasSpec) {
        const specPayload = {
          panel_kw: toFloat(row.panel_kw),
          panel_count: toInt(row.panel_count),
          panel_manufacturer: row.panel_manufacturer || null,
          panel_model: row.panel_model || null,
          pcs_kw: toFloat(row.pcs_kw),
          pcs_count: toInt(row.pcs_count),
          pcs_manufacturer: row.pcs_manufacturer || null,
          pcs_model: row.pcs_model || null,
        }
        if (!hasSupabaseEnv) {
          specStore.upsert(projectId, specPayload)
        } else {
          await db().from('power_plant_specs').insert({ project_id: projectId, ...specPayload })
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
