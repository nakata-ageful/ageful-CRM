import { useCallback, useEffect, useState } from 'react'
import { ToastProvider } from './components/Toast'
import { ErrorBoundary } from './components/ErrorBoundary'
import { hasSupabaseEnv,billingRuntimePreview } from './lib/supabase'
import {
  getDashboard, getCustomers, getProjects, getProjectDetail,
  getCustomerDetail, getMaintenanceResponses, getMaintenanceResponseById,
  getBillingRows, getProspects, getProspectById,
  getProjectIdByCustomerId, getPeriodicMaintenance,
} from './lib/data'
import type {
  DashboardStats, Customer, ProjectRow, ProjectDetail,
  CustomerDetailData, MaintenanceResponse, BillingRow, Prospect,
  PeriodicMaintenance,
} from './types'

import { Dashboard } from './views/Dashboard'
import { Projects } from './views/Projects'
import { ProjectDetailView } from './views/ProjectDetail'
import { Customers } from './views/Customers'
import { CustomerDetailView } from './views/CustomerDetail'
import { MaintenanceResponses } from './views/MaintenanceResponses'
import { MaintenanceResponseDetail } from './views/MaintenanceResponseDetail'
import { Billing } from './views/Billing'
import { CsvImport } from './views/CsvImport'
import { Prospects } from './views/Prospects'
import { ProspectDetailView } from './views/ProspectDetail'
import {BillingAccessGate} from './components/BillingAccessGate'
import {OwnershipTransferEditor} from './components/OwnershipTransferEditor'
import {billingRuntimeEnabled,loadBillingRuntime,saveBillingRuntime,hasPendingBillingRuntime,type BillingRuntimeSnapshot} from './lib/billing-runtime'
import type {BillingHistoryData} from './components/BillingHistorySection'
import {Modal} from './components/Modal'
import {OwnershipTransferHistory} from './components/OwnershipTransferHistory'
import {ManagementLifecycleEditor} from './components/ManagementLifecycleEditor'
import {FutureScheduleEditor} from './components/FutureScheduleEditor'

type ViewKey =
  | 'dashboard'
  | 'projects' | 'project-detail'
  | 'customers' | 'customer-detail'
  | 'maintenance-responses' | 'maintenance-response-detail'
  | 'billing'
  | 'import'
  | 'prospects' | 'prospect-detail'

const NAV: { key: ViewKey; label: string }[] = [
  { key: 'dashboard',             label: 'ダッシュボード' },
  { key: 'prospects',             label: '見込み管理' },
  { key: 'projects',              label: '発電所' },
  { key: 'customers',             label: '顧客' },
  { key: 'maintenance-responses', label: '保守対応' },
  { key: 'billing',               label: '請求' },
  { key: 'import',                label: 'データのエクスポート' },
]

const DETAIL_VIEWS: ViewKey[] = ['project-detail', 'customer-detail', 'maintenance-response-detail', 'prospect-detail']

const ALL_VIEWS: ViewKey[] = [
  'dashboard', 'projects', 'project-detail', 'customers', 'customer-detail',
  'maintenance-responses', 'maintenance-response-detail', 'billing',
  'import', 'prospects', 'prospect-detail',
]

function parseHash(): { view: ViewKey; detailId: number | null } {
  const h = window.location.hash.replace('#', '')
  // クエリ部 (?tab=...) を切り離してから view/id を分割する
  const [pathPart] = h.split('?')
  const [viewPart, idPart] = pathPart.split('/')
  const view = ALL_VIEWS.includes(viewPart as ViewKey) ? (viewPart as ViewKey) : 'dashboard'
  const detailId = idPart ? Number(idPart) : null
  return { view, detailId: detailId && !isNaN(detailId) ? detailId : null }
}

function pushHash(view: ViewKey, detailId?: number) {
  const hash = detailId ? `#${view}/${detailId}` : `#${view}`
  if (window.location.hash !== hash) {
    window.history.pushState(null, '', hash)
  }
}

function navActive(navKey: ViewKey, currentView: ViewKey): boolean {
  if (navKey === currentView) return true
  if (navKey === 'projects' && currentView === 'project-detail') return true
  if (navKey === 'customers' && currentView === 'customer-detail') return true
  if (navKey === 'maintenance-responses' && currentView === 'maintenance-response-detail') return true
  if (navKey === 'prospects' && currentView === 'prospect-detail') return true
  return false
}

export default function App() {
  return billingRuntimeEnabled&&!billingRuntimePreview?<BillingAccessGate><MainApp/></BillingAccessGate>:<MainApp/>
}
function MainApp() {
  const initial = parseHash()
  const [view, setViewRaw] = useState<ViewKey>(initial.view)
  const [pendingDetailId, setPendingDetailId] = useState<number | null>(initial.detailId)
  const [loading, setLoading] = useState(true)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [error, setError] = useState('')
  const [runtime,setRuntime]=useState<BillingRuntimeSnapshot|null>(null)
  const [transferOpen,setTransferOpen]=useState(false),[pendingBilling,setPendingBilling]=useState(false)
  // List data
  const [stats, setStats] = useState<DashboardStats>({ totalCustomers: 0, totalProjects: 0, activeMaintenanceCount: 0, pendingBillingCount: 0 })
  const [customers, setCustomers] = useState<Customer[]>([])
  const [projectRows, setProjectRows] = useState<ProjectRow[]>([])
  const [maintenanceList, setMaintenanceList] = useState<MaintenanceResponse[]>([])
  const [periodicMaintenanceList, setPeriodicMaintenanceList] = useState<PeriodicMaintenance[]>([])
  const [billingRows, setBillingRows] = useState<BillingRow[]>([])

  // List data — prospects
  const [prospects, setProspects] = useState<Prospect[]>([])

  // Detail data
  const [projectDetail, setProjectDetail] = useState<ProjectDetail | null>(null)
  const [customerDetail, setCustomerDetail] = useState<CustomerDetailData | null>(null)
  const [maintenanceDetail, setMaintenanceDetail] = useState<MaintenanceResponse | null>(null)
  const [prospectDetail, setProspectDetail] = useState<Prospect | null>(null)

  // Wrap setView to also update the URL hash + reset scroll position
  const setView = useCallback((v: ViewKey, detailId?: number) => {
    setViewRaw(v)
    pushHash(v, detailId)
    // ビュー切替時は常にページ先頭にスクロールする（前画面のスクロール位置を引き継がない）
    window.scrollTo({ top: 0, left: 0 })
    setMobileNavOpen(false)
  }, [])

  // Listen for browser back/forward
  useEffect(() => {
    function onPopState() {
      const { view: v, detailId } = parseHash()
      setViewRaw(v)
      if (detailId && DETAIL_VIEWS.includes(v)) {
        setPendingDetailId(detailId)
      }
      window.scrollTo({ top: 0, left: 0 })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const loadAll = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const ledger=billingRuntimeEnabled?await loadBillingRuntime():null
      const [s, c, p, m, b, pr, pm] = await Promise.all([
        getDashboard(),
        getCustomers(),
        getProjects(),
        getMaintenanceResponses(),
        getBillingRows(),
        getProspects(),
        getPeriodicMaintenance(),
      ])
      setStats(s)
      setCustomers(c)
      setProjectRows(p)
      setMaintenanceList(m)
      setBillingRows(b)
      setProspects(pr)
      setPeriodicMaintenanceList(pm)
      setRuntime(ledger)
      if(billingRuntimeEnabled)setPendingBilling(await hasPendingBillingRuntime())
    } catch (e) {
      if(billingRuntimeEnabled)setRuntime(null)
      setError(billingRuntimeEnabled?'新しい請求データの取得に失敗しました。ログイン・移行確認・切替設定を確認してください。旧方式への自動切替はしません。':'データの取得に失敗しました。')
      console.error(e)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  const billingHistory:BillingHistoryData|undefined=runtime?{
    units:runtime.units,recipients:customers.map(c=>({id:c.id,name:c.name})),plannedAmount:()=>null,
    recipientName:id=>customers.find(c=>c.id===id)?.name??`請求先ID ${id}（名前未取得）`,
    projectName:id=>projectRows.find(p=>p.id===id)?.project_name??`発電所ID ${id}`,
  }:undefined
  async function reloadRuntime(){
    // Propagate errors so the durable journal is retained until all views have fresh data.
    const [ledger,c,p,b]=await Promise.all([loadBillingRuntime(),getCustomers(),getProjects(),getBillingRows()])
    const detail=projectDetail?await getProjectDetail(projectDetail.project.id):null
    const cd=customerDetail?await getCustomerDetail(customerDetail.customer.id):null
    setRuntime(ledger);setCustomers(c);setProjectRows(p);setBillingRows(b)
    if(detail)setProjectDetail(detail);if(cd)setCustomerDetail(cd)
  }
  async function saveRuntime(request:Record<string,unknown>|null){
    try{await saveBillingRuntime(request,reloadRuntime);setPendingBilling(false)}
    catch(e){setPendingBilling(await hasPendingBillingRuntime());throw e}
  }

  useEffect(() => { loadAll() }, [loadAll])

  // Restore detail view after initial load (e.g. page reload with #prospect-detail/123)
  useEffect(() => {
    if (loading || !pendingDetailId) return
    const id = pendingDetailId
    setPendingDetailId(null)
    if (view === 'prospect-detail') navToProspectDetail(id)
    else if (view === 'project-detail') navToProjectDetail(id)
    else if (view === 'customer-detail') navToCustomerDetail(id)
    else if (view === 'maintenance-response-detail') navToMaintenanceDetail(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  async function navToProjectDetail(projectId: number, tab?: string) {
    const detail = await getProjectDetail(projectId)
    if (detail) {
      setProjectDetail(detail)
      setView('project-detail', projectId)
      if (tab) {
        // setView 後に ?tab=... を URL ハッシュへ反映。ProjectDetail 側が readTabFromHash で拾う
        const base = `#project-detail/${projectId}`
        window.history.replaceState(null, '', `${base}?tab=${encodeURIComponent(tab)}`)
      }
    }
  }

  async function navToCustomerDetail(customerId: number) {
    const detail = await getCustomerDetail(customerId)
    if (!detail) return

    // 同一名の顧客レコードを統合（スペース除去で比較）
    const normalize = (s: string) => s.replace(/[\s\u3000]/g, '')
    const key = normalize(detail.customer.name)
    const siblingIds = customers
      .filter(c => c.id !== customerId && normalize(c.name) === key)
      .map(c => c.id)

    if (siblingIds.length > 0) {
      const siblingDetails = await Promise.all(siblingIds.map(id => getCustomerDetail(id)))
      for (const sd of siblingDetails) {
        if (sd) {
          detail.projects.push(...sd.projects)
          detail.attachments.push(...sd.attachments)
        }
      }
      detail.customer = { ...detail.customer, project_count: detail.projects.length }
    }

    setCustomerDetail(detail)
    setView('customer-detail', customerId)
  }

  async function navToMaintenanceDetail(id: number) {
    const detail = await getMaintenanceResponseById(id)
    if (detail) {
      setMaintenanceDetail(detail)
      setView('maintenance-response-detail', id)
    }
  }

  async function navToProspectDetail(id: number) {
    const detail = await getProspectById(id)
    if (detail) {
      setProspectDetail(detail)
      setView('prospect-detail', id)
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

  function handleNavClick(key: ViewKey) {
    setView(key)
    // Clear detail state when navigating to list
    if (!DETAIL_VIEWS.includes(key)) {
      setProjectDetail(null)
      setCustomerDetail(null)
      setMaintenanceDetail(null)
      setProspectDetail(null)
    }
    setMobileNavOpen(false)
  }


  return (
    <ErrorBoundary>
    <ToastProvider>
    <div className="app">
      <button
        className="mobile-nav-toggle"
        aria-label="メニューを開く"
        onClick={() => setMobileNavOpen(o => !o)}
      >
        {mobileNavOpen ? '✕' : '☰'}
      </button>
      {mobileNavOpen && <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} />}

      <aside className={`sidebar ${mobileNavOpen ? 'mobile-open' : ''}`}>
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
        {billingRuntimePreview&&<div className="notice"><strong>新しい請求・所有者変更の確認用モード</strong><br/>本番DBは読み書きしません。表示・導線の確認専用です。</div>}
        {error && <div className="notice notice-error">{error}</div>}

        {billingRuntimeEnabled&&pendingBilling&&<div className="notice"><p>前回の保存結果が未確認です。端末に一時保存した同じ操作で確認します（契約情報等を含み、確認完了後に削除します）。</p><button className="btn" onClick={()=>void saveRuntime(null).catch(e=>setError(e instanceof Error?e.message:String(e)))}>保存結果を再確認</button></div>}
        {loading ? (
          <div className="card loading-card">読み込み中...</div>
        ) : billingRuntimeEnabled&&!runtime ? <div className="card"><p>請求データの安全確認が完了していないため、画面を停止しています。</p><button onClick={()=>void loadAll()}>再確認</button></div> : (
          <>
            {view === 'dashboard' && (
              <Dashboard
                billingHistory={billingHistory}
                projectRecipients={new Map(projectRows.map(p=>[p.id,p.customer_id]))}
                stats={stats}
                maintenanceList={maintenanceList}
                billingRows={billingRows}
                onNavigate={v => handleNavClick(v as ViewKey)}
                onViewMaintenance={navToMaintenanceDetail}
                onViewBilling={(id) => navToProjectDetail(id, '請求詳細')}
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
                managementEvents={runtime?.managementEvents.filter(e=>e.project_id===projectDetail.project.id)}
                billingHistory={billingHistory}
                onSaveInvoice={billingHistory?request=>saveRuntime({action:'invoice',value:request}):undefined}
                onOwnershipTransfer={billingHistory?()=>setTransferOpen(true):undefined}
                billingUnits={runtime?.units.filter(u=>u.projectId===projectDetail.project.id)}
                onAddDebit={runtime&&projectDetail.contract?async input=>{await saveRuntime({action:'debit_add',value:{...input,projectId:projectDetail.project.id,contractId:projectDetail.contract!.id}})}:undefined}
                onSaveBillingPlan={runtime?async(choices,reason)=>{await saveRuntime({action:'plan',value:{projectId:projectDetail.project.id,choices,reason}})}:undefined}
                detail={projectDetail}
                onBack={() => {
                  // ブラウザ履歴を1つ戻す。popstate ハンドラで view が直前の画面に復元される。
                  // 履歴が無い場合（直接URL等）は発電所一覧へのフォールバック。
                  if (window.history.length > 1) {
                    window.history.back()
                  } else {
                    setView('projects')
                    loadAll(true)
                  }
                }}
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
                billingHistory={billingHistory}
                detail={customerDetail}
                onBack={() => { setView('customers'); loadAll(true) }}
                onReload={reloadCustomerDetail}
                onViewProject={navToProjectDetail}
              />
            )}
            {view === 'maintenance-responses' && (
              <MaintenanceResponses
                responses={maintenanceList}
                periodic={periodicMaintenanceList}
                billingRows={billingRows}
                onReload={loadAll}
                onViewDetail={navToMaintenanceDetail}
                onViewProject={(id) => navToProjectDetail(id, '保守対応')}
                onViewProjectMaintenance={(id) => navToProjectDetail(id, '保守情報')}
              />
            )}
            {view === 'maintenance-response-detail' && maintenanceDetail && (
              <MaintenanceResponseDetail
                response={maintenanceDetail}
                onBack={() => {
                  // ブラウザ履歴を1つ戻す。popstate ハンドラで view が直前の画面に復元される。
                  // 履歴が無い場合（直接URL等）は保守対応一覧に遷移するフォールバック。
                  if (window.history.length > 1) {
                    window.history.back()
                  } else {
                    setView('maintenance-responses')
                    loadAll(true)
                  }
                }}
                onReload={reloadMaintenanceDetail}
                onViewProject={navToProjectDetail}
                onViewCustomer={navToCustomerDetail}
              />
            )}
            {view === 'billing' && (
              <Billing
                billingHistory={billingHistory}
                projectRecipients={new Map(projectRows.map(p=>[p.id,p.customer_id]))}
                rows={billingRows}
                onReload={loadAll}
                onViewDetail={(id) => navToProjectDetail(id, '請求詳細')}
              />
            )}
            {view === 'import' && (
              <CsvImport onReload={loadAll} />
            )}
            {view === 'prospects' && (
              <Prospects
                prospects={prospects}
                customers={customers}
                onReload={reloadProspects}
                onViewDetail={navToProspectDetail}
                onViewProject={async (customerId) => {
                  const projectId = await getProjectIdByCustomerId(customerId)
                  if (projectId) navToProjectDetail(projectId)
                }}
                onViewCustomer={navToCustomerDetail}
              />
            )}
            {view === 'prospect-detail' && prospectDetail && (
              <ProspectDetailView
                prospect={prospectDetail}
                onBack={() => { setView('prospects'); reloadProspects() }}
                onViewCustomer={navToCustomerDetail}
                onViewProject={async (customerId) => {
                  const projectId = await getProjectIdByCustomerId(customerId)
                  if (projectId) navToProjectDetail(projectId)
                }}
              />
            )}
          </>
        )}
        {view==='project-detail'&&runtime&&projectDetail&&billingHistory&&<OwnershipTransferHistory
          transfers={runtime.transfers.filter(t=>t.project_id===projectDetail.project.id)} events={runtime.events.filter(e=>e.project_id===projectDetail.project.id)} recipientName={billingHistory.recipientName}/>}
        {view==='project-detail'&&runtime&&projectDetail&&<ManagementLifecycleEditor
          key={`${projectDetail.project.id}:${JSON.stringify(runtime.managementEvents)}:${runtime.units.map(u=>`${u.id}:${u.revision}`).join(',')}`}
          projectId={projectDetail.project.id} events={runtime.managementEvents.filter(e=>e.project_id===projectDetail.project.id)} units={runtime.units}
          onSave={async request=>{await saveRuntime({action:'management',value:request})}}/>}
        {view==='project-detail'&&runtime&&projectDetail?.contract&&billingRows.filter(r=>r.project_id===projectDetail.project.id).map(row=><FutureScheduleEditor
          key={`${row.project_id}:${JSON.stringify(runtime)}:${JSON.stringify(projectDetail.contract)}`} row={{...row,contract:projectDetail.contract}} customers={customers} units={runtime.units} events={runtime.managementEvents}
          onPeriodSave={value=>saveRuntime({action:'service_period',value})} onSave={value=>saveRuntime({action:'future_schedule',value})}/>)}
        {transferOpen&&runtime&&projectDetail?.contract&&<Modal title="所有者を変更" width={1100} onClose={()=>setTransferOpen(false)}>
          <OwnershipTransferEditor project={projectDetail.project} contract={projectDetail.contract} customers={customers}
            units={runtime.units.filter(u=>u.projectId===projectDetail.project.id)}
            onSave={async input=>{await saveRuntime({action:'transfer',value:input});setTransferOpen(false)}}/>
        </Modal>}
      </main>
    </div>
    </ToastProvider>
    </ErrorBoundary>
  )
}
