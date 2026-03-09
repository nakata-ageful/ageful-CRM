import { useCallback, useEffect, useState } from 'react'
import { hasSupabaseEnv } from './lib/supabase'
import { getDashboard, getCustomers, getMaintenance, getBillingRows, getCustomerDetail, getProjects } from './lib/data'
import type { DashboardStats, Customer, MaintenanceLog, BillingRow, CustomerDetail, ProjectRow } from './types'

import { Dashboard } from './views/Dashboard'
import { Projects } from './views/Projects'
import { Customers } from './views/Customers'
import { CustomerDetail as CustomerDetailView } from './views/CustomerDetail'
import { Maintenance } from './views/Maintenance'
import { Billing } from './views/Billing'
import { CsvImport } from './views/CsvImport'

type ViewKey = 'dashboard' | 'projects' | 'customers' | 'customer-detail' | 'maintenance' | 'billing' | 'import'

const NAV: { key: ViewKey; label: string; icon: string }[] = [
  { key: 'dashboard',  label: 'ダッシュボード', icon: '◎' },
  { key: 'projects',   label: '案件一覧',       icon: '🏭' },
  { key: 'customers',  label: '顧客管理',       icon: '👤' },
  { key: 'maintenance',label: '保守記録',       icon: '🔧' },
  { key: 'billing',    label: '契約・請求',     icon: '📄' },
  { key: 'import',     label: 'CSVインポート',  icon: '📥' },
]

export default function App() {
  const [view, setView] = useState<ViewKey>('dashboard')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [stats, setStats] = useState<DashboardStats>({ totalCustomers: 0, totalProjects: 0, pendingMaintenanceCount: 0, unbilledInvoiceCount: 0 })
  const [recentMaintenance, setRecentMaintenance] = useState<MaintenanceLog[]>([])
  const [projectRows, setProjectRows] = useState<ProjectRow[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [maintenance, setMaintenance] = useState<MaintenanceLog[]>([])
  const [billing, setBilling] = useState<BillingRow[]>([])
  const [customerDetail, setCustomerDetail] = useState<CustomerDetail | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, m, c, b, p] = await Promise.all([
        getDashboard(),
        getMaintenance(),
        getCustomers(),
        getBillingRows(),
        getProjects(),
      ])
      setStats(s)
      setMaintenance(m)
      setRecentMaintenance(m.slice(0, 6))
      setCustomers(c)
      setBilling(b)
      setProjectRows(p)
    } catch (e) {
      setError('データの取得に失敗しました。Supabase の接続設定を確認してください。')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  async function handleViewDetail(customerId: number) {
    const detail = await getCustomerDetail(customerId)
    setCustomerDetail(detail)
    setView('customer-detail')
  }

  async function handleReloadDetail(customerId: number) {
    const detail = await getCustomerDetail(customerId)
    setCustomerDetail(detail)
    // グローバルデータも更新
    loadAll()
  }

  const viewTitle: Record<ViewKey, string> = {
    dashboard: 'ダッシュボード',
    projects: '案件一覧',
    customers: '顧客管理',
    'customer-detail': customerDetail?.customer.contact_name ?? '顧客詳細',
    maintenance: '保守記録',
    billing: '契約・請求',
    import: 'CSVインポート',
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="logo-block">
          <div className="logo-text">Ageful</div>
          <div className="logo-sub">太陽光 顧客管理</div>
        </div>
        {NAV.map(n => (
          <button
            key={n.key}
            className={`nav-btn ${view === n.key || (n.key === 'customers' && view === 'customer-detail') ? 'active' : ''}`}
            onClick={() => { setView(n.key); if (n.key !== 'customers') setCustomerDetail(null) }}
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
          <div>
            <h1 className="page-title">{viewTitle[view]}</h1>
          </div>
        </div>

        {loading ? (
          <div className="card loading-card">読み込み中...</div>
        ) : (
          <>
            {view === 'dashboard' && (
              <Dashboard stats={stats} recentMaintenance={recentMaintenance} billing={billing} onNavigate={v => setView(v as ViewKey)} />
            )}
            {view === 'projects' && (
              <Projects projects={projectRows} customers={customers} onReload={loadAll} onViewDetail={handleViewDetail} />
            )}
            {(view === 'customers') && (
              <Customers customers={customers} onReload={loadAll} onViewDetail={handleViewDetail} />
            )}
            {view === 'customer-detail' && customerDetail && (
              <CustomerDetailView detail={customerDetail} onBack={() => setView('customers')} onReload={handleReloadDetail} />
            )}
            {view === 'maintenance' && (
              <Maintenance logs={maintenance} onReload={loadAll} />
            )}
            {view === 'billing' && (
              <Billing rows={billing} onReload={loadAll} />
            )}
            {view === 'import' && (
              <CsvImport onReload={loadAll} />
            )}
          </>
        )}
      </main>
    </div>
  )
}
