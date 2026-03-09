// ──────────────────────────────────────────────────────────
// Core domain types
// ──────────────────────────────────────────────────────────

export type Customer = {
  id: number
  type: 'individual' | 'corporate'
  company_name: string | null
  contact_name: string
  email: string | null
  phone: string | null
  postal_code: string | null
  address: string | null
  notes: string | null
  created_at: string
  project_count?: number
}

export type Project = {
  id: number
  customer_id: number
  project_number: string | null
  project_name: string
  site_address: string | null
  key_number: string | null
  // FIT・系統情報
  grid_id: string | null
  grid_certified_at: string | null
  fit_period: number | null
  fit_end_date: string | null
  power_supply_start_date: string | null
  generation_point_id: string | null
  customer_number: string | null
  // 日程
  handover_date: string | null
  abolition_date: string | null
  // 販売情報
  sales_company: string | null
  referrer: string | null
  sales_price: number | null
  reference_price: number | null
  land_cost: number | null
  // 保守管理
  amuras_member_no: string | null
  monitoring_system: string | null
  notes: string | null
  // 座標
  latitude: number | null
  longitude: number | null
  created_at: string
}

export type PowerPlantSpec = {
  panel_kw: number | null
  panel_count: number | null
  panel_manufacturer: string | null
  panel_model: string | null
  pcs_kw: number | null
  pcs_count: number | null
  pcs_manufacturer: string | null
  pcs_model: string | null
}

export type MaintenanceStatus = 'pending' | 'in_progress' | 'completed'

export type MaintenanceLog = {
  id: number
  project_id: number
  inquiry_date: string | null
  occurrence_date: string | null
  work_type: string | null
  target_area: string | null
  situation: string | null
  response: string | null
  report: string | null
  status: MaintenanceStatus
  created_at: string
  // joined
  project_name?: string
  customer_name?: string
}

export type Contract = {
  id: number
  project_id: number
  contract_type: string | null
  business_owner: string | null
  contractor: string | null
  start_date: string | null
  end_date: string | null
  annual_maintenance_fee: number | null
  communication_fee: number | null
  created_at: string
}

export type InvoiceStatus = 'unbilled' | 'billed' | 'paid'

export type Invoice = {
  id: number
  contract_id: number
  billing_period: string | null
  issue_date: string | null
  amount: number | null
  status: InvoiceStatus
  payment_due_date: string | null
  paid_at: string | null
}

// ──────────────────────────────────────────────────────────
// Composite / view types
// ──────────────────────────────────────────────────────────

export type DashboardStats = {
  totalCustomers: number
  totalProjects: number
  pendingMaintenanceCount: number
  unbilledInvoiceCount: number
}

export type BillingRow = {
  contract_name: string
  project_name: string
  invoice: Invoice
}

export type CustomerDetail = {
  customer: Customer
  projects: (Project & { spec: PowerPlantSpec | null })[]
  recentMaintenance: MaintenanceLog[]
}

export type ProjectRow = {
  id: number
  customer_id: number
  project_number: string | null
  project_name: string
  site_address: string | null
  key_number: string | null
  fit_end_date: string | null
  handover_date: string | null
  sales_company: string | null
  created_at: string
  customer_name: string
  company_name: string | null
}

// ──────────────────────────────────────────────────────────
// Form input types
// ──────────────────────────────────────────────────────────

export type CustomerInput = {
  type: 'individual' | 'corporate'
  company_name: string
  contact_name: string
  email: string
  phone: string
  postal_code: string
  address: string
  notes: string
}

export type MaintenanceInput = {
  project_id: number
  inquiry_date: string
  occurrence_date: string
  work_type: string
  target_area: string
  situation: string
  response: string
  report: string
}

// ──────────────────────────────────────────────────────────
// CSV import type
// ──────────────────────────────────────────────────────────

export type CsvImportRow = {
  // 顧客情報（名寄せキー: customer_name）
  customer_name: string
  company_name: string
  email: string
  phone: string
  postal_code: string
  customer_address: string
  // 案件基本
  project_name: string
  project_number: string
  key_number: string
  site_address: string
  // FIT・系統
  grid_id: string
  grid_certified_at: string
  fit_period: string
  power_supply_start_date: string
  fit_end_date: string
  generation_point_id: string
  customer_number: string
  // 日程
  handover_date: string
  abolition_date: string
  // 販売
  sales_company: string
  referrer: string
  sales_price: string
  reference_price: string
  land_cost: string
  // 保守
  amuras_member_no: string
  monitoring_system: string
  notes: string
  // 座標
  latitude: string
  longitude: string
  // 発電スペック
  panel_kw: string
  panel_count: string
  panel_manufacturer: string
  panel_model: string
  pcs_kw: string
  pcs_count: string
  pcs_manufacturer: string
  pcs_model: string
}
