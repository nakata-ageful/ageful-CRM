import { billingRuntimePreview, hasSupabaseEnv, supabase } from './supabase'
import {
  customerStore, projectStore, contractStore, annualRecordStore,
  maintenanceResponseStore, periodicMaintenanceStore, attachmentStore,
  prospectStore,
} from './mock-store'
import type {
  Customer, DashboardStats, ProjectRow, ProjectDetail,
  CustomerDetailData, MaintenanceResponse, BillingRow, BillingDetail,
  Prospect, PeriodicMaintenance,
} from '../types'
import { annualRecordFromStorage } from './annual-record-status-storage'

function db() {
  if (!supabase) throw new Error('Supabase not configured')
  return supabase
}

function orderedContracts<T extends { id: number; archived_at?: string | null }>(contracts: T[], includeArchived = false): T[] {
  return contracts.filter(c => includeArchived || !c.archived_at).sort((a, b) => a.id - b.id)
}

function mockContracts(projectId: number, includeArchived = false) {
  return orderedContracts(contractStore.getAll().filter(c => c.project_id === projectId), includeArchived)
}

function activeMockProject(projectId: number) {
  const project = projectStore.getById(projectId)
  return project && !project.archived_at ? project : null
}

// 発電所一覧の検索用テキストを生成する。
// 基本情報・設備情報は projects テーブルの全カラム、契約情報は contracts 側の
// 各項目（契約日・販売経路・備考など）と顧客名を連結して小文字化する。
function buildProjectSearchText(
  projectSource: Record<string, unknown>,
  contract: Record<string, unknown> | null,
  customerName: string | null,
  companyName: string | null,
): string {
  const parts: unknown[] = [...Object.values(projectSource)]
  if (contract) {
    parts.push(
      contract.sale_contract_date, contract.equipment_contract_date,
      contract.land_contract_date, contract.ownership_transfer_date,
      contract.sales_to_neosys, contract.neosys_to_referrer,
      contract.equipment_contract_notes, contract.land_contract_notes,
      contract.subcontractor, contract.maintenance_start_date,
    )
  }
  parts.push(customerName, companyName)
  return parts
    .filter(v => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    .map(v => String(v).toLowerCase())
    .join(' ')
}

// ── Dashboard ─────────────────────────────────────────────

export async function getDashboard(): Promise<DashboardStats> {
  if (!hasSupabaseEnv) {
    const all = maintenanceResponseStore.getAll().filter(m => activeMockProject(m.project_id))
    const currentYear = new Date().getFullYear()
    const activeContractIds = new Set(contractStore.getAll().filter(c => !c.archived_at && activeMockProject(c.project_id)).map(c => c.id))
    const allRecords = annualRecordStore.getAll().filter(r => activeContractIds.has(r.contract_id))
    return {
      totalCustomers: customerStore.getAll().length,
      totalProjects: projectStore.getAll().filter(p => !p.archived_at).length,
      activeMaintenanceCount: all.filter(m => m.status === '対応中').length,
      pendingBillingCount: allRecords.filter(r => r.year === currentYear && r.status !== '入金済').length,
    }
  }
  const client = db()
  const currentYear = new Date().getFullYear()
  const [cust, proj, maint, billing] = await Promise.all([
    client.from('customers').select('id', { count: 'exact', head: true }),
    client.from('projects').select('id', { count: 'exact', head: true }).is('archived_at', null),
    client.from('maintenance_responses').select('id, projects!inner(id)', { count: 'exact', head: true }).is('projects.archived_at', null).eq('status', '対応中'),
    client.from('annual_records').select('id, contracts!inner(id, projects!inner(id))', { count: 'exact', head: true }).is('contracts.archived_at', null).is('contracts.projects.archived_at', null).eq('year', currentYear).neq('status', '入金済'),
  ])
  for (const result of [cust, proj, maint, billing]) if (result.error) throw result.error
  return {
    totalCustomers: cust.count ?? 0,
    totalProjects: proj.count ?? 0,
    activeMaintenanceCount: maint.count ?? 0,
    pendingBillingCount: billing.count ?? 0,
  }
}

// ── Customers ─────────────────────────────────────────────

export async function getCustomers(): Promise<Customer[]> {
  if (!hasSupabaseEnv) return customerStore.getAll().map(c => ({ ...c, project_count: projectStore.getByCustomerId(c.id).filter(p => !p.archived_at).length }))
  const client = db()
  // customers と projects を別クエリで取得して案件数をローカル集計する。
  // 以前は select('*, projects(id)') の埋め込みカウントを使っていたが、
  // 詳細ビュー (projects を直接クエリ) と件数がずれるケースがあったため、
  // 詳細と同じソースで集計するように変更。
  const [{ data: custData, error: custErr }, { data: projData, error: projErr }] = await Promise.all([
    client.from('customers')
      .select('*')
      .order('created_at', { ascending: false })
      // TODO: 大規模データセットに対しては適切なページネーションを実装すべき
      .limit(1000),
    client.from('projects').select('customer_id').is('archived_at', null),
  ])
  if (custErr) throw custErr
  if (projErr) throw projErr
  const counts = new Map<number, number>()
  for (const p of (projData ?? []) as { customer_id: number | null }[]) {
    if (p.customer_id == null) continue
    counts.set(p.customer_id, (counts.get(p.customer_id) ?? 0) + 1)
  }
  return (custData ?? []).map((row: Record<string, unknown>) => ({
    ...(row as Customer),
    project_count: counts.get((row as Customer).id) ?? 0,
  }))
}

// ── Customer Detail ───────────────────────────────────────

export async function getCustomerDetail(customerId: number): Promise<CustomerDetailData | null> {
  if (!hasSupabaseEnv) {
    const customer = customerStore.getById(customerId)
    if (!customer) return null
    const projs = projectStore.getByCustomerId(customerId).filter(p => !p.archived_at).map(p => {
      const contract = mockContracts(p.id)[0]
      return {
        id: p.id,
        customer_id: p.customer_id,
        project_no: p.project_no,
        project_name: p.project_name,
        plant_name: p.plant_name,
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
  const { data: projData, error: projectError } = await client
    .from('projects')
    .select('*, contracts(id, archived_at, subcontractor, maintenance_start_date)')
    .is('archived_at', null)
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
  if (projectError) throw projectError
  const projects: ProjectRow[] = (projData ?? []).map((row: Record<string, unknown>) => {
    const con = orderedContracts((Array.isArray(row.contracts) ? row.contracts : row.contracts ? [row.contracts] : []) as { id: number; archived_at?: string | null; [key: string]: unknown }[])[0] ?? null
    return {
      id: row.id as number,
      customer_id: row.customer_id as number,
      project_no: row.project_no as string | null,
      project_name: row.project_name as string,
      plant_name: row.plant_name as string | null,
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
    return projectStore.getAll().filter(p => !p.archived_at).map(p => {
      const c = (p.customer_id==null?null:customerStore.getById(p.customer_id))
      const contract = mockContracts(p.id)[0]
      return {
        id: p.id,
        customer_id: p.customer_id,
        project_no: p.project_no,
        project_name: p.project_name,
        plant_name: p.plant_name,
        site_prefecture: p.site_prefecture,
        site_address: p.site_address,
        fit_period: p.fit_period,
        handover_date: p.handover_date,
        monitoring_system: p.monitoring_system,
        subcontractor: contract?.subcontractor ?? null,
        maintenance_start_date: contract?.maintenance_start_date ?? null,
        created_at: p.created_at,
        updated_at: (p as { updated_at?: string | null }).updated_at ?? p.created_at,
        customer_name: c?.company_name ?? c?.name ?? (p.customer_pending?'顧客未定（新規案件）':'所有者未確認'),
        company_name: c?.company_name ?? null,
        search_text: buildProjectSearchText(
          p as unknown as Record<string, unknown>,
          (contract ?? null) as unknown as Record<string, unknown> | null,
          c?.company_name ?? c?.name ?? null,
          c?.company_name ?? null,
        ),
      }
    })
  }
  // Supabase stub
  const client = db()
  const { data, error } = await client
    .from('projects')
    .select('*, customers:customers!projects_customer_id_fkey(name, company_name), contracts(id, archived_at, subcontractor, maintenance_start_date, sale_contract_date, equipment_contract_date, land_contract_date, ownership_transfer_date, sales_to_neosys, neosys_to_referrer, equipment_contract_notes, land_contract_notes)')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    // TODO: 大規模データセットに対しては適切なページネーションを実装すべき
    .limit(1000)
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => {
    const cust = row.customers as Record<string, unknown> | null
    const con = orderedContracts((Array.isArray(row.contracts) ? row.contracts : row.contracts ? [row.contracts] : []) as { id: number; archived_at?: string | null; [key: string]: unknown }[])[0] ?? null
    const customerName = (cust?.company_name as string) ?? (cust?.name as string) ?? (row.customer_pending?'顧客未定（新規案件）':'所有者未確認')
    const companyName = (cust?.company_name as string) ?? null
    // ネストした customers / contracts は検索テキストから除外して project 本体のみ渡す
    const { customers: _c, contracts: _ct, ...projOnly } = row
    return {
      id: row.id as number,
      customer_id: row.customer_id as number,
      project_no: row.project_no as string | null,
      project_name: row.project_name as string,
      plant_name: row.plant_name as string | null,
      site_prefecture: row.site_prefecture as string | null,
      site_address: row.site_address as string | null,
      fit_period: row.fit_period as number | null,
      handover_date: row.handover_date as string | null,
      monitoring_system: row.monitoring_system as string | null,
      subcontractor: (con?.subcontractor as string) ?? null,
      maintenance_start_date: (con?.maintenance_start_date as string) ?? null,
      created_at: row.created_at as string,
      updated_at: (row.updated_at as string) ?? null,
      customer_name: customerName,
      company_name: companyName,
      search_text: buildProjectSearchText(projOnly, con, customerName, companyName),
    }
  })
}

export async function getProjectIdByCustomerId(customerId: number): Promise<number | null> {
  if (!hasSupabaseEnv) {
    const proj = projectStore.getAll().filter(p => !p.archived_at).sort((a, b) => a.id - b.id).find(p => p.customer_id === customerId)
    return proj?.id ?? null
  }
  const { data, error } = await db().from('projects').select('id').eq('customer_id', customerId).is('archived_at', null).order('id', { ascending: true }).limit(1).maybeSingle()
  if (error) throw error
  return data?.id ?? null
}

// ── Project Detail ────────────────────────────────────────

export async function getProjectDetail(projectId: number): Promise<ProjectDetail | null> {
  if (!hasSupabaseEnv) {
    const project = projectStore.getById(projectId)
    if (!project) return null
    const customer = (project.customer_id==null?null:customerStore.getById(project.customer_id))
    if (project.customer_id!=null&&!customer) throw Error('所有者の情報を取得できません')
    const contract = mockContracts(projectId, !!project.archived_at)[0] ?? null
    const annualRecords = contract ? annualRecordStore.getByContractId(contract.id) : []
    const maintenanceResponses = maintenanceResponseStore.getByProjectId(projectId)
    const periodic = periodicMaintenanceStore.getByProjectId(projectId)
    return { project, customer, contract, annualRecords, maintenanceResponses, periodicMaintenance: periodic }
  }
  const client = db()
  const { data: project } = await client.from('projects').select('*').eq('id', projectId).single()
  if (!project) return null
  const { data: customer, error: customerError } = project.customer_id==null?{data:null,error:null}:await client.from('customers').select('*').eq('id', project.customer_id).single()
  if(customerError)throw customerError
  if(project.customer_id!=null&&!customer)throw Error('所有者の情報を取得できません')
  let contractQuery = client.from('contracts').select('*').eq('project_id', projectId)
  if (!project.archived_at) contractQuery = contractQuery.is('archived_at', null)
  const { data: conArr, error: contractError } = await contractQuery.order('id', { ascending: true }).limit(1)
  if (contractError) throw contractError
  const contract = conArr?.[0] ?? null
  const annualRecords = contract
    ? ((await client.from('annual_records').select('*').eq('contract_id', contract.id).order('year', { ascending: false })).data ?? []).map(annualRecordFromStorage)
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
  if (!hasSupabaseEnv) return maintenanceResponseStore.getAll().filter(m => activeMockProject(m.project_id))
  const client = db()
  const { data, error } = await client
    .from('maintenance_responses')
    .select('*, projects!inner(project_name, plant_name, customers:customers!projects_customer_id_fkey(name, company_name))')
    .is('projects.archived_at', null)
    .order('response_no', { ascending: false, nullsFirst: false })
    // TODO: 大規模データセットに対しては適切なページネーションを実装すべき
    .limit(1000)
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => {
    const proj = row.projects as Record<string, unknown> | null
    const cust = proj?.customers as Record<string, unknown> | null
    return {
      ...(row as MaintenanceResponse),
      project_name: (proj?.project_name as string) ?? '不明',
      plant_name: (proj?.plant_name as string) ?? null,
      customer_name: (cust?.company_name as string) ?? (cust?.name as string) ?? '不明',
    }
  })
}

export async function getMaintenanceResponseById(id: number): Promise<MaintenanceResponse | null> {
  if (!hasSupabaseEnv) {
    const record = maintenanceResponseStore.getById(id)
    return record && activeMockProject(record.project_id) ? record : null
  }
  const client = db()
  const { data } = await client
    .from('maintenance_responses')
    .select('*, projects!inner(project_name, plant_name, customer_id, panel_maker, panel_model, pcs_maker, pcs_model, monitoring_system, monitoring_model, customers:customers!projects_customer_id_fkey(name, company_name))')
    .is('projects.archived_at', null)
    .eq('id', id)
    .single()
  if (!data) return null
  const row = data as Record<string, unknown>
  const proj = row.projects as Record<string, unknown> | null
  const cust = proj?.customers as Record<string, unknown> | null
  return {
    ...(row as MaintenanceResponse),
    project_name: (proj?.project_name as string) ?? '不明',
    plant_name: (proj?.plant_name as string) ?? null,
    customer_id: (proj?.customer_id as number) ?? null,
    customer_name: (cust?.company_name as string) ?? (cust?.name as string) ?? '不明',
    panel_maker: (proj?.panel_maker as string) ?? null,
    panel_model: (proj?.panel_model as string) ?? null,
    pcs_maker: (proj?.pcs_maker as string) ?? null,
    pcs_model: (proj?.pcs_model as string) ?? null,
    monitoring_system: (proj?.monitoring_system as string) ?? null,
    monitoring_model: (proj?.monitoring_model as string) ?? null,
  } as MaintenanceResponse
}

// ── Periodic Maintenance ──────────────────────────────────

export async function getPeriodicMaintenance(): Promise<PeriodicMaintenance[]> {
  if (!hasSupabaseEnv) {
    return periodicMaintenanceStore.getAll().filter(m => activeMockProject(m.project_id)).map(m => {
      const proj = projectStore.getById(m.project_id)
      const cust = proj ? (proj.customer_id==null?null:customerStore.getById(proj.customer_id)) : null
      return {
        ...m,
        project_name: proj?.project_name ?? '不明',
        plant_name: proj?.plant_name ?? null,
        customer_name: cust?.company_name ?? cust?.name ?? '不明',
      }
    })
  }
  const client = db()
  const { data, error } = await client
    .from('periodic_maintenance')
    .select('*, projects!inner(project_name, plant_name, customers:customers!projects_customer_id_fkey(name, company_name))')
    .is('projects.archived_at', null)
    .order('record_date', { ascending: false, nullsFirst: false })
    // TODO: 大規模データセットに対しては適切なページネーションを実装すべき
    .limit(1000)
  if (error) throw error
  return (data ?? []).map((row: Record<string, unknown>) => {
    const proj = row.projects as Record<string, unknown> | null
    const cust = proj?.customers as Record<string, unknown> | null
    return {
      ...(row as PeriodicMaintenance),
      project_name: (proj?.project_name as string) ?? '不明',
      plant_name: (proj?.plant_name as string) ?? null,
      customer_name: (cust?.company_name as string) ?? (cust?.name as string) ?? '不明',
    }
  })
}

// ── Billing ───────────────────────────────────────────────

export async function getBillingRows(): Promise<BillingRow[]> {
  if (!hasSupabaseEnv) {
    const currentYear = new Date().getFullYear()
    return projectStore.getAll().filter(p => !p.archived_at).map(p => {
      const c = (p.customer_id==null?null:customerStore.getById(p.customer_id))
      const activeContracts = mockContracts(p.id)
      const storedContract = activeContracts[0]
      // The legacy mock data predates per-round schedule days. Keep production
      // behavior strict, but give the isolated UI preview one representative
      // near-term item so the cutover/setup panel can be reviewed end to end.
      const contract = billingRuntimePreview && storedContract && p.id === 5
        ? { ...storedContract, billing_schedule_days: ['10月25日'] }
        : storedContract
      const records = contract ? annualRecordStore.getByContractId(contract.id) : []
      const currentYearRecords = records.filter(r => r.year === currentYear)
      const currentYearRecord = currentYearRecords[0] ?? null
      return {
        project_id: p.id,
        project_name: p.project_name,
        customer_name: c?.company_name ?? c?.name ?? '所有者未確認',
        company_name: c?.company_name ?? null,
        contract: contract ?? null,
        contract_count: activeContracts.length,
        currentYearRecord,
        currentYearRecords,
        records,
        currentYear,
      }
    })
  }
  const client = db()
  const currentYear = new Date().getFullYear()
  const { data: projData, error } = await client
    .from('projects')
    .select('id, project_name, customer_id, customers:customers!projects_customer_id_fkey(name, company_name), contracts(*, annual_records(*))')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
    // TODO: 大規模データセットに対しては適切なページネーションを実装すべき
    .limit(1000)
  if (error) throw error
  return (projData ?? []).map((row: Record<string, unknown>) => {
    const cust = row.customers as Record<string, unknown> | null
    const conArr = orderedContracts((row.contracts ?? []) as { id: number; archived_at?: string | null; [key: string]: unknown }[])
    const con = conArr?.[0] ?? null
    const records = ((con?.annual_records as Record<string, unknown>[] | null) ?? []).map(annualRecordFromStorage)
    const currentYearRecords = records.filter(r => (r.year as number) === currentYear) as import('../types').AnnualRecord[]
    const currentYearRecord = currentYearRecords[0] ?? null
    return {
      project_id: row.id as number,
      project_name: row.project_name as string,
      customer_name: (cust?.company_name as string) ?? (cust?.name as string) ?? '所有者未確認',
      company_name: (cust?.company_name as string) ?? null,
      contract: con as import('../types').Contract | null,
      contract_count: conArr?.length ?? 0,
      currentYearRecord,
      currentYearRecords,
      records: records as import('../types').AnnualRecord[],
      currentYear,
    }
  })
}

// ── Prospects ─────────────────────────────────────────────

export async function getProspects(): Promise<Prospect[]> {
  if (!hasSupabaseEnv) return prospectStore.getAll().filter(p => [p.new_project_id, p.ownership_project_id].every(id => id == null || activeMockProject(id)))
  const client = supabase!
  const { data, error } = await client
    .from('prospects')
    .select('*')
    .order('created_at', { ascending: false })
    // TODO: 大規模データセットに対しては適切なページネーションを実装すべき
    .limit(1000)
  if (error) throw error
  const rows = (data ?? []) as Prospect[]
  const linkedIds = [...new Set(rows.flatMap(p => [p.new_project_id, p.ownership_project_id]).filter((id): id is number => id != null))]
  if (!linkedIds.length) return rows
  const { data: projects, error: projectError } = await client.from('projects').select('id, archived_at').in('id', linkedIds)
  if (projectError) throw projectError
  const activeIds = new Set((projects ?? []).filter((p: { archived_at?: string | null }) => !p.archived_at).map((p: { id: number }) => p.id))
  return rows.filter(p => [p.new_project_id, p.ownership_project_id].every(id => id == null || activeIds.has(id)))
}

export async function getProspectById(id: number): Promise<Prospect | null> {
  if (!hasSupabaseEnv) return prospectStore.getById(id)
  const client = supabase!
  const { data } = await client.from('prospects').select('*').eq('id', id).single()
  return (data as Prospect) ?? null
}

export async function getBillingDetail(projectId: number): Promise<BillingDetail | null> {
  if (!hasSupabaseEnv) {
    const project = activeMockProject(projectId)
    if (!project) return null
    const customer = (project.customer_id==null?null:customerStore.getById(project.customer_id))
    if (project.customer_id!=null&&!customer) throw Error('所有者の情報を取得できません')
    const contract = mockContracts(projectId)[0]
    if (!contract) return null
    const annualRecords = annualRecordStore.getByContractId(contract.id)
      .sort((a, b) => b.year - a.year)
    const maintenanceResponses = maintenanceResponseStore.getByProjectId(projectId)
    const periodicMaintenance = periodicMaintenanceStore.getByProjectId(projectId)
    return { project, customer, contract, annualRecords, maintenanceResponses, periodicMaintenance }
  }
  const client = db()
  const { data: project } = await client.from('projects').select('*').eq('id', projectId).is('archived_at', null).single()
  if (!project) return null
  const { data: customer, error: customerError } = project.customer_id==null?{data:null,error:null}:await client.from('customers').select('*').eq('id', project.customer_id).single()
  if(customerError)throw customerError
  if(project.customer_id!=null&&!customer)throw Error('所有者の情報を取得できません')
  const { data: conArr, error: contractError } = await client.from('contracts').select('*').eq('project_id', projectId).is('archived_at', null).order('id', { ascending: true }).limit(1)
  if (contractError) throw contractError
  const contract = conArr?.[0]
  if (!contract) return null
  const { data: arData } = await client.from('annual_records').select('*').eq('contract_id', contract.id).order('year', { ascending: false })
  const { data: mrData } = await client.from('maintenance_responses').select('*').eq('project_id', projectId).order('inquiry_date', { ascending: false })
  const { data: pmData } = await client.from('periodic_maintenance').select('*').eq('project_id', projectId).order('record_date', { ascending: false })
  return {
    project: project as import('../types').Project,
    customer: customer as Customer,
    contract: contract as import('../types').Contract,
    annualRecords: (arData ?? []).map(annualRecordFromStorage) as import('../types').AnnualRecord[],
    maintenanceResponses: (mrData ?? []) as import('../types').MaintenanceResponse[],
    periodicMaintenance: (pmData ?? []) as import('../types').PeriodicMaintenance[],
  }
}
