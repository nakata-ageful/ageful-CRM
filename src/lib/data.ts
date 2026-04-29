import { hasSupabaseEnv, supabase } from './supabase'
import {
  customerStore, projectStore, contractStore, annualRecordStore,
  maintenanceResponseStore, periodicMaintenanceStore, attachmentStore,
  prospectStore,
} from './mock-store'
import type {
  Customer, DashboardStats, ProjectRow, ProjectDetail,
  CustomerDetailData, MaintenanceResponse, BillingRow, BillingDetail,
  Prospect,
} from '../types'

function db() {
  if (!supabase) throw new Error('Supabase not configured')
  return supabase
}

// ── Dashboard ─────────────────────────────────────────────

export async function getDashboard(): Promise<DashboardStats> {
  if (!hasSupabaseEnv) {
    const all = maintenanceResponseStore.getAll()
    const currentYear = new Date().getFullYear()
    const allRecords = annualRecordStore.getAll()
    return {
      totalCustomers: customerStore.getAll().length,
      totalProjects: projectStore.getAll().length,
      activeMaintenanceCount: all.filter(m => m.status === '対応中').length,
      pendingBillingCount: allRecords.filter(r => r.year === currentYear && r.status !== '入金済').length,
    }
  }
  const client = db()
  const currentYear = new Date().getFullYear()
  const [cust, proj, maint, billing] = await Promise.all([
    client.from('customers').select('id', { count: 'exact', head: true }),
    client.from('projects').select('id', { count: 'exact', head: true }),
    client.from('maintenance_responses').select('id', { count: 'exact', head: true }).eq('status', '対応中'),
    client.from('annual_records').select('id', { count: 'exact', head: true }).eq('year', currentYear).neq('status', '入金済'),
  ])
  return {
    totalCustomers: cust.count ?? 0,
    totalProjects: proj.count ?? 0,
    activeMaintenanceCount: maint.count ?? 0,
    pendingBillingCount: billing.count ?? 0,
  }
}

// ── Customers ─────────────────────────────────────────────

export async function getCustomers(): Promise<Customer[]> {
  if (!hasSupabaseEnv) return customerStore.getAll()
  const client = db()
  const { data, error } = await client
    .from('customers')
    .select('*, projects(id)')
    .order('created_at', { ascending: false })
    // TODO: 大規模データセットに対しては適切なページネーションを実装すべき
    .limit(1000)
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...(row as Customer),
    project_count: Array.isArray(row.projects) ? (row.projects as unknown[]).length : 0,
  }))
}

// ── Customer Detail ───────────────────────────────────────

export async function getCustomerDetail(customerId: number): Promise<CustomerDetailData | null> {
  if (!hasSupabaseEnv) {
    const customer = customerStore.getById(customerId)
    if (!customer) return null
    const projs = projectStore.getByCustomerId(customerId).map(p => {
      const contract = contractStore.getByProjectId(p.id)
      return {
        id: p.id,
        customer_id: p.customer_id,
        project_no: p.project_no,
        project_name: p.project_name,
        site_prefecture: p.site_prefecture,
        site_address: p.site_address,
        fit_period: p.fit_period,
        handover_date: p.handover_date,
        monitoring_system: p.monitoring_system,
        subcontractor: contract?.subcontractor ?? null,
        maintenance_start_date: contract?.maintenance_start_date ?? null,
        created_at: p.created_at,
        customer_name: customer.company_name ?? customer.name,
        company_name: customer.company_name,
      }
    })
    const attachments = attachmentStore.getByCustomerId(customerId)
    return { customer: { ...customer, project_count: projs.length }, projects: projs, attachments }
  }
  const client = db()
  const { data: customer } = await client.from('customers').select('*').eq('id', customerId).single()
  if (!customer) return null
  const { data: projData } = await client
    .from('projects')
    .select('*, contracts(subcontractor, maintenance_start_date)')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  const projects: ProjectRow[] = (projData ?? []).map((row: Record<string, unknown>) => {
    const con = (Array.isArray(row.contracts) ? row.contracts[0] : row.contracts) as Record<string, unknown> | null
    return {
      id: row.id as number,
      customer_id: row.customer_id as number,
      project_no: row.project_no as string | null,
      project_name: row.project_name as string,
      site_prefecture: row.site_prefecture as string | null,
      site_address: row.site_address as string | null,
      fit_period: row.fit_period as number | null,
      handover_date: row.handover_date as string | null,
      monitoring_system: row.monitoring_system as string | null,
      subcontractor: (con?.subcontractor as string) ?? null,
      maintenance_start_date: (con?.maintenance_start_date as string) ?? null,
      created_at: row.created_at as string,
      customer_name: (customer.company_name as string) ?? (customer.name as string),
      company_name: (customer.company_name as string) ?? null,
    }
  })
  const { data: attachData } = await client.from('attachments').select('*').eq('customer_id', customerId).order('uploaded_at', { ascending: false })
  return {
    customer: { ...(customer as Customer), project_count: projects.length },
    projects,
    attachments: (attachData ?? []) as import('../types').Attachment[],
  }
}

// ── Projects ──────────────────────────────────────────────

export async function getProjects(): Promise<ProjectRow[]> {
  if (!hasSupabaseEnv) {
    return projectStore.getAll().map(p => {
      const c = customerStore.getById(p.customer_id)
      const contract = contractStore.getByProjectId(p.id)
      return {
        id: p.id,
        customer_id: p.customer_id,
        project_no: p.project_no,
        project_name: p.project_name,
        site_prefecture: p.site_prefecture,
        site_address: p.site_address,
        fit_period: p.fit_period,
        handover_date: p.handover_date,
        monitoring_system: p.monitoring_system,
        subcontractor: contract?.subcontractor ?? null,
        maintenance_start_date: contract?.maintenance_start_date ?? null,
        created_at: p.created_at,
        customer_name: c?.company_name ?? c?.name ?? '-',
        company_name: c?.company_name ?? null,
      }
    })
  }
  // Supabase stub
  const client = db()
  const { data, error } = await client
    .from('projects')
    .select('*, customers(name, company_name), contracts(subcontractor, maintenance_start_date)')
    .order('created_at', { ascending: false })
    // TODO: 大規模データセットに対しては適切なページネーションを実装すべき
    .limit(1000)
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => {
    const cust = row.customers as Record<string, unknown> | null
    const con = (Array.isArray(row.contracts) ? row.contracts[0] : row.contracts) as Record<string, unknown> | null
    return {
      id: row.id as number,
      customer_id: row.customer_id as number,
      project_no: row.project_no as string | null,
      project_name: row.project_name as string,
      site_prefecture: row.site_prefecture as string | null,
      site_address: row.site_address as string | null,
      fit_period: row.fit_period as number | null,
      handover_date: row.handover_date as string | null,
      monitoring_system: row.monitoring_system as string | null,
      subcontractor: (con?.subcontractor as string) ?? null,
      maintenance_start_date: (con?.maintenance_start_date as string) ?? null,
      created_at: row.created_at as string,
      customer_name: (cust?.company_name as string) ?? (cust?.name as string) ?? '-',
      company_name: (cust?.company_name as string) ?? null,
    }
  })
}

export async function getProjectIdByCustomerId(customerId: number): Promise<number | null> {
  if (!hasSupabaseEnv) {
    const proj = projectStore.getAll().find(p => p.customer_id === customerId)
    return proj?.id ?? null
  }
  const { data } = await db().from('projects').select('id').eq('customer_id', customerId).limit(1).single()
  return data?.id ?? null
}

// ── Project Detail ────────────────────────────────────────

export async function getProjectDetail(projectId: number): Promise<ProjectDetail | null> {
  if (!hasSupabaseEnv) {
    const project = projectStore.getById(projectId)
    if (!project) return null
    const customer = customerStore.getById(project.customer_id)
    if (!customer) return null
    const contract = contractStore.getByProjectId(projectId)
    const annualRecords = contract ? annualRecordStore.getByContractId(contract.id) : []
    const maintenanceResponses = maintenanceResponseStore.getByProjectId(projectId)
    const periodic = periodicMaintenanceStore.getByProjectId(projectId)
    return { project, customer, contract, annualRecords, maintenanceResponses, periodicMaintenance: periodic }
  }
  const client = db()
  const { data: project } = await client.from('projects').select('*').eq('id', projectId).single()
  if (!project) return null
  const { data: customer } = await client.from('customers').select('*').eq('id', project.customer_id).single()
  if (!customer) return null
  const { data: conArr } = await client.from('contracts').select('*').eq('project_id', projectId).limit(1)
  const contract = conArr?.[0] ?? null
  const annualRecords = contract
    ? ((await client.from('annual_records').select('*').eq('contract_id', contract.id).order('year', { ascending: false })).data ?? [])
    : []
  const { data: mrData } = await client.from('maintenance_responses').select('*').eq('project_id', projectId).order('inquiry_date', { ascending: false })
  const { data: pmData } = await client.from('periodic_maintenance').select('*').eq('project_id', projectId).order('record_date', { ascending: false })
  return {
    project: project as import('../types').Project,
    customer: customer as Customer,
    contract: contract as import('../types').Contract | null,
    annualRecords: (annualRecords as import('../types').AnnualRecord[]),
    maintenanceResponses: (mrData ?? []) as import('../types').MaintenanceResponse[],
    periodicMaintenance: (pmData ?? []) as import('../types').PeriodicMaintenance[],
  }
}

// ── Maintenance Responses ─────────────────────────────────

export async function getMaintenanceResponses(): Promise<MaintenanceResponse[]> {
  if (!hasSupabaseEnv) return maintenanceResponseStore.getAll()
  const client = db()
  const { data, error } = await client
    .from('maintenance_responses')
    .select('*, projects(project_name, customers(name, company_name))')
    .order('inquiry_date', { ascending: false })
    // TODO: 大規模データセットに対しては適切なページネーションを実装すべき
    .limit(1000)
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => {
    const proj = row.projects as Record<string, unknown> | null
    const cust = proj?.customers as Record<string, unknown> | null
    return {
      ...(row as MaintenanceResponse),
      project_name: (proj?.project_name as string) ?? '不明',
      customer_name: (cust?.company_name as string) ?? (cust?.name as string) ?? '不明',
    }
  })
}

export async function getMaintenanceResponseById(id: number): Promise<MaintenanceResponse | null> {
  if (!hasSupabaseEnv) return maintenanceResponseStore.getById(id)
  const client = db()
  const { data } = await client.from('maintenance_responses').select('*').eq('id', id).single()
  return (data as MaintenanceResponse) ?? null
}

// ── Billing ───────────────────────────────────────────────

export async function getBillingRows(): Promise<BillingRow[]> {
  if (!hasSupabaseEnv) {
    const currentYear = new Date().getFullYear()
    return projectStore.getAll().map(p => {
      const c = customerStore.getById(p.customer_id)
      const contract = contractStore.getByProjectId(p.id)
      const records = contract ? annualRecordStore.getByContractId(contract.id) : []
      const currentYearRecord = records.find(r => r.year === currentYear) ?? null
      return {
        project_id: p.id,
        project_name: p.project_name,
        customer_name: c?.company_name ?? c?.name ?? '-',
        company_name: c?.company_name ?? null,
        contract: contract ?? null,
        currentYearRecord,
        currentYear,
      }
    })
  }
  const client = db()
  const currentYear = new Date().getFullYear()
  const { data: projData, error } = await client
    .from('projects')
    .select('id, project_name, customer_id, customers(name, company_name), contracts(*, annual_records(*))')
    .order('created_at', { ascending: false })
    // TODO: 大規模データセットに対しては適切なページネーションを実装すべき
    .limit(1000)
  if (error) throw error
  return (projData ?? []).map((row: Record<string, unknown>) => {
    const cust = row.customers as Record<string, unknown> | null
    const conArr = row.contracts as Record<string, unknown>[] | null
    const con = conArr?.[0] ?? null
    const records = (con?.annual_records as Record<string, unknown>[] | null) ?? []
    const currentYearRecord = records.find(r => (r.year as number) === currentYear) ?? null
    return {
      project_id: row.id as number,
      project_name: row.project_name as string,
      customer_name: (cust?.company_name as string) ?? (cust?.name as string) ?? '-',
      company_name: (cust?.company_name as string) ?? null,
      contract: con as import('../types').Contract | null,
      currentYearRecord: currentYearRecord as import('../types').AnnualRecord | null,
      currentYear,
    }
  })
}

// ── Prospects ─────────────────────────────────────────────

export async function getProspects(): Promise<Prospect[]> {
  if (!hasSupabaseEnv) return prospectStore.getAll()
  const client = supabase!
  const { data, error } = await client
    .from('prospects')
    .select('*')
    .order('created_at', { ascending: false })
    // TODO: 大規模データセットに対しては適切なページネーションを実装すべき
    .limit(1000)
  if (error) throw error
  return (data ?? []) as Prospect[]
}

export async function getProspectById(id: number): Promise<Prospect | null> {
  if (!hasSupabaseEnv) return prospectStore.getById(id)
  const client = supabase!
  const { data } = await client.from('prospects').select('*').eq('id', id).single()
  return (data as Prospect) ?? null
}

export async function getBillingDetail(projectId: number): Promise<BillingDetail | null> {
  if (!hasSupabaseEnv) {
    const project = projectStore.getById(projectId)
    if (!project) return null
    const customer = customerStore.getById(project.customer_id)
    if (!customer) return null
    const contract = contractStore.getByProjectId(projectId)
    if (!contract) return null
    const annualRecords = annualRecordStore.getByContractId(contract.id)
      .sort((a, b) => b.year - a.year)
    const maintenanceResponses = maintenanceResponseStore.getByProjectId(projectId)
    const periodicMaintenance = periodicMaintenanceStore.getByProjectId(projectId)
    return { project, customer, contract, annualRecords, maintenanceResponses, periodicMaintenance }
  }
  const client = db()
  const { data: project } = await client.from('projects').select('*').eq('id', projectId).single()
  if (!project) return null
  const { data: customer } = await client.from('customers').select('*').eq('id', project.customer_id).single()
  if (!customer) return null
  const { data: conArr } = await client.from('contracts').select('*').eq('project_id', projectId).limit(1)
  const contract = conArr?.[0]
  if (!contract) return null
  const { data: arData } = await client.from('annual_records').select('*').eq('contract_id', contract.id).order('year', { ascending: false })
  const { data: mrData } = await client.from('maintenance_responses').select('*').eq('project_id', projectId).order('inquiry_date', { ascending: false })
  const { data: pmData } = await client.from('periodic_maintenance').select('*').eq('project_id', projectId).order('record_date', { ascending: false })
  return {
    project: project as import('../types').Project,
    customer: customer as Customer,
    contract: contract as import('../types').Contract,
    annualRecords: (arData ?? []) as import('../types').AnnualRecord[],
    maintenanceResponses: (mrData ?? []) as import('../types').MaintenanceResponse[],
    periodicMaintenance: (pmData ?? []) as import('../types').PeriodicMaintenance[],
  }
}
