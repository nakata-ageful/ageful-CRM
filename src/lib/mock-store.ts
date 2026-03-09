/**
 * Module-level in-memory store.
 * Persists within the browser session (resets on page reload).
 */
import type { Customer, Project, MaintenanceLog, Contract, Invoice, PowerPlantSpec } from '../types'

// ── 初期データ ────────────────────────────────────────────

const nullProjectFields = {
  grid_id: null,
  grid_certified_at: null,
  fit_period: null,
  fit_end_date: null,
  power_supply_start_date: null,
  generation_point_id: null,
  customer_number: null,
  handover_date: null,
  abolition_date: null,
  sales_company: null,
  referrer: null,
  sales_price: null,
  reference_price: null,
  land_cost: null,
  amuras_member_no: null,
  monitoring_system: null,
  notes: null,
  latitude: null,
  longitude: null,
}

const initCustomers: Customer[] = [
  { id: 1, type: 'corporate', company_name: '株式会社エイジフル', contact_name: '田中 太郎', email: 'tanaka@ageful.jp', phone: '03-1234-5678', postal_code: '150-0001', address: '東京都渋谷区神宮前1-1-1', notes: '主要顧客', created_at: '2025-04-01', project_count: 2 },
  { id: 2, type: 'corporate', company_name: '中村電設株式会社', contact_name: '中村 一郎', email: 'info@nakamura.jp', phone: '06-1111-2222', postal_code: '530-0001', address: '大阪府大阪市北区梅田2-2-2', notes: null, created_at: '2025-05-10', project_count: 1 },
  { id: 3, type: 'individual', company_name: null, contact_name: '佐藤 花子', email: 'hanako@example.com', phone: '090-9876-5432', postal_code: '192-0001', address: '東京都八王子市東町3-3-3', notes: '屋根貸し案件', created_at: '2025-06-15', project_count: 1 },
]

const initProjects: Project[] = [
  { id: 1, customer_id: 1, project_number: 'PJ-2025-001', project_name: '柏市 太陽光A', site_address: '千葉県柏市光が丘1-1', key_number: 'KB-18', created_at: '2025-04-10', ...nullProjectFields, fit_period: 20, fit_end_date: '2034-04-10', sales_company: '株式会社エイジフル' },
  { id: 2, customer_id: 1, project_number: 'PJ-2025-002', project_name: '川崎市 屋根設置', site_address: '神奈川県川崎市中原区2-2', key_number: 'KW-05', created_at: '2025-06-01', ...nullProjectFields, fit_period: 20, fit_end_date: '2035-06-01' },
  { id: 3, customer_id: 2, project_number: 'PJ-2025-003', project_name: '横浜 発電所3号', site_address: '神奈川県横浜市港北区3-3', key_number: 'YH-03', created_at: '2025-07-20', ...nullProjectFields, fit_period: 20, fit_end_date: '2035-07-20' },
  { id: 4, customer_id: 3, project_number: 'PJ-2025-004', project_name: '八王子 屋根案件', site_address: '東京都八王子市東町3-3-3', key_number: 'HA-11', created_at: '2025-08-05', ...nullProjectFields },
]

const initSpecs: (PowerPlantSpec & { project_id: number })[] = [
  { project_id: 1, panel_kw: 49.5, panel_count: 132, panel_manufacturer: 'パナソニック', panel_model: 'VBHN240SJ25', pcs_kw: 49.5, pcs_count: 2, pcs_manufacturer: '田淵電機', pcs_model: 'PVISC-J50M' },
  { project_id: 2, panel_kw: 30.0, panel_count: 80, panel_manufacturer: '京セラ', panel_model: 'KJ375P-CCMA-4', pcs_kw: 30.0, pcs_count: 1, pcs_manufacturer: 'SMA', pcs_model: 'Sunny Boy 3.0' },
  { project_id: 3, panel_kw: 99.0, panel_count: 264, panel_manufacturer: '三菱電機', panel_model: 'EF270ED5B', pcs_kw: 99.0, pcs_count: 4, pcs_manufacturer: 'オムロン', pcs_model: 'KPW-A-2' },
  { project_id: 4, panel_kw: 10.0, panel_count: 27, panel_manufacturer: 'シャープ', panel_model: 'ND-372AS', pcs_kw: 9.9, pcs_count: 1, pcs_manufacturer: '長州産業', pcs_model: 'CS-320B81M' },
]

const initMaintenance: MaintenanceLog[] = [
  { id: 1, project_id: 1, inquiry_date: '2026-02-20', occurrence_date: '2026-02-20', work_type: 'PCS点検', target_area: 'PCS', situation: '遠隔監視でエラー警告', response: '現地確認・設定リセット', report: '次回3ヶ月後に再確認', status: 'in_progress', created_at: '2026-02-20', project_name: '柏市 太陽光A', customer_name: '株式会社エイジフル' },
  { id: 2, project_id: 3, inquiry_date: '2026-02-18', occurrence_date: '2026-02-18', work_type: '遠隔監視', target_area: '通信機器', situation: '通信断が発生', response: '通信モジュール交換対応中', report: null, status: 'pending', created_at: '2026-02-18', project_name: '横浜 発電所3号', customer_name: '中村電設株式会社' },
  { id: 3, project_id: 4, inquiry_date: '2026-02-10', occurrence_date: '2026-02-10', work_type: '定期保守', target_area: 'パネル', situation: '年次定期点検', response: '清掃・目視点検完了', report: '異常なし', status: 'completed', created_at: '2026-02-10', project_name: '八王子 屋根案件', customer_name: '佐藤 花子' },
  { id: 4, project_id: 2, inquiry_date: '2026-01-25', occurrence_date: '2026-01-25', work_type: 'パネル点検', target_area: 'パネル', situation: '出力低下の報告あり', response: 'パネル洗浄・接続確認', report: '出力正常化確認', status: 'completed', created_at: '2026-01-25', project_name: '川崎市 屋根設置', customer_name: '株式会社エイジフル' },
]

const initContracts: Contract[] = [
  { id: 1, project_id: 1, contract_type: 'maintenance', business_owner: '株式会社エイジフル', contractor: null, start_date: '2025-04-01', end_date: '2026-03-31', annual_maintenance_fee: 1200000, communication_fee: 180000, created_at: '2025-04-01' },
  { id: 2, project_id: 3, contract_type: 'maintenance', business_owner: '中村電設株式会社', contractor: null, start_date: '2025-07-01', end_date: '2026-06-30', annual_maintenance_fee: 2400000, communication_fee: 240000, created_at: '2025-07-01' },
]

const initInvoices: Invoice[] = [
  { id: 1, contract_id: 1, billing_period: '2026-02', issue_date: '2026-02-01', amount: 115000, status: 'unbilled', payment_due_date: '2026-03-31', paid_at: null },
  { id: 2, contract_id: 1, billing_period: '2026-01', issue_date: '2026-01-01', amount: 115000, status: 'paid', payment_due_date: '2026-02-28', paid_at: '2026-02-15' },
  { id: 3, contract_id: 2, billing_period: '2026-02', issue_date: '2026-02-01', amount: 220000, status: 'billed', payment_due_date: '2026-03-31', paid_at: null },
]

// ── Store 本体 ────────────────────────────────────────────

let customers = [...initCustomers]
let projects = [...initProjects]
let specs = [...initSpecs]
let maintenance = [...initMaintenance]
let contracts = [...initContracts]
let invoices = [...initInvoices]

let _nextCustId = 10
let _nextProjId = 10
let _nextMaintId = 10
let _nextSpecId = 10

// ── Customers ─────────────────────────────────────────────

export const customerStore = {
  getAll: () => customers.map(c => ({
    ...c,
    project_count: projects.filter(p => p.customer_id === c.id).length,
  })),
  getById: (id: number) => customers.find(c => c.id === id) ?? null,
  findByName: (name: string) => customers.find(c => c.contact_name === name) ?? null,
  create: (input: Omit<Customer, 'id' | 'created_at' | 'project_count'>) => {
    const now = new Date().toISOString().slice(0, 10)
    const c: Customer = { ...input, id: _nextCustId++, created_at: now }
    customers = [...customers, c]
    return c
  },
  update: (id: number, input: Partial<Omit<Customer, 'id' | 'created_at'>>) => {
    customers = customers.map(c => c.id === id ? { ...c, ...input } : c)
    return customers.find(c => c.id === id) ?? null
  },
  delete: (id: number) => {
    customers = customers.filter(c => c.id !== id)
  },
}

// ── Projects ──────────────────────────────────────────────

export const projectStore = {
  getAll: () => projects,
  getByCustomerId: (customerId: number) => projects.filter(p => p.customer_id === customerId),
  getById: (id: number) => projects.find(p => p.id === id) ?? null,
  create: (input: Omit<Project, 'id' | 'created_at'>) => {
    const now = new Date().toISOString().slice(0, 10)
    const p: Project = { ...input, id: _nextProjId++, created_at: now }
    projects = [...projects, p]
    return p
  },
  update: (id: number, input: Partial<Omit<Project, 'id' | 'created_at'>>) => {
    projects = projects.map(p => p.id === id ? { ...p, ...input } : p)
    return projects.find(p => p.id === id) ?? null
  },
  delete: (id: number) => {
    projects = projects.filter(p => p.id !== id)
  },
}

// ── Specs ─────────────────────────────────────────────────

export const specStore = {
  getByProjectId: (projectId: number) => specs.find(s => s.project_id === projectId) ?? null,
  upsert: (projectId: number, input: PowerPlantSpec) => {
    const existing = specs.find(s => s.project_id === projectId)
    if (existing) {
      specs = specs.map(s => s.project_id === projectId ? { ...s, ...input } : s)
    } else {
      specs = [...specs, { ...input, project_id: projectId, id: _nextSpecId++ } as typeof specs[0]]
    }
  },
}

// ── Maintenance ───────────────────────────────────────────

export const maintenanceStore = {
  getAll: () => maintenance.map(m => ({
    ...m,
    project_name: projects.find(p => p.id === m.project_id)?.project_name ?? '不明',
    customer_name: (() => {
      const proj = projects.find(p => p.id === m.project_id)
      if (!proj) return '不明'
      const cust = customers.find(c => c.id === proj.customer_id)
      return cust?.company_name ?? cust?.contact_name ?? '不明'
    })(),
  })),
  getByProjectId: (projectId: number) => maintenance.filter(m => m.project_id === projectId),
  create: (input: Omit<MaintenanceLog, 'id' | 'created_at' | 'status' | 'project_name' | 'customer_name'>) => {
    const now = new Date().toISOString().slice(0, 10)
    const m: MaintenanceLog = { ...input, id: _nextMaintId++, status: 'pending', created_at: now }
    maintenance = [...maintenance, m]
    return m
  },
  updateStatus: (id: number, status: MaintenanceLog['status']) => {
    maintenance = maintenance.map(m => m.id === id ? { ...m, status } : m)
    return maintenance.find(m => m.id === id) ?? null
  },
  delete: (id: number) => {
    maintenance = maintenance.filter(m => m.id !== id)
  },
}

// ── Contracts & Invoices ──────────────────────────────────

export const contractStore = {
  getAll: () => contracts,
  getByProjectId: (projectId: number) => contracts.filter(c => c.project_id === projectId),
}

export const invoiceStore = {
  getAll: () => invoices,
  getByContractId: (contractId: number) => invoices.filter(i => i.contract_id === contractId),
  updateStatus: (id: number, status: Invoice['status']) => {
    const now = new Date().toISOString().slice(0, 10)
    invoices = invoices.map(i => i.id === id
      ? { ...i, status, paid_at: status === 'paid' ? now : i.paid_at }
      : i
    )
    return invoices.find(i => i.id === id) ?? null
  },
}
