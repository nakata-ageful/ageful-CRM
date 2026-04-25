/**
 * In-memory mock store — persists within browser session, resets on reload.
 * Data is based on actual Ageful spreadsheets.
 */
import type {
  Customer, Project, Contract, AnnualRecord,
  MaintenanceResponse, PeriodicMaintenance, Attachment, Prospect
} from '../types'

// ── 初期顧客データ ─────────────────────────────────────────

const initCustomers: Customer[] = [
  { id: 1, name: '大野 修善', company_name: null, is_corporate: false, name_kana: null, email: null, phone: '090-3563-8698', postal_code: '471-0878', address: '愛知県豊田市上挙母1-3-3', created_at: '2020-06-01' },
  { id: 2, name: '仲 奈夫子', company_name: null, is_corporate: false, name_kana: null, email: 'n.k.you.free@gmail.com', phone: '090-2912-1272', postal_code: '344-0067', address: '埼玉県春日部市中央1-57-3', created_at: '2021-07-22' },
  { id: 3, name: '森田 義雄', company_name: null, is_corporate: false, name_kana: null, email: 'yoshio.m.0527@gmail.com', phone: '080-1038-4530', postal_code: null, address: null, created_at: '2020-12-16' },
  { id: 4, name: '小泉 千尋', company_name: null, is_corporate: false, name_kana: null, email: 'kchihiro2801@gmail.com', phone: '080-1123-0732', postal_code: null, address: null, created_at: '2020-06-25' },
  { id: 5, name: '岩山 洋行', company_name: null, is_corporate: false, name_kana: null, email: 'lifeisplaying@yahoo.co.jp', phone: '080-2255-5284', postal_code: null, address: '兵庫県宍粟市赤西304', created_at: '2022-01-14' },
  { id: 6, name: '川上 貴弘', company_name: null, is_corporate: false, name_kana: null, email: 'taka110058kt@gmail.com', phone: null, postal_code: '285-0812', address: '千葉県佐倉市上座743', created_at: '2021-10-27' },
  { id: 7, name: '田中', company_name: 'ヴェクトレイトSE', is_corporate: true, name_kana: null, email: null, phone: null, postal_code: null, address: null, created_at: '2020-01-01' },
  { id: 8, name: '平澤 滋実', company_name: null, is_corporate: false, name_kana: null, email: null, phone: null, postal_code: null, address: null, created_at: '2021-05-01' },
]

// ── 初期案件データ ─────────────────────────────────────────

const initProjects: Project[] = [
  {
    id: 1, customer_id: 7, project_no: null, plant_name: null, project_name:'阿久根',
    site_postal_code: '895-1402', site_prefecture: '鹿児島県', site_address: '薩摩川内市阿久根浦之名14458-3',
    latitude: null, longitude: null,
    panel_kw: 45.9, panel_count: 180, panel_maker: 'ハンファ', panel_model: 'Q.PRO-G3 255',
    pcs_kw: 50.0, pcs_count: 5, pcs_maker: '新電元工業', pcs_model: null,
    grid_id: 'A829960H46', grid_certified_at: '2013-11-25', fit_period: 36,
    power_supply_start_date: '2014-03-28', customer_number: '05-822-497-14-0000650', generation_point_id: null,
    meter_reading_day: null, monitoring_system: 'エントリア', monitoring_id: null, monitoring_user: null, monitoring_pw: null, has_4g: null,
    key_number: '8989', local_association: null, old_owner: null,
    sales_company: 'ポリシス', referrer: 'ポリシス', power_change_date: null, handover_date: '2019-12-27',
    sales_price: 28000000, reference_price: null, land_cost: null,
    amuras_member_no: null, notes: null, created_at: '2020-01-01',
  },
  {
    id: 2, customer_id: 1, project_no: null, plant_name: null, project_name:'幡ヶ岳ソーラーエネルギー',
    site_postal_code: '788-0323', site_prefecture: '高知県', site_address: '幡多郡大正町江師 子丸田710付',
    latitude: null, longitude: null,
    panel_kw: null, panel_count: null, panel_maker: null, panel_model: null,
    pcs_kw: null, pcs_count: null, pcs_maker: null, pcs_model: null,
    grid_id: null, grid_certified_at: '2020-12-16', fit_period: 18,
    power_supply_start_date: null, customer_number: null, generation_point_id: null,
    meter_reading_day: '20日', monitoring_system: 'エントリア', monitoring_id: '0006-546-8523', monitoring_user: null, monitoring_pw: null, has_4g: false,
    key_number: '0598', local_association: null, old_owner: null,
    sales_company: 'キャピタルグラース', referrer: 'Next Futures', power_change_date: null, handover_date: '2022-06-25',
    sales_price: 23800000, reference_price: null, land_cost: null,
    amuras_member_no: null, notes: null, created_at: '2020-12-16',
  },
  {
    id: 3, customer_id: 6, project_no: null, plant_name: null, project_name:'天草8666',
    site_postal_code: '861-6551', site_prefecture: '熊本県', site_address: '天草市上浦町深浦8666-10',
    latitude: 32.402234, longitude: 130.246934,
    panel_kw: null, panel_count: null, panel_maker: null, panel_model: null,
    pcs_kw: null, pcs_count: null, pcs_maker: null, pcs_model: null,
    grid_id: null, grid_certified_at: '2021-10-27', fit_period: 14,
    power_supply_start_date: null, customer_number: null, generation_point_id: null,
    meter_reading_day: '14日', monitoring_system: 'FusionSolar', monitoring_id: 'taka110058@gmail.com', monitoring_user: 'amakusa8666', monitoring_pw: null, has_4g: false,
    key_number: '9121', local_association: null, old_owner: null,
    sales_company: 'CV21', referrer: 'CV21', power_change_date: null, handover_date: '2021-11-25',
    sales_price: 17750000, reference_price: null, land_cost: null,
    amuras_member_no: null, notes: null, created_at: '2021-10-27',
  },
  {
    id: 4, customer_id: 2, project_no: null, plant_name: null, project_name:'竹田市梅木水引',
    site_postal_code: '878-0204', site_prefecture: '大分県', site_address: '竹田市九重野大字梅木字水引3811-9',
    latitude: 33.025612, longitude: 131.351047,
    panel_kw: 94.34, panel_count: null, panel_maker: 'Maxar', panel_model: null,
    pcs_kw: 49.5, pcs_count: null, pcs_maker: 'HUWEI', pcs_model: null,
    grid_id: null, grid_certified_at: '2021-07-22', fit_period: 21,
    power_supply_start_date: null, customer_number: null, generation_point_id: null,
    meter_reading_day: '6日', monitoring_system: null, monitoring_id: null, monitoring_user: null, monitoring_pw: null, has_4g: false,
    key_number: '4649', local_association: null, old_owner: null,
    sales_company: 'WWB', referrer: 'CV21', power_change_date: null, handover_date: '2021-10-29',
    sales_price: 27742000, reference_price: null, land_cost: null,
    amuras_member_no: null, notes: '保守費：12/25支払済', created_at: '2021-07-22',
  },
  {
    id: 5, customer_id: 3, project_no: null, plant_name: null, project_name:'枌木第一丸田・保守',
    site_postal_code: '788-0323', site_prefecture: '高知県', site_address: '幡多郡大正町江師 子丸田710付',
    latitude: null, longitude: null,
    panel_kw: null, panel_count: null, panel_maker: null, panel_model: null,
    pcs_kw: null, pcs_count: null, pcs_maker: null, pcs_model: null,
    grid_id: null, grid_certified_at: '2020-12-16', fit_period: 18,
    power_supply_start_date: null, customer_number: null, generation_point_id: null,
    meter_reading_day: null, monitoring_system: 'エントリア', monitoring_id: '0006-546-8523', monitoring_user: null, monitoring_pw: null, has_4g: false,
    key_number: '0598', local_association: null, old_owner: null,
    sales_company: 'Next Futures', referrer: 'NextFutures新妻', power_change_date: null, handover_date: '2022-06-25',
    sales_price: 23800000, reference_price: null, land_cost: null,
    amuras_member_no: null, notes: null, created_at: '2020-12-16',
  },
  {
    id: 6, customer_id: 4, project_no: null, plant_name: null, project_name:'三好市奥公',
    site_postal_code: '771-2302', site_prefecture: '徳島県', site_address: '三好市三野町大字加茂野宮413-3',
    latitude: 34.044083, longitude: 133.983222,
    panel_kw: null, panel_count: null, panel_maker: null, panel_model: null,
    pcs_kw: null, pcs_count: null, pcs_maker: null, pcs_model: null,
    grid_id: null, grid_certified_at: '2020-06-25', fit_period: 18,
    power_supply_start_date: null, customer_number: null, generation_point_id: null,
    meter_reading_day: '23日', monitoring_system: 'ラプラス', monitoring_id: null, monitoring_user: null, monitoring_pw: null, has_4g: false,
    key_number: '018', local_association: null, old_owner: null,
    sales_company: 'キャピタルグラース', referrer: 'キャピタルグラース', power_change_date: null, handover_date: '2022-06-25',
    sales_price: 19000000, reference_price: null, land_cost: null,
    amuras_member_no: '0020-0728-6137', notes: null, created_at: '2020-06-25',
  },
  {
    id: 7, customer_id: 5, project_no: null, plant_name: null, project_name:'淡路市心谷1',
    site_postal_code: '656-2131', site_prefecture: '兵庫県', site_address: '淡路市心谷（ニュー）字向谷2724付',
    latitude: 34.428646, longitude: 134.895562,
    panel_kw: null, panel_count: null, panel_maker: null, panel_model: null,
    pcs_kw: null, pcs_count: null, pcs_maker: null, pcs_model: null,
    grid_id: null, grid_certified_at: '2022-01-14', fit_period: 18,
    power_supply_start_date: null, customer_number: null, generation_point_id: null,
    meter_reading_day: null, monitoring_system: 'FusionSolar', monitoring_id: 'neosith', monitoring_user: 'neosith', monitoring_pw: 'neos9022', has_4g: false,
    key_number: '1234', local_association: null, old_owner: null,
    sales_company: '日本エンロジー', referrer: '日本エンロジー', power_change_date: null, handover_date: '2022-12-20',
    sales_price: 25200000, reference_price: null, land_cost: 1000000,
    amuras_member_no: null, notes: null, created_at: '2022-01-14',
  },
  {
    id: 8, customer_id: 8, project_no: null, plant_name: null, project_name:'天草大矢野',
    site_postal_code: '861-5532', site_prefecture: '熊本県', site_address: '上天草市大矢野町太陽近太陽近山101-5',
    latitude: null, longitude: null,
    panel_kw: null, panel_count: null, panel_maker: null, panel_model: null,
    pcs_kw: null, pcs_count: null, pcs_maker: null, pcs_model: null,
    grid_id: null, grid_certified_at: '2021-02-26', fit_period: 14,
    power_supply_start_date: '2021-02-26', customer_number: null, generation_point_id: null,
    meter_reading_day: null, monitoring_system: null, monitoring_id: null, monitoring_user: null, monitoring_pw: null, has_4g: null,
    key_number: null, local_association: null, old_owner: null,
    sales_company: 'オーリキー', referrer: 'オーリキー', power_change_date: null, handover_date: null,
    sales_price: 15722955, reference_price: null, land_cost: null,
    amuras_member_no: null, notes: 'CVへの請求書はリーキーへ郵送', created_at: '2021-02-26',
  },
]

// ── 初期契約データ ─────────────────────────────────────────

const initContracts: Contract[] = [
  {
    id: 1, project_id: 1, billing_method: '請求書', billing_due_day: '12月1日',
    billing_amount_ex: 684000, billing_amount_inc: 752400,
    annual_maintenance_ex: 684000, annual_maintenance_inc: 752400,
    land_cost_monthly: null, insurance_fee: 33000, other_fee: null, transfer_fee: null, transfer_account: null,
    sale_contract_date: '2019-11-15', equipment_contract_date: null, land_contract_date: null, maintenance_contract_date: '2020-01-01',
    sales_to_neosys: null, neosys_to_referrer: null, contractor_name: 'ヴェクトレイトSE',
    subcontractor: '宮崎電業', subcontract_fee_ex: 80000, subcontract_fee_inc: 88000,
    subcontract_billing_day: null, subcontract_start_date: '2023-02-01',
    maintenance_start_date: '2020-01-01',
    plan_inspection: '年1回', plan_weeding: '年1回', plan_emergency: '無制限',
    billing_count: 1,
    notes: '清水電気448,800・新電660,000円',
    created_at: '2020-01-01',
  },
  {
    id: 2, project_id: 2, billing_method: '口座振替', billing_due_day: '6月25日',
    billing_amount_ex: 160000, billing_amount_inc: 176000,
    annual_maintenance_ex: 160000, annual_maintenance_inc: 176000,
    land_cost_monthly: null, insurance_fee: null, other_fee: null, transfer_fee: 550, transfer_account: null,
    sale_contract_date: null, equipment_contract_date: null, land_contract_date: null, maintenance_contract_date: '2022-06-01',
    sales_to_neosys: null, neosys_to_referrer: null, contractor_name: null,
    subcontractor: '九徳', subcontract_fee_ex: null, subcontract_fee_inc: 105600,
    subcontract_billing_day: '8/1', subcontract_start_date: '2022-06-25',
    maintenance_start_date: '2022-06-25',
    plan_inspection: '年1回', plan_weeding: '年1回', plan_emergency: '年1回',
    billing_count: 1,
    notes: null,
    created_at: '2022-06-25',
  },
  {
    id: 3, project_id: 3, billing_method: '請求書', billing_due_day: '11月25日',
    billing_amount_ex: null, billing_amount_inc: null,
    annual_maintenance_ex: null, annual_maintenance_inc: 187000,
    land_cost_monthly: null, insurance_fee: null, other_fee: null, transfer_fee: null, transfer_account: null,
    sale_contract_date: null, equipment_contract_date: null, land_contract_date: null, maintenance_contract_date: null,
    sales_to_neosys: null, neosys_to_referrer: null, contractor_name: null,
    subcontractor: 'TOP', subcontract_fee_ex: null, subcontract_fee_inc: 132000,
    subcontract_billing_day: null, subcontract_start_date: null,
    maintenance_start_date: null,
    plan_inspection: '年1回', plan_weeding: '年1回', plan_emergency: 'なし',
    billing_count: 1,
    notes: null,
    created_at: '2021-10-27',
  },
  {
    id: 4, project_id: 4, billing_method: '口座振替', billing_due_day: '12月1日',
    billing_amount_ex: 150000, billing_amount_inc: 165000,
    annual_maintenance_ex: 150000, annual_maintenance_inc: 165000,
    land_cost_monthly: null, insurance_fee: null, other_fee: null, transfer_fee: 550, transfer_account: null,
    sale_contract_date: null, equipment_contract_date: null, land_contract_date: null, maintenance_contract_date: null,
    sales_to_neosys: null, neosys_to_referrer: null, contractor_name: null,
    subcontractor: '九徳', subcontract_fee_ex: null, subcontract_fee_inc: 105600,
    subcontract_billing_day: '1/1', subcontract_start_date: null,
    maintenance_start_date: null,
    plan_inspection: '年1回', plan_weeding: '年1回', plan_emergency: '年1回',
    billing_count: 1,
    notes: null,
    created_at: '2021-07-22',
  },
  {
    id: 5, project_id: 5, billing_method: '請求書', billing_due_day: '6月25日',
    billing_amount_ex: 160000, billing_amount_inc: 176000,
    annual_maintenance_ex: 160000, annual_maintenance_inc: 176000,
    land_cost_monthly: null, insurance_fee: null, other_fee: null, transfer_fee: null, transfer_account: null,
    sale_contract_date: null, equipment_contract_date: null, land_contract_date: null, maintenance_contract_date: null,
    sales_to_neosys: null, neosys_to_referrer: null, contractor_name: null,
    subcontractor: '九徳', subcontract_fee_ex: null, subcontract_fee_inc: 105600,
    subcontract_billing_day: '8/1', subcontract_start_date: '2022-06-25',
    maintenance_start_date: '2022-06-25',
    plan_inspection: '年1回', plan_weeding: '年1回', plan_emergency: '年1回',
    billing_count: 1,
    notes: null,
    created_at: '2022-06-25',
  },
  {
    id: 6, project_id: 6, billing_method: '請求書', billing_due_day: '6月25日',
    billing_amount_ex: 150000, billing_amount_inc: 165000,
    annual_maintenance_ex: 150000, annual_maintenance_inc: 165000,
    land_cost_monthly: null, insurance_fee: null, other_fee: null, transfer_fee: null, transfer_account: null,
    sale_contract_date: null, equipment_contract_date: null, land_contract_date: null, maintenance_contract_date: null,
    sales_to_neosys: null, neosys_to_referrer: null, contractor_name: null,
    subcontractor: '九徳', subcontract_fee_ex: null, subcontract_fee_inc: 105600,
    subcontract_billing_day: '8/1', subcontract_start_date: '2022-06-25',
    maintenance_start_date: '2022-06-25',
    plan_inspection: '年1回', plan_weeding: '年1回', plan_emergency: '年1回',
    billing_count: 1,
    notes: null,
    created_at: '2022-06-25',
  },
  {
    id: 7, project_id: 7, billing_method: '請求書', billing_due_day: '12月20日',
    billing_amount_ex: 150000, billing_amount_inc: 165000,
    annual_maintenance_ex: 150000, annual_maintenance_inc: 165000,
    land_cost_monthly: 1000000, insurance_fee: null, other_fee: null, transfer_fee: null, transfer_account: null,
    sale_contract_date: null, equipment_contract_date: null, land_contract_date: null, maintenance_contract_date: null,
    sales_to_neosys: null, neosys_to_referrer: null, contractor_name: null,
    subcontractor: '九徳', subcontract_fee_ex: null, subcontract_fee_inc: 105600,
    subcontract_billing_day: null, subcontract_start_date: '2022-01-14',
    maintenance_start_date: '2022-01-14',
    plan_inspection: '年1回', plan_weeding: '無制限', plan_emergency: '年1回',
    billing_count: 1,
    notes: null,
    created_at: '2022-01-14',
  },
  {
    id: 8, project_id: 8, billing_method: '口座振替', billing_due_day: '2月26日',
    billing_amount_ex: null, billing_amount_inc: null,
    annual_maintenance_ex: null, annual_maintenance_inc: 110000,
    land_cost_monthly: null, insurance_fee: null, other_fee: null, transfer_fee: 550, transfer_account: null,
    sale_contract_date: null, equipment_contract_date: null, land_contract_date: null, maintenance_contract_date: null,
    sales_to_neosys: null, neosys_to_referrer: null, contractor_name: null,
    subcontractor: null, subcontract_fee_ex: null, subcontract_fee_inc: null,
    subcontract_billing_day: null, subcontract_start_date: null,
    maintenance_start_date: null,
    plan_inspection: 'なし', plan_weeding: '年1回', plan_emergency: 'なし',
    billing_count: 1,
    notes: '年間110,000円',
    created_at: '2021-02-26',
  },
]

// ── 初期年度別記録データ ────────────────────────────────────

const initAnnualRecords: AnnualRecord[] = [
  // 阿久根（contract_id:1, 請求書）— 請求済・未入金のケース
  { id: 1, contract_id: 1, year: 2023, billing_scheduled_date: null, billing_date: '2023-02-01', payment_due_date: null, received_date: '2023-02-01', line_items: [{ name: '保守料', amount: 752400 }], maintenance_record: null, escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 2, contract_id: 1, year: 2024, billing_scheduled_date: null, billing_date: '2024-01-05', payment_due_date: null, received_date: '2024-01-08', line_items: [{ name: '保守料', amount: 752400 }], maintenance_record: null, escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 3, contract_id: 1, year: 2025, billing_scheduled_date: null, billing_date: '2025-01-10', payment_due_date: '2025-02-10', received_date: '2025-02-05', line_items: [{ name: '保守料', amount: 752400 }, { name: '保険料', amount: 33000 }], maintenance_record: null, escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 4, contract_id: 1, year: 2026, billing_scheduled_date: '2026-02-01', billing_date: '2026-03-01', payment_due_date: '2026-04-01', received_date: null, line_items: [{ name: '保守料', amount: 752400 }, { name: '保険料', amount: 33000 }], maintenance_record: null, escort_record: null, transfer_failed: null, payments: null, status: '請求済' },
  // 幡ヶ岳（contract_id:2, 口座振替）— 正常振替
  { id: 5, contract_id: 2, year: 2023, billing_scheduled_date: null, billing_date: null, payment_due_date: null, received_date: '2023-07-25', line_items: [{ name: '保守料', amount: 176000 }], maintenance_record: '2023.7.4枯草・報告書', escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 6, contract_id: 2, year: 2024, billing_scheduled_date: null, billing_date: null, payment_due_date: null, received_date: '2024-05-07', line_items: [{ name: '保守料', amount: 176000 }], maintenance_record: '2024.07.06除草・報告書', escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 7, contract_id: 2, year: 2025, billing_scheduled_date: null, billing_date: null, payment_due_date: null, received_date: '2025-05-07', line_items: [{ name: '保守料', amount: 176000 }], maintenance_record: '2025.09.17除草・報告書', escort_record: '2025.07.06除草・報告書', transfer_failed: null, payments: null, status: '入金済' },
  { id: 8, contract_id: 2, year: 2026, billing_scheduled_date: null, billing_date: null, payment_due_date: null, received_date: null, line_items: null, maintenance_record: null, escort_record: null, transfer_failed: null, payments: null, status: '' },
  // 天草8666（contract_id:3, 請求書）
  { id: 9, contract_id: 3, year: 2023, billing_scheduled_date: null, billing_date: '2023-10-06', payment_due_date: null, received_date: '2023-11-01', line_items: [{ name: '保守料', amount: 187000 }], maintenance_record: null, escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 10, contract_id: 3, year: 2024, billing_scheduled_date: null, billing_date: '2024-07-02', payment_due_date: null, received_date: '2024-07-29', line_items: [{ name: '保守料', amount: 187000 }], maintenance_record: null, escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 11, contract_id: 3, year: 2025, billing_scheduled_date: null, billing_date: null, payment_due_date: null, received_date: '2025-06-03', line_items: [{ name: '保守料', amount: 187000 }], maintenance_record: '2025.09.17除草・報告書', escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 12, contract_id: 3, year: 2026, billing_scheduled_date: '2026-11-25', billing_date: null, payment_due_date: null, received_date: null, line_items: null, maintenance_record: null, escort_record: null, transfer_failed: null, payments: null, status: '' },
  // 竹田市梅木水引（contract_id:4, 口座振替）— 2026年は振替不能→請求書対応に切替
  { id: 13, contract_id: 4, year: 2023, billing_scheduled_date: null, billing_date: null, payment_due_date: null, received_date: '2023-12-27', line_items: [{ name: '保守料', amount: 165000 }], maintenance_record: '2023.7.4枯草・報告書', escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 14, contract_id: 4, year: 2024, billing_scheduled_date: null, billing_date: null, payment_due_date: null, received_date: '2024-05-17', line_items: [{ name: '保守料', amount: 165000 }], maintenance_record: '2024.5.17除草・報告書', escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 15, contract_id: 4, year: 2025, billing_scheduled_date: null, billing_date: null, payment_due_date: null, received_date: '2025-05-01', line_items: [{ name: '保守料', amount: 165000 }], maintenance_record: '2025.09.17除草・報告書', escort_record: '2025.07.06除草・報告書', transfer_failed: null, payments: null, status: '入金済' },
  { id: 16, contract_id: 4, year: 2026, billing_scheduled_date: null, billing_date: '2026-03-15', payment_due_date: '2026-04-15', received_date: null, line_items: [{ name: '保守料', amount: 165000 }], maintenance_record: null, escort_record: null, transfer_failed: true, payments: null, status: '請求済' },
  // 三好市奥公（contract_id:6, 請求書）
  { id: 17, contract_id: 6, year: 2022, billing_scheduled_date: null, billing_date: null, payment_due_date: null, received_date: '2022-09-29', line_items: [{ name: '保守料', amount: 165000 }], maintenance_record: null, escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 18, contract_id: 6, year: 2023, billing_scheduled_date: null, billing_date: '2023-06-08', payment_due_date: null, received_date: '2023-06-21', line_items: [{ name: '保守料', amount: 165000 }], maintenance_record: '2023.6.8枯草', escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 19, contract_id: 6, year: 2024, billing_scheduled_date: null, billing_date: '2024-05-07', payment_due_date: null, received_date: '2024-05-30', line_items: [{ name: '保守料', amount: 165000 }], maintenance_record: '2024.5.17除草・報告書', escort_record: '2025.2.8特検', transfer_failed: null, payments: null, status: '入金済' },
  { id: 20, contract_id: 6, year: 2025, billing_scheduled_date: null, billing_date: null, payment_due_date: null, received_date: '2025-05-01', line_items: [{ name: '保守料', amount: 165000 }], maintenance_record: '2025.09.02除草・報告書', escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 21, contract_id: 6, year: 2026, billing_scheduled_date: '2026-06-25', billing_date: '2026-03-09', payment_due_date: null, received_date: null, line_items: [{ name: '保守料', amount: 165000 }], maintenance_record: null, escort_record: null, transfer_failed: null, payments: null, status: '請求済' },
  // 淡路市心谷1（contract_id:7, 請求書）
  { id: 22, contract_id: 7, year: 2023, billing_scheduled_date: null, billing_date: '2023-01-31', payment_due_date: null, received_date: '2023-01-31', line_items: [{ name: '保守料', amount: 165000 }, { name: '土地代', amount: 1000000 }], maintenance_record: null, escort_record: '12/28保守代入金済', transfer_failed: null, payments: null, status: '入金済' },
  { id: 23, contract_id: 7, year: 2024, billing_scheduled_date: null, billing_date: '2024-01-06', payment_due_date: null, received_date: '2024-01-26', line_items: [{ name: '保守料', amount: 165000 }, { name: '土地代', amount: 1000000 }], maintenance_record: '2025.06.20・08.06除草・報告書', escort_record: null, transfer_failed: null, payments: null, status: '入金済' },
  { id: 24, contract_id: 7, year: 2025, billing_scheduled_date: null, billing_date: null, payment_due_date: null, received_date: null, line_items: null, maintenance_record: null, escort_record: null, transfer_failed: null, payments: null, status: '' },
  { id: 25, contract_id: 7, year: 2026, billing_scheduled_date: '2026-12-20', billing_date: null, payment_due_date: null, received_date: null, line_items: null, maintenance_record: null, escort_record: null, transfer_failed: null, payments: null, status: '' },
]

// ── 初期保守対応記録 ───────────────────────────────────────

const initMaintenanceResponses: MaintenanceResponse[] = [
  { id: 1, response_no: '25001', project_id: 6, status: '完了', inquiry_date: '2025-02-21', occurrence_date: '2025-02-21', target_area: '点検', situation: '2/8点検実施', response_content: null, report: '2/21小泉氏へ報告メール', created_at: '2025-02-21' },
  { id: 2, response_no: '25002', project_id: 5, status: '完了', inquiry_date: '2025-02-28', occurrence_date: '2025-02-28', target_area: 'パワコン', situation: 'エントリアのアラートメールから\nPCS2が停止\n森田氏よりメールにて問い合わせあった', response_content: '2/28森田氏へ返信。1日様子見て判断。\n3/1停止のままのため高橋氏へ駆付依頼。\n3/2高橋氏が駆付け、再起動にて復旧。', report: '3/3森田氏へ報告', created_at: '2025-02-28' },
  { id: 3, response_no: '25003', project_id: 1, status: '完了', inquiry_date: '2025-03-01', occurrence_date: '2025-03-01', target_area: '除草', situation: '3/1 清水氏点検時に西側の樹木伐採依頼あり', response_content: '3/1 岸本氏に伐採依頼\n3/21伐採実施', report: '4/3 大本氏へ報告メール', created_at: '2025-03-01' },
  { id: 4, response_no: '25005', project_id: 5, status: '完了', inquiry_date: '2025-03-02', occurrence_date: '2025-03-02', target_area: '除草', situation: '除草実施（1回目）', response_content: null, report: '3/6森田氏へ報告メール', created_at: '2025-03-02' },
  { id: 5, response_no: '25008', project_id: 2, status: '完了', inquiry_date: '2025-03-02', occurrence_date: '2025-03-02', target_area: '点検', situation: '3/2岸本氏が現地上見、目視点検を実施', response_content: null, report: '4/3山川氏へ報告Line', created_at: '2025-03-02' },
  { id: 6, response_no: '25009', project_id: 1, status: '完了', inquiry_date: '2025-03-03', occurrence_date: '2025-03-03', target_area: 'パワコン', situation: '停電などの影響で発電停止', response_content: '九州電力から復旧可能な状況になった昨日の連絡から\n清水氏が駆付け、再起動対応', report: '3/5大本氏に報告メール\n請求書発行', created_at: '2025-03-03' },
  { id: 7, response_no: '25014', project_id: 2, status: '対応中', inquiry_date: '2025-03-21', occurrence_date: '2025-03-25', target_area: '保険', situation: '保険更新案内', response_content: '3/21書類郵送。3/24大本氏へ承認電話。\n森社長出張中。3/27予定のメール返信あり', report: null, created_at: '2025-03-21' },
  { id: 8, response_no: '25018', project_id: 8, status: '完了', inquiry_date: '2025-03-31', occurrence_date: '2025-03-31', target_area: 'パネル', situation: '3/31松尾氏上見からパネル（枠破損）', response_content: 'No.25024へ', report: null, created_at: '2025-03-31' },
  { id: 9, response_no: '25023', project_id: 8, status: '完了', inquiry_date: '2025-04-14', occurrence_date: '2025-04-14', target_area: 'パワコン', situation: '停電などの影響で発電停止（乗電からメールあり）', response_content: '保守会社にて駆付けし復旧。', report: '4/23大本氏に報告\n復旧・配線・パネル・フェンス', created_at: '2025-04-14' },
  { id: 10, response_no: '25029', project_id: 3, status: '完了', inquiry_date: '2025-05-04', occurrence_date: '2025-05-04', target_area: 'パワコン', situation: '停電などの影響で発電停止（乗電からメールあり）', response_content: '保守会社にて駆付けし復旧。', report: '5/8大本氏に報告・見積書提出', created_at: '2025-05-04' },
  { id: 11, response_no: '25034', project_id: 7, status: '完了', inquiry_date: '2025-05-14', occurrence_date: '2025-05-14', target_area: '点検', situation: '5/14架台設置および目視点検を実施', response_content: null, report: '5/15岩壁氏へ報告メール', created_at: '2025-05-14' },
  { id: 12, response_no: '25051', project_id: 8, status: '完了', inquiry_date: '2025-09-01', occurrence_date: '2025-08-15', target_area: 'パワコン', situation: '保守会社から連絡あり。近隣で停電があったか確認あり。\n36台中33台のパワコンが8/15から停止している', response_content: '現地に駆付け復旧。', report: '大本氏に報告・請求書発行済', created_at: '2025-09-01' },
  { id: 13, response_no: '25059', project_id: 1, status: '完了', inquiry_date: '2025-10-14', occurrence_date: '2025-10-14', target_area: 'その他', situation: '10/14アラートメールあり。清水氏が現地確認。\n14番端子箱のT相バールがメアジと接触して瞬停し発電が停止したものと考えられる', response_content: '復旧作業済', report: '10/20大本氏に報告・請求書発行済', created_at: '2025-10-14' },
  { id: 14, response_no: '26001', project_id: 6, status: '完了', inquiry_date: '2026-01-24', occurrence_date: '2026-01-24', target_area: 'パワコン', situation: '1/24・2/2アラートメールあり\nセンサー1の発電量少ない', response_content: '2/3イシハソーラー窓口氏へ駆付依頼\nエラーコード:A22・製造 No.S029111\n12/25に停止', report: '2/6再起動にて復旧・社長にメールで報告済', created_at: '2026-01-24' },
  { id: 15, response_no: '26002', project_id: 4, status: '対応中', inquiry_date: '2026-02-19', occurrence_date: '2026-02-19', target_area: 'パワコン', situation: '2/19アラートメールあり', response_content: '2/19清水電気が現地確認。電線焼け。\n日本エネルギー開発に対応依頼。3/12調査予定', report: '2/20大本氏へメール。2/24駆付費の承諾あり。3/2報告メール済', created_at: '2026-02-19' },
  { id: 16, response_no: '26003', project_id: 1, status: '完了', inquiry_date: '2026-02-10', occurrence_date: '2026-02-10', target_area: '点検', situation: '年次点検実施。清水電気による全パネル・PCS点検', response_content: '異常なし。報告書作成済', report: '2/15大本氏へ報告メール・報告書郵送', created_at: '2026-02-10' },
  { id: 17, response_no: '26004', project_id: 1, status: '完了', inquiry_date: '2026-03-05', occurrence_date: '2026-03-05', target_area: '除草', situation: '春季除草作業', response_content: '西側・南側の除草完了', report: '3/8大本氏へ報告メール', created_at: '2026-03-05' },
  { id: 18, response_no: '26005', project_id: 7, status: '対応中', inquiry_date: '2026-03-15', occurrence_date: '2026-03-15', target_area: 'パネル', situation: 'FusionSolarの発電量グラフで一部ストリングの出力低下を検知', response_content: '3/16九徳へ現地調査依頼。3/20調査予定', report: null, created_at: '2026-03-15' },
]

// ── 初期定期保守記録 ───────────────────────────────────────

const initPeriodicMaintenance: PeriodicMaintenance[] = [
  // 阿久根（project_id:1）— plan: 点検年1回/除草年1回/駆付無制限
  { id: 1, project_id: 1, record_date: '2025-03-01', work_type: '点検', content: '清水氏による年次点検。異常なし。', created_at: '2025-03-01' },
  { id: 2, project_id: 1, record_date: '2025-05-08', work_type: '除草', content: '西側の除草作業実施。報告書送付済。', created_at: '2025-05-08' },
  { id: 3, project_id: 1, record_date: '2025-10-14', work_type: '巡回', content: 'アラート対応。端子箱の不具合確認・復旧。', created_at: '2025-10-14' },
  { id: 4, project_id: 1, record_date: '2026-02-10', work_type: '点検', content: '年次点検。全パネル・PCS点検実施。異常なし。', created_at: '2026-02-10' },
  { id: 5, project_id: 1, record_date: '2026-03-05', work_type: '除草', content: '春季除草。西側・南側完了。', created_at: '2026-03-05' },
  // 幡ヶ岳（project_id:2）— plan: 点検年1回/除草年1回/駆付年1回
  { id: 6, project_id: 2, record_date: '2025-03-02', work_type: '点検', content: '岸本氏が現地上見、目視点検を実施。', created_at: '2025-03-02' },
  { id: 7, project_id: 2, record_date: '2025-09-17', work_type: '除草', content: '除草作業実施。報告書送付済。', created_at: '2025-09-17' },
  // 天草8666（project_id:3）— plan: 点検年1回/除草年1回/駆付なし
  { id: 8, project_id: 3, record_date: '2025-06-10', work_type: '点検', content: 'TOP社による年次点検実施。', created_at: '2025-06-10' },
  { id: 9, project_id: 3, record_date: '2025-09-17', work_type: '除草', content: '除草実施。報告書送付。', created_at: '2025-09-17' },
  // 枌木第一（project_id:5）— plan: 点検年1回/除草年1回/駆付年1回
  { id: 10, project_id: 5, record_date: '2025-03-02', work_type: '除草', content: '除草実施（1回目）', created_at: '2025-03-02' },
  { id: 11, project_id: 5, record_date: '2025-09-17', work_type: '点検', content: '点検・除草同時実施。報告書送付。', created_at: '2025-09-17' },
  // 三好市奥公（project_id:6）— plan: 点検年1回/除草年1回/駆付年1回
  { id: 12, project_id: 6, record_date: '2025-02-08', work_type: '点検', content: '特別点検実施。', created_at: '2025-02-08' },
  { id: 13, project_id: 6, record_date: '2025-03-13', work_type: '除草', content: '除草実施（1回目）', created_at: '2025-03-13' },
  { id: 14, project_id: 6, record_date: '2026-01-24', work_type: '巡回', content: 'パワコン停止対応。駆付復旧。', created_at: '2026-01-24' },
  // 淡路市心谷1（project_id:7）— plan: 点検年1回/除草無制限/駆付年1回
  { id: 15, project_id: 7, record_date: '2025-05-14', work_type: '点検', content: '架台設置および目視点検。岩壁氏へ報告。', created_at: '2025-05-14' },
  { id: 16, project_id: 7, record_date: '2025-06-20', work_type: '除草', content: '除草実施（1回目）。', created_at: '2025-06-20' },
  { id: 17, project_id: 7, record_date: '2025-08-06', work_type: '除草', content: '除草実施（2回目）。', created_at: '2025-08-06' },
  { id: 18, project_id: 7, record_date: '2026-03-15', work_type: 'その他', content: '発電量低下調査。ストリング出力確認中。', created_at: '2026-03-15' },
  // 天草大矢野（project_id:8）— plan: 点検なし/除草年1回/駆付なし
  { id: 19, project_id: 8, record_date: '2025-07-10', work_type: '除草', content: '除草作業実施。', created_at: '2025-07-10' },
]

// ── 初期添付ファイル ───────────────────────────────────────

const initAttachments: Attachment[] = [
  { id: 1, customer_id: 2, file_name: '売買契約書_仲奈夫子.pdf', file_url: '/mock/contract_naka.pdf', file_type: 'pdf', description: '売買契約書', uploaded_at: '2021-12-28' },
  { id: 2, customer_id: 2, file_name: '完了証明書_仲奈夫子.pdf', file_url: '/mock/completion_naka.pdf', file_type: 'pdf', description: '完了証明書', uploaded_at: '2022-05-10' },
  { id: 3, customer_id: 6, file_name: '天草8666_保守契約書.pdf', file_url: '/mock/maintenance_amakusa.pdf', file_type: 'pdf', description: '保守契約書', uploaded_at: '2021-11-25' },
]

// ── ストア本体 ────────────────────────────────────────────

let customers = [...initCustomers]
let projects = [...initProjects]
let contracts = [...initContracts]
let annualRecords = [...initAnnualRecords]
let maintenanceResponses = [...initMaintenanceResponses]
let periodicMaintenance = [...initPeriodicMaintenance]
let attachments = [...initAttachments]

let _nextCustId = 20
let _nextProjId = 20
let _nextContractId = 20
let _nextAnnualId = 50
let _nextMaintRespId = 50
let _nextPeriodicId = 30
let _nextAttachId = 10

// ── Customer Store ─────────────────────────────────────────

export const customerStore = {
  getAll: () => customers.map(c => ({
    ...c,
    project_count: projects.filter(p => p.customer_id === c.id).length,
  })),
  getById: (id: number) => customers.find(c => c.id === id) ?? null,
  findByName: (name: string) => customers.find(c => c.name === name || c.company_name === name) ?? null,
  create: (input: Omit<Customer, 'id' | 'created_at' | 'project_count'>) => {
    const c: Customer = { ...input, id: _nextCustId++, created_at: new Date().toISOString().slice(0, 10) }
    customers = [...customers, c]
    return c
  },
  update: (id: number, input: Partial<Omit<Customer, 'id' | 'created_at'>>) => {
    customers = customers.map(c => c.id === id ? { ...c, ...input } : c)
    return customers.find(c => c.id === id) ?? null
  },
  delete: (id: number) => { customers = customers.filter(c => c.id !== id) },
}

// ── Project Store ──────────────────────────────────────────

export const projectStore = {
  getAll: () => projects,
  getByCustomerId: (customerId: number) => projects.filter(p => p.customer_id === customerId),
  getById: (id: number) => projects.find(p => p.id === id) ?? null,
  create: (input: Omit<Project, 'id' | 'created_at'>) => {
    const p: Project = { ...input, id: _nextProjId++, created_at: new Date().toISOString().slice(0, 10) }
    projects = [...projects, p]
    return p
  },
  update: (id: number, input: Partial<Omit<Project, 'id' | 'created_at'>>) => {
    projects = projects.map(p => p.id === id ? { ...p, ...input } : p)
    return projects.find(p => p.id === id) ?? null
  },
  delete: (id: number) => { projects = projects.filter(p => p.id !== id) },
}

// ── Contract Store ────────────────────────────────────────

export const contractStore = {
  getAll: () => contracts,
  getByProjectId: (projectId: number) => contracts.find(c => c.project_id === projectId) ?? null,
  create: (input: Omit<Contract, 'id' | 'created_at'>) => {
    const c: Contract = { ...input, id: _nextContractId++, created_at: new Date().toISOString().slice(0, 10) }
    contracts = [...contracts, c]
    return c
  },
  update: (id: number, input: Partial<Omit<Contract, 'id' | 'created_at'>>) => {
    contracts = contracts.map(c => c.id === id ? { ...c, ...input } : c)
    return contracts.find(c => c.id === id) ?? null
  },
}

// ── Annual Record Store ───────────────────────────────────

export const annualRecordStore = {
  getAll: () => annualRecords,
  getByContractId: (contractId: number) => annualRecords.filter(r => r.contract_id === contractId),
  create: (input: Omit<AnnualRecord, 'id'>) => {
    const r: AnnualRecord = { ...input, id: _nextAnnualId++ }
    annualRecords = [...annualRecords, r]
    return r
  },
  update: (id: number, input: Partial<Omit<AnnualRecord, 'id'>>) => {
    annualRecords = annualRecords.map(r => r.id === id ? { ...r, ...input } : r)
    return annualRecords.find(r => r.id === id) ?? null
  },
  delete: (id: number) => { annualRecords = annualRecords.filter(r => r.id !== id) },
}

// ── Maintenance Response Store ────────────────────────────

export const maintenanceResponseStore = {
  getAll: () => maintenanceResponses.map(m => {
    const proj = projects.find(p => p.id === m.project_id)
    const cust = proj ? customers.find(c => c.id === proj.customer_id) : null
    return {
      ...m,
      project_name: proj?.project_name ?? '不明',
      customer_name: cust?.company_name ?? cust?.name ?? '不明',
    }
  }),
  getByProjectId: (projectId: number) => maintenanceResponses.filter(m => m.project_id === projectId).map(m => {
    const proj = projects.find(p => p.id === m.project_id)
    const cust = proj ? customers.find(c => c.id === proj.customer_id) : null
    return { ...m, project_name: proj?.project_name ?? '不明', customer_name: cust?.company_name ?? cust?.name ?? '不明' }
  }),
  getById: (id: number) => {
    const m = maintenanceResponses.find(m => m.id === id)
    if (!m) return null
    const proj = projects.find(p => p.id === m.project_id)
    const cust = proj ? customers.find(c => c.id === proj.customer_id) : null
    return { ...m, project_name: proj?.project_name ?? '不明', customer_name: cust?.company_name ?? cust?.name ?? '不明' }
  },
  create: (input: Omit<MaintenanceResponse, 'id' | 'created_at' | 'project_name' | 'customer_name'>) => {
    const m: MaintenanceResponse = { ...input, id: _nextMaintRespId++, status: '対応中', created_at: new Date().toISOString().slice(0, 10) }
    maintenanceResponses = [...maintenanceResponses, m]
    return m
  },
  update: (id: number, input: Partial<Omit<MaintenanceResponse, 'id' | 'created_at' | 'project_name' | 'customer_name'>>) => {
    maintenanceResponses = maintenanceResponses.map(m => m.id === id ? { ...m, ...input } : m)
    return maintenanceResponses.find(m => m.id === id) ?? null
  },
  delete: (id: number) => { maintenanceResponses = maintenanceResponses.filter(m => m.id !== id) },
}

// ── Periodic Maintenance Store ────────────────────────────

export const periodicMaintenanceStore = {
  getAll: () => periodicMaintenance,
  getByProjectId: (projectId: number) => periodicMaintenance.filter(m => m.project_id === projectId),
  create: (input: Omit<PeriodicMaintenance, 'id' | 'created_at'>) => {
    const m: PeriodicMaintenance = { ...input, id: _nextPeriodicId++, created_at: new Date().toISOString().slice(0, 10) }
    periodicMaintenance = [...periodicMaintenance, m]
    return m
  },
  delete: (id: number) => { periodicMaintenance = periodicMaintenance.filter(m => m.id !== id) },
}

// ── Attachment Store ──────────────────────────────────────

export const attachmentStore = {
  getByCustomerId: (customerId: number) => attachments.filter(a => a.customer_id === customerId),
  create: (input: Omit<Attachment, 'id' | 'uploaded_at'>) => {
    const a: Attachment = { ...input, id: _nextAttachId++, uploaded_at: new Date().toISOString().slice(0, 10) }
    attachments = [...attachments, a]
    return a
  },
  delete: (id: number) => { attachments = attachments.filter(a => a.id !== id) },
}

// ── Prospect Store ────────────────────────────────────────

let _nextProspectId = 1

const initProspects: Prospect[] = [
  {
    id: _nextProspectId++,
    customer_name: '米澤 翔平', customer_name_kana: null, project_name: '伊佐③', loan_company: 'ジャックス',
    equipment: 22400000, land_cost: 1400000, loan_amount: 23800000,
    apply_status: '未', contract_status: '未',
    apply_tasks: {}, contract_tasks: {}, apply_sub_tasks: {}, contract_sub_tasks: {},
    apply_memo: null, contract_memo: null,
    site_address: null, panel_kw: null, referrer: null,
    lead_date: null, apply_submit_date: null, apply_result_date: null,
    sale_contract_date: null, land_contract_date: null, handover_date: null,
    converted_customer_id: null, converted_at: null, created_at: '2026-03-01',
  },
  {
    id: _nextProspectId++,
    customer_name: '小林 恵理子', customer_name_kana: null, project_name: '伊佐②', loan_company: 'ジャックス',
    equipment: 21100000, land_cost: 1400000, loan_amount: 22500000,
    apply_status: '提出済', contract_status: '未',
    apply_tasks: {}, contract_tasks: {}, apply_sub_tasks: {}, contract_sub_tasks: {},
    apply_memo: null, contract_memo: null,
    site_address: null, panel_kw: null, referrer: null,
    lead_date: null, apply_submit_date: '2026-02-15', apply_result_date: null,
    sale_contract_date: null, land_contract_date: null, handover_date: null,
    converted_customer_id: null, converted_at: null, created_at: '2026-02-10',
  },
  {
    id: _nextProspectId++,
    customer_name: '赤坂 恭夫', customer_name_kana: null, project_name: '鹿嶋市武井', loan_company: 'ジャックス',
    equipment: 17100000, land_cost: 1000000, loan_amount: 18100000,
    apply_status: '通過', contract_status: '未',
    apply_tasks: {}, contract_tasks: {}, apply_sub_tasks: {}, contract_sub_tasks: {},
    apply_memo: null, contract_memo: null,
    site_address: '茨城県鹿嶋市武井', panel_kw: 45.9, referrer: null,
    lead_date: '2026-01-10', apply_submit_date: '2026-01-20', apply_result_date: '2026-02-01',
    sale_contract_date: null, land_contract_date: null, handover_date: null,
    converted_customer_id: null, converted_at: null, created_at: '2026-01-10',
  },
]

let prospects: Prospect[] = [...initProspects]

export const prospectStore = {
  getAll: () => [...prospects].sort((a, b) => b.id - a.id),
  getById: (id: number) => prospects.find(p => p.id === id) ?? null,
  create: (input: Omit<Prospect, 'id' | 'created_at'>) => {
    const p: Prospect = { ...input, id: _nextProspectId++, created_at: new Date().toISOString().slice(0, 10) }
    prospects = [...prospects, p]
    return p
  },
  update: (id: number, input: Partial<Omit<Prospect, 'id' | 'created_at'>>) => {
    prospects = prospects.map(p => p.id === id ? { ...p, ...input } : p)
    return prospects.find(p => p.id === id) ?? null
  },
  delete: (id: number) => { prospects = prospects.filter(p => p.id !== id) },
}
