import { useCallback, useEffect, useState } from 'react'
import { ToastProvider } from './components/Toast'
import { ErrorBoundary } from './components/ErrorBoundary'
import { hasSupabaseEnv } from './lib/supabase'
import {
  getDashboard, getCustomers, getProjects, getProjectDetail,
  getCustomerDetail, getMaintenanceResponses, getMaintenanceResponseById,
  getBillingRows, getBillingDetail, getProspects, getProspectById,
} from './lib/data'
import type {
  DashboardStats, Customer, ProjectRow, ProjectDetail,
  CustomerDetailData, MaintenanceResponse, BillingRow, BillingDetail, Prospect,
} from './types'

import { Dashboard } from './views/Dashboard'
import { Projects } from './views/Projects'
import { ProjectDetailView } from './views/ProjectDetail'
import { Customers } from './views/Customers'
import { CustomerDetailView } from './views/CustomerDetail'
import { MaintenanceResponses } from './views/MaintenanceResponses'
import { MaintenanceResponseDetail } from './views/MaintenanceResponseDetail'
import { Billing } from './views/Billing'
import { BillingDetailView } from './views/BillingDetail'
import { CsvImport } from './views/CsvImport'
import { Prospects } from './views/Prospects'
import { ProspectDetailView } from './views/ProspectDetail'

type ViewKey =
  | 'dashboard'
  | 'projects' | 'project-detail'
  | 'customers' | 'customer-detail'
  | 'maintenance-responses' | 'maintenance-response-detail'
  | 'billing' | 'billing-detail'
  | 'import'
  | 'prospects' | 'prospect-detail'

const NAV: { key: ViewKey; label: string; icon: string }[] = [
  { key: 'dashboard',             label: 'ダッシュボード', icon: '◎' },
  { key: 'prospects',             label: '見込み管理',     icon: '📋' },
  { key: 'projects',              label: '案件',           icon: '🏭' },
  { key: 'customers',             label: '顧客',           icon: '👤' },
  { key: 'maintenance-responses', label: '保守対応',       icon: '🔧' },
  { key: 'billing',               label: '請求',           icon: '📄' },
  { key: 'import',                label: 'CSVインポート',  icon: '📥' },
]

const DETAIL_VIEWS: ViewKey[] = ['project-detail', 'customer-detail', 'maintenance-response-detail', 'billing-detail', 'prospect-detail']

function navActive(navKey: ViewKey, currentView: ViewKey): boolean {
  if (navKey === currentView) return true
  if (navKey === 'projects' && currentView === 'project-detail') return true
  if (navKey === 'customers' && currentView === 'customer-detail') return true
  if (navKey === 'maintenance-responses' && currentView === 'maintenance-response-detail') return true
  if (navKey === 'billing' && currentView === 'billing-detail') return true
  if (navKey === 'prospects' && currentView === 'prospect-detail') return true
  return false
}

export default function App() {
  const [view, setView] = useState<ViewKey>('dashboard')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // List data
  const [stats, setStats] = useState<DashboardStats>({ totalCustomers: 0, totalProjects: 0, activeMaintenanceCount: 0, pendingBillingCount: 0 })
  const [customers, setCustomers] = useState<Customer[]>([])
  const [projectRows, setProjectRows] = useState<ProjectRow[]>([])
  const [maintenanceList, setMaintenanceList] = useState<MaintenanceResponse[]>([])
  const [billingRows, setBillingRows] = useState<BillingRow[]>([])

  // List data — prospects
  const [prospects, setProspects] = useState<Prospect[]>([])

  // Detail data
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null)
  const [customerDetail, setCustomerDetail] = useState<CustomerDetailData | null>(null)
  const [maintenanceDetail, setMaintenanceDetail] = useState<MaintenanceResponse | null>(null)
  const [billingDetail, setBillingDetail] = useState<BillingDetail | null>(null)
  const [prospectDetail, setProspectDetail] = useState<Prospect | null>(null)

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const [s, c, p, m, b, pr] = await Promise.all([
        getDashboard(),
        getCustomers(),
        getProjects(),
        getMaintenanceResponses(),
        getBillingRows(),
        getProspects(),
      ])
      setStats(s)
      setCustomers(c)
      setProjectRows(p)
      setMaintenanceList(m)
      setBillingRows(b)
      setProspects(pr)
    } catch (e) {
      setError('データの取得に失敗しました。')
      console.error(e)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  async function navToProjectDetail(projectId: number) {
    const detail = await getProjectDetail(projectId)
    if (detail) {
      setProjectDetail(detail)
      setView('project-detail')
    }
  }

  async function navToCustomerDetail(customerId: number) {
    const detail = await getCustomerDetail(customerId)
    if (detail) {
      setCustomerDetail(detail)
      setView('customer-detail')
    }
  }

  async function navToMaintenanceDetail(id: number) {
    const detail = await getMaintenanceResponseById(id)
    if (detail) {
      setMaintenanceDetail(detail)
      setView('maintenance-response-detail')
    }
  }

  async function navToBillingDetail(projectId: number) {
    const detail = await getBillingDetail(projectId)
    if (detail) {
      setBillingDetail(detail)
      setView('billing-detail')
    }
  }

  async function navToProspectDetail(id: number) {
    const detail = await getProspectById(id)
    if (detail) {
      setProspectDetail(detail)
      setView('prospect-detail')
    }
  }

  async function reloadProspects() {
    const pr = await getProspects()
    setProspects(pr)
  }

  async function reloadProjectDetail() {
    if (!projectDetail) return
    const detail = await getProjectDetail(projectDetail.project.id)
    setProjectDetail(detail)
    loadAll(true)
  }

  async function reloadCustomerDetail() {
    if (!customerDetail) return
    const detail = await getCustomerDetail(customerDetail.customer.id)
    setCustomerDetail(detail)
    loadAll(true)
  }

  async function reloadMaintenanceDetail() {
    if (!maintenanceDetail) return
    const detail = await getMaintenanceResponseById(maintenanceDetail.id)
    setMaintenanceDetail(detail)
    loadAll(true)
  }

  async function reloadBillingDetail() {
    if (!billingDetail) return
    const detail = await getBillingDetail(billingDetail.project.id)
    setBillingDetail(detail)
    loadAll(true)
  }

  function handleNavClick(key: ViewKey) {
    setView(key)
    // Clear detail state when navigating to list
    if (!DETAIL_VIEWS.includes(key)) {
      setProjectDetail(null)
      setCustomerDetail(null)
      setMaintenanceDetail(null)
      setBillingDetail(null)
      setProspectDetail(null)
    }
  }

  const viewTitle: Record<ViewKey, string> = {
    dashboard: 'ダッシュボード',
    prospects: '見込み管理',
    'prospect-detail': prospectDetail ? `${prospectDetail.customer_name} / ${prospectDetail.project_name}` : '見込み詳細',
    projects: '案件一覧',
    'project-detail': projectDetail?.project.project_name ?? '案件詳細',
    customers: '顧客一覧',
    'customer-detail': customerDetail?.customer.company_name ?? customerDetail?.customer.name ?? '顧客詳細',
    'maintenance-responses': '保守対応一覧',
    'maintenance-response-detail': maintenanceDetail?.project_name ?? '保守対応詳細',
    billing: '請求一覧',
    'billing-detail': billingDetail?.project.project_name ?? '請求詳細',
    import: 'CSVインポート',
  }

  return (
    <ErrorBoundary>
    <ToastProvider>
    <div className="app">
      <aside className="sidebar">
        <div className="logo-block">
          <img src="/logo.png" alt="Ageful" className="logo-img" />
          <div className="logo-divider" />
          <div className="logo-sub">太陽光発電 管理システム</div>
        </div>
        {NAV.map(n => (
          <button
            key={n.key}
            className={`nav-btn ${navActive(n.key, view) ? 'active' : ''}`}
            onClick={() => handleNavClick(n.key)}
          >
            <span className="nav-icon">{n.icon}</span>
            {n.label}
          </button>
        ))}
      </aside>

      <main className="main">
        {!hasSupabaseEnv && (
          <div className="notice">
            モックデータで表示中 — Supabase に接続するには <code>.env</code> を作成してください
          </div>
        )}
        {error && <div className="notice notice-error">{error}</div>}

        <div className="page-header">
          <h1 className="page-title">{viewTitle[view]}</h1>
        </div>

        {loading ? (
          <div className="card loading-card">読み込み中...</div>
        ) : (
          <>
            {view === 'dashboard' && (
              <Dashboard
                stats={stats}
                maintenanceList={maintenanceList}
                billingRows={billingRows}
                onNavigate={v => handleNavClick(v as ViewKey)}
                onViewMaintenance={navToMaintenanceDetail}
                onViewBilling={navToBillingDetail}
              />
            )}
            {view === 'projects' && (
              <Projects
                projects={projectRows}
                customers={customers}
                onReload={loadAll}
                onViewDetail={navToProjectDetail}
              />
            )}
            {view === 'project-detail' && projectDetail && (
              <ProjectDetailView
                detail={projectDetail}
                onBack={() => setView('projects')}
                onReload={reloadProjectDetail}
                onViewCustomer={navToCustomerDetail}
                onViewMaintenance={navToMaintenanceDetail}
              />
            )}
            {view === 'customers' && (
              <Customers
                customers={customers}
                onReload={loadAll}
                onViewDetail={navToCustomerDetail}
              />
            )}
            {view === 'customer-detail' && customerDetail && (
              <CustomerDetailView
                detail={customerDetail}
                onBack={() => setView('customers')}
                onReload={reloadCustomerDetail}
                onViewProject={navToProjectDetail}
              />
            )}
            {view === 'maintenance-responses' && (
              <MaintenanceResponses
                responses={maintenanceList}
                onReload={loadAll}
                onViewDetail={navToMaintenanceDetail}
              />
            )}
            {view === 'maintenance-response-detail' && maintenanceDetail && (
              <MaintenanceResponseDetail
                response={maintenanceDetail}
                onBack={() => setView('maintenance-responses')}
                onReload={reloadMaintenanceDetail}
                onViewProject={navToProjectDetail}
              />
            )}
            {view === 'billing' && (
              <Billing
                rows={billingRows}
                onReload={loadAll}
                onViewDetail={navToBillingDetail}
              />
            )}
            {view === 'billing-detail' && billingDetail && (
              <BillingDetailView
                detail={billingDetail}
                onBack={() => setView('billing')}
                onReload={reloadBillingDetail}
                onViewProject={navToProjectDetail}
              />
            )}
            {view === 'import' && (
              <CsvImport onReload={loadAll} />
            )}
            {view === 'prospects' && (
              <Prospects
                prospects={prospects}
                onReload={reloadProspects}
                onViewDetail={navToProspectDetail}
              />
            )}
            {view === 'prospect-detail' && prospectDetail && (
              <ProspectDetailView
                prospect={prospectDetail}
                onBack={() => setView('prospects')}
                onViewCustomer={navToCustomerDetail}
              />
            )}
          </>
        )}
      </main>
    </div>
    </ToastProvider>
    </ErrorBoundary>
  )
}
