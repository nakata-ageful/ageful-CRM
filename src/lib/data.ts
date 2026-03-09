import { hasSupabaseEnv, supabase } from './supabase'
import { customerStore, projectStore, specStore, maintenanceStore, contractStore, invoiceStore } from './mock-store'
import type { Customer, DashboardStats, MaintenanceLog, BillingRow, CustomerDetail, ProjectRow } from '../types'

function db() {
  if (!supabase) throw new Error('Supabase not configured')
  return supabase
}

// ── Dashboard ─────────────────────────────────────────────

export async function getDashboard(): Promise<DashboardStats> {
  if (!hasSupabaseEnv) {
    const all = maintenanceStore.getAll()
    return {
      totalCustomers: customerStore.getAll().length,
      totalProjects: projectStore.getAll().length,
      pendingMaintenanceCount: all.filter(m => m.status === 'pending' || m.status === 'in_progress').length,
      unbilledInvoiceCount: invoiceStore.getAll().filter(i => i.status === 'unbilled').length,
    }
  }

  const client = db()
  const [cust, proj, pend, unb] = await Promise.all([
    client.from('customers').select('id', { count: 'exact', head: true }),
    client.from('projects').select('id', { count: 'exact', head: true }),
    client.from('maintenance_logs').select('id', { count: 'exact', head: true }).in('status', ['pending', 'in_progress']),
    client.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'unbilled'),
  ])
  return {
    totalCustomers: cust.count ?? 0,
    totalProjects: proj.count ?? 0,
    pendingMaintenanceCount: pend.count ?? 0,
    unbilledInvoiceCount: unb.count ?? 0,
  }
}

// ── Customers ─────────────────────────────────────────────

export async function getCustomers(): Promise<Customer[]> {
  if (!hasSupabaseEnv) return customerStore.getAll()

  const client = db()
  const { data, error } = await client
    .from('customers')
    .select('id, type, company_name, contact_name, email, phone, postal_code, address, notes, created_at, projects(id)')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw error

  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...(row as Customer),
    project_count: Array.isArray(row.projects) ? (row.projects as unknown[]).length : 0,
  }))
}

// ── Customer Detail ───────────────────────────────────────

export async function getCustomerDetail(customerId: number): Promise<CustomerDetail | null> {
  if (!hasSupabaseEnv) {
    const customer = customerStore.getById(customerId)
    if (!customer) return null
    const projs = projectStore.getByCustomerId(customerId).map(p => ({
      ...p,
      spec: specStore.getByProjectId(p.id),
    }))
    const recentMaintenance = maintenanceStore.getAll()
      .filter(m => projs.some(p => p.id === m.project_id))
      .sort((a, b) => (b.occurrence_date ?? '').localeCompare(a.occurrence_date ?? ''))
      .slice(0, 10)
    return { customer, projects: projs, recentMaintenance }
  }

  const client = db()
  const { data: customer } = await client.from('customers').select('*').eq('id', customerId).single()
  if (!customer) return null

  const { data: projs } = await client
    .from('projects')
    .select('*, power_plant_specs(*)')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })

  const projIds = (projs ?? []).map((p: Record<string, unknown>) => p.id as number)
  const { data: maint } = await client
    .from('maintenance_logs')
    .select('*')
    .in('project_id', projIds)
    .order('occurrence_date', { ascending: false })
    .limit(10)

  return {
    customer: customer as Customer,
    projects: (projs ?? []).map((p: Record<string, unknown>) => ({
      ...(p as unknown as ReturnType<typeof projectStore.getAll>[0]),
      spec: (p.power_plant_specs as import('../types').PowerPlantSpec | null) ?? null,
    })),
    recentMaintenance: (maint ?? []) as MaintenanceLog[],
  }
}

// ── Maintenance ───────────────────────────────────────────

export async function getMaintenance(): Promise<MaintenanceLog[]> {
  if (!hasSupabaseEnv) return maintenanceStore.getAll()

  const client = db()
  const { data, error } = await client
    .from('maintenance_logs')
    .select('*, projects(project_name, customers(contact_name, company_name))')
    .order('occurrence_date', { ascending: false })
    .limit(100)
  if (error) throw error

  return (data ?? []).map((row: Record<string, unknown>) => {
    const proj = row.projects as Record<string, unknown> | null
    const cust = proj?.customers as Record<string, unknown> | null
    return {
      ...(row as MaintenanceLog),
      project_name: (proj?.project_name as string) ?? '不明',
      customer_name: (cust?.company_name as string) ?? (cust?.contact_name as string) ?? '不明',
    }
  })
}

// ── Projects ──────────────────────────────────────────────

export async function getProjects(): Promise<ProjectRow[]> {
  if (!hasSupabaseEnv) {
    return projectStore.getAll().map(p => {
      const c = customerStore.getById(p.customer_id)
      return {
        id: p.id,
        customer_id: p.customer_id,
        project_number: p.project_number,
        project_name: p.project_name,
        site_address: p.site_address,
        key_number: p.key_number,
        fit_end_date: p.fit_end_date,
        handover_date: p.handover_date,
        sales_company: p.sales_company,
        created_at: p.created_at,
        customer_name: c?.company_name ?? c?.contact_name ?? '-',
        company_name: c?.company_name ?? null,
      }
    })
  }

  const client = db()
  const { data, error } = await client
    .from('projects')
    .select('id, customer_id, project_number, project_name, site_address, key_number, fit_end_date, handover_date, sales_company, created_at, customers(contact_name, company_name)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error

  return (data ?? []).map((row: Record<string, unknown>) => {
    const cust = row.customers as Record<string, unknown> | null
    return {
      id: row.id as number,
      customer_id: row.customer_id as number,
      project_number: row.project_number as string | null,
      project_name: row.project_name as string,
      site_address: row.site_address as string | null,
      key_number: row.key_number as string | null,
      fit_end_date: row.fit_end_date as string | null,
      handover_date: row.handover_date as string | null,
      sales_company: row.sales_company as string | null,
      created_at: row.created_at as string,
      customer_name: (cust?.company_name as string) ?? (cust?.contact_name as string) ?? '-',
      company_name: (cust?.company_name as string) ?? null,
    }
  })
}

// ── Billing ───────────────────────────────────────────────

export async function getBillingRows(): Promise<BillingRow[]> {
  if (!hasSupabaseEnv) {
    const rows: BillingRow[] = []
    for (const contract of contractStore.getAll()) {
      const proj = projectStore.getById(contract.project_id)
      for (const invoice of invoiceStore.getByContractId(contract.id)) {
        rows.push({
          contract_name: contract.contract_type ?? '契約',
          project_name: proj?.project_name ?? '不明',
          invoice,
        })
      }
    }
    return rows
  }

  const client = db()
  const { data, error } = await client
    .from('contracts')
    .select('id, contract_type, projects(project_name), invoices(id, contract_id, billing_period, amount, status, payment_due_date, paid_at)')
    .order('id', { ascending: false })
  if (error) throw error

  const rows: BillingRow[] = []
  for (const c of data ?? []) {
    const row = c as Record<string, unknown>
    const invList = Array.isArray(row.invoices) ? row.invoices as Record<string, unknown>[] : []
    for (const inv of invList) {
      rows.push({
        contract_name: (row.contract_type as string) ?? '契約',
        project_name: ((row.projects as Record<string, unknown>)?.project_name as string) ?? '不明',
        invoice: inv as BillingRow['invoice'],
      })
    }
  }
  return rows
}
