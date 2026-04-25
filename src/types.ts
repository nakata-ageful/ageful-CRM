// ──────────────────────────────────────────────────────────
// Core domain types
// ──────────────────────────────────────────────────────────

export type Customer = {
  id: number
  name: string               // 個人名
  name_kana: string | null   // ふりがな
  company_name: string | null // 法人名（法人の場合）
  is_corporate: boolean
  email: string | null
  phone: string | null
  postal_code: string | null
  address: string | null
  created_at: string
  project_count?: number
}

export type Project = {
  id: number
  customer_id: number
  project_no: string | null
  project_name: string
  plant_name: string | null    // 発電所名（案件名とは別）
  // 発電所住所
  site_postal_code: string | null
  site_prefecture: string | null
  site_address: string | null
  latitude: number | null
  longitude: number | null
  // パネル情報
  panel_kw: number | null
  panel_count: number | null
  panel_maker: string | null
  panel_model: string | null
  // PCS情報
  pcs_kw: number | null
  pcs_count: number | null
  pcs_maker: string | null
  pcs_model: string | null
  // 経産・FIT
  grid_id: string | null
  grid_certified_at: string | null
  fit_period: number | null
  power_supply_start_date: string | null
  customer_number: string | null
  generation_point_id: string | null
  meter_reading_day: string | null
  // 監視情報
  monitoring_system: string | null
  monitoring_id: string | null
  monitoring_user: string | null
  monitoring_pw: string | null
  has_4g: boolean | null
  // その他
  key_number: string | null
  local_association: string | null
  old_owner: string | null
  sales_company: string | null
  referrer: string | null
  power_change_date: string | null  // 電力変更日
  handover_date: string | null
  sales_price: number | null
  reference_price: number | null
  land_cost: number | null
  amuras_member_no: string | null
  notes: string | null
  created_at: string
}

export type MaintenancePlanLevel = 'なし' | '年1回' | '年2回' | '年3回' | '無制限'

export type Contract = {
  id: number
  project_id: number
  billing_method: string | null  // 請求書 / 口座振替
  billing_due_day: string | null // 例: "12月1日"
  billing_amount_ex: number | null
  billing_amount_inc: number | null
  annual_maintenance_ex: number | null
  annual_maintenance_inc: number | null
  land_cost_monthly: number | null
  insurance_fee: number | null
  other_fee: number | null
  transfer_fee: number | null    // 振替手数料
  transfer_account: number | null
  // 契約日
  sale_contract_date: string | null       // 売買契約日
  equipment_contract_date: string | null  // 設備契約日
  land_contract_date: string | null       // 土地契約日
  maintenance_contract_date: string | null // 保守契約日
  // 販売経路
  sales_to_neosys: string | null    // 販売店→ネオシス
  neosys_to_referrer: string | null // ネオシス→紹介者
  contractor_name: string | null    // 契約者名
  // 請求回数
  billing_count: number | null   // 年間請求回数（1=年1回, 2=年2回...）
  // 保守委託
  subcontractor: string | null   // 委託先
  subcontract_fee_ex: number | null
  subcontract_fee_inc: number | null
  subcontract_billing_day: string | null
  subcontract_start_date: string | null
  maintenance_start_date: string | null
  // 保守プラン
  plan_inspection: MaintenancePlanLevel | null  // 点検
  plan_weeding: MaintenancePlanLevel | null     // 除草
  plan_emergency: MaintenancePlanLevel | null   // 駆けつけ
  notes: string | null
  created_at: string
}

export type AnnualRecordStatus = '' | '請求済' | '入金済'

export type BillingLineItem = { name: string; amount: number }

export type PaymentEntry = {
  seq: number              // 第N回（1-based）
  scheduled_date: string | null  // 請求予定日
  billing_date: string | null    // 請求日
  received_date: string | null   // 入金日
}

export type AnnualRecord = {
  id: number
  contract_id: number
  year: number
  billing_scheduled_date: string | null  // 請求予定日
  billing_date: string | null   // 請求日
  payment_due_date: string | null  // 入金予定日
  received_date: string | null  // 入金日（単回の場合 or 最終入金日）
  line_items: BillingLineItem[] | null   // 請求明細
  payments: PaymentEntry[] | null  // 分割入金記録
  maintenance_record: string | null // 保守記録メモ
  escort_record: string | null  // 駆付記録
  transfer_failed: boolean | null  // 振替不能フラグ（口座振替のみ）
  status: AnnualRecordStatus
}

export type MaintenanceResponseStatus = '対応中' | '完了'

export type MaintenanceResponse = {
  id: number
  response_no: string | null     // 管理番号（例: "25001"）
  project_id: number
  status: MaintenanceResponseStatus
  inquiry_date: string | null    // 問合日
  occurrence_date: string | null // 発生日
  target_area: string | null     // 対象箇所
  situation: string | null       // 状況
  response_content: string | null // 対応
  report: string | null          // 報告
  created_at: string
  // joined
  project_name?: string
  customer_name?: string
}

export type PeriodicMaintenance = {
  id: number
  project_id: number
  record_date: string
  work_type: string | null // 点検 / 除草 / 巡回 / その他
  content: string | null
  created_at: string
}

export type Attachment = {
  id: number
  customer_id: number
  file_name: string
  file_url: string
  file_type: string  // pdf / image / other
  description: string | null
  uploaded_at: string
}

// ──────────────────────────────────────────────────────────
// Composite / view types
// ──────────────────────────────────────────────────────────

export type DashboardStats = {
  totalCustomers: number
  totalProjects: number
  activeMaintenanceCount: number   // 対応中の保守対応件数
  pendingBillingCount: number      // 今月入金予定件数
}

export type ProjectRow = {
  id: number
  customer_id: number
  project_no: string | null
  project_name: string
  site_prefecture: string | null
  site_address: string | null
  fit_period: number | null
  handover_date: string | null
  monitoring_system: string | null
  subcontractor: string | null       // 委託先（contractから）
  maintenance_start_date: string | null
  created_at: string
  customer_name: string
  company_name: string | null
}

export type ProjectDetail = {
  project: Project
  customer: Customer
  contract: Contract | null
  annualRecords: AnnualRecord[]
  maintenanceResponses: MaintenanceResponse[]
  periodicMaintenance: PeriodicMaintenance[]
}

export type CustomerDetailData = {
  customer: Customer
  projects: ProjectRow[]
  attachments: Attachment[]
}

export type BillingRow = {
  project_id: number
  project_name: string
  customer_name: string
  company_name: string | null
  contract: Contract | null
  currentYearRecord: AnnualRecord | null
  currentYear: number
}

export type BillingDetail = {
  project: Project
  customer: Customer
  contract: Contract
  annualRecords: AnnualRecord[]
  maintenanceResponses: MaintenanceResponse[]
  periodicMaintenance: PeriodicMaintenance[]
}

// ──────────────────────────────────────────────────────────
// Form input types
// ──────────────────────────────────────────────────────────

export type CustomerInput = {
  name: string
  name_kana: string
  company_name: string
  is_corporate: boolean
  email: string
  phone: string
  postal_code: string
  address: string
}

export type MaintenanceResponseInput = {
  project_id: number
  inquiry_date: string
  occurrence_date: string
  target_area: string
  situation: string
  response_content: string
  report: string
}

export type PeriodicMaintenanceInput = {
  project_id: number
  record_date: string
  work_type: string
  content: string
}

export type AnnualRecordInput = {
  contract_id: number
  year: number
  billing_date: string
  received_date: string
  maintenance_record: string
  escort_record: string
  status: AnnualRecordStatus
}

// ──────────────────────────────────────────────────────────
// Prospect types（見込み管理）
// ──────────────────────────────────────────────────────────

export type ProspectApplyStatus = '未' | '提出済' | '通過' | '不通' | '不可'
export type ProspectContractStatus = '未' | '完了' | '不可'

export type Prospect = {
  id: number
  customer_name: string
  customer_name_kana: string | null
  project_name: string
  loan_company: string | null       // アプラス / ジャックス
  equipment: number | null          // 設備費（円）
  land_cost: number | null          // 土地費（円）
  loan_amount: number | null        // 融資額（円）
  apply_status: ProspectApplyStatus
  contract_status: ProspectContractStatus
  apply_tasks: Record<string, boolean>
  contract_tasks: Record<string, boolean>
  apply_sub_tasks: Record<string, Record<string, boolean>>
  contract_sub_tasks: Record<string, Record<string, boolean>>
  apply_memo: string | null
  contract_memo: string | null
  site_address: string | null
  panel_kw: number | null
  referrer: string | null
  lead_date: string | null
  apply_submit_date: string | null
  apply_result_date: string | null
  sale_contract_date: string | null
  land_contract_date: string | null
  handover_date: string | null
  converted_customer_id: number | null
  converted_at: string | null
  created_at: string
}

export type ProspectInput = {
  customer_name: string
  customer_name_kana: string
  project_name: string
  loan_company: string
  equipment: string
  land_cost: string
  loan_amount: string
  site_address: string
  panel_kw: string
  referrer: string
  lead_date: string
}

// ──────────────────────────────────────────────────────────
// CSV import type (legacy format)
// ──────────────────────────────────────────────────────────

export type CsvImportRow = {
  customer_name: string
  company_name: string
  email: string
  phone: string
  postal_code: string
  customer_address: string
  project_name: string
  project_number: string
  key_number: string
  site_address: string
  grid_id: string
  grid_certified_at: string
  fit_period: string
  power_supply_start_date: string
  fit_end_date: string
  generation_point_id: string
  customer_number: string
  handover_date: string
  power_change_date: string
  sales_company: string
  referrer: string
  sales_price: string
  reference_price: string
  land_cost: string
  amuras_member_no: string
  monitoring_system: string
  notes: string
  latitude: string
  longitude: string
  panel_kw: string
  panel_count: string
  panel_manufacturer: string
  panel_model: string
  pcs_kw: string
  pcs_count: string
  pcs_manufacturer: string
  pcs_model: string
  // Extra project fields (populated by 全体 format only)
  plant_name?: string          // 発電所名（col7）
  site_postal_code?: string
  meter_reading_day?: string
  monitoring_id?: string
  monitoring_pw?: string
  has_4g_str?: string    // '有'/'可'/'要' → true, '無'/'ー' → false
  local_association?: string
  old_owner?: string
  // Contract fields (populated by 全体 format only)
  billing_method?: string
  billing_due_day?: string     // 請求予定日（col54）
  billing_amount_ex?: string
  billing_amount_inc?: string
  annual_maintenance_ex?: string
  annual_maintenance_inc?: string
  land_cost_monthly?: string   // 土地賃料（col59）
  insurance_fee?: string       // 保険料（col60）
  other_fee?: string           // その他（col61）
  transfer_fee?: string        // 振替手数料（col62）
  contract_notes?: string      // 契約備考（col63）
  sale_contract_date?: string       // 売買契約日（col45）
  equipment_contract_date?: string  // 設備契約日（col46）
  land_contract_date?: string       // 土地契約日（col47）
  maintenance_contract_date?: string // 保守契約日（col48）
  sales_to_neosys?: string     // 販売店→ネオシス（col50）
  neosys_to_referrer?: string  // ネオシス→紹介者（col51）
  contractor_name?: string     // 契約者名（col52）
  maintenance_start_date?: string
  subcontractor?: string
  subcontract_fee_ex?: string
  subcontract_fee_inc?: string
  subcontract_start_date?: string
}

/** 請求CSVインポート行 */
export type BillingImportRow = {
  customer_name: string       // 事業主
  project_name: string        // 案件名
  billing_method: string      // 請求方法
  billing_due_day: string     // 請求予定日
  billing_amount_ex: string   // 請求金額(税別)
  billing_amount_inc: string  // 請求金額(税込)
  annual_maintenance_ex: string  // 年間保守料(税別)
  annual_maintenance_inc: string // 年間保守料(税込)
  land_cost_monthly: string   // 土地賃料
  transfer_fee: string        // 振替手数料
  insurance_fee: string       // 保険料
  work_fee: string            // 作業費
  notes: string               // 備考
  maintenance_start: string   // 保守開始日/年
  subcontractor: string       // 委託先
  subcontract_fee_ex: string  // 委託料(税別)
  subcontract_fee_inc: string // 委託料(税込)
  subcontract_billing_day: string // 委託支払日
  subcontract_start_date: string  // 委託開始日
  auto_recovery: string       // 自動復旧
  // 年度別データ
  years: {
    year: number
    received_date: string      // 入金日
    billing_date: string       // 請求日
    maintenance_record: string // 保守記録
    escort_record: string      // 駆付記録
  }[]
}
