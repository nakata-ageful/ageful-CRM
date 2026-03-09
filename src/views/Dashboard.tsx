import type { DashboardStats, MaintenanceLog, BillingRow } from '../types'
import { StatusBadge } from '../components/StatusBadge'

type Props = {
  stats: DashboardStats
  recentMaintenance: MaintenanceLog[]
  billing: BillingRow[]
  onNavigate: (view: string) => void
}

export function Dashboard({ stats, recentMaintenance, billing, onNavigate }: Props) {
  const today = new Date().toISOString().slice(0, 10)

  const unbilledRows = billing.filter(r => r.invoice.status === 'unbilled')
  const billedRows   = billing.filter(r => r.invoice.status === 'billed')

  const unbilledTotal = unbilledRows.reduce((s, r) => s + (r.invoice.amount ?? 0), 0)
  const billedTotal   = billedRows.reduce((s, r) => s + (r.invoice.amount ?? 0), 0)

  // 支払期日が過ぎているのに未入金（billed）の件数
  const overdueCount = billedRows.filter(r => (r.invoice.payment_due_date ?? '') < today).length

  // ダッシュボードに表示する「アクション待ち」請求（未請求 + 請求済み未入金、期日昇順）
  const actionRows = billing
    .filter(r => r.invoice.status === 'unbilled' || r.invoice.status === 'billed')
    .sort((a, b) => (a.invoice.payment_due_date ?? '9999').localeCompare(b.invoice.payment_due_date ?? '9999'))
    .slice(0, 6)

  return (
    <>
      {/* ── メインKPI ── */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">顧客数</div>
          <div className="kpi-value">{stats.totalCustomers}</div>
          <button className="kpi-link" onClick={() => onNavigate('customers')}>一覧を見る →</button>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">案件数</div>
          <div className="kpi-value">{stats.totalProjects}</div>
          <button className="kpi-link" onClick={() => onNavigate('projects')}>一覧を見る →</button>
        </div>
        <div className="kpi-card kpi-card--warn">
          <div className="kpi-label">未対応メンテ</div>
          <div className="kpi-value warn">{stats.pendingMaintenanceCount}</div>
          <button className="kpi-link" onClick={() => onNavigate('maintenance')}>確認する →</button>
        </div>
        <div className="kpi-card kpi-card--ok">
          <div className="kpi-label">未請求件数</div>
          <div className="kpi-value ok">{stats.unbilledInvoiceCount}</div>
          <button className="kpi-link" onClick={() => onNavigate('billing')}>確認する →</button>
        </div>
      </div>

      {/* ── 請求KPI ── */}
      <div className="kpi-grid kpi-grid--sm">
        <div className="kpi-card kpi-card--warn">
          <div className="kpi-label">未請求合計金額</div>
          <div className="kpi-value warn" style={{ fontSize: 22 }}>¥{unbilledTotal.toLocaleString()}</div>
          <div className="kpi-sub">{unbilledRows.length} 件</div>
        </div>
        <div className="kpi-card" style={billedTotal > 0 ? { borderTop: '3px solid #f59e0b' } : {}}>
          <div className="kpi-label">請求済み 未入金</div>
          <div className="kpi-value" style={{ fontSize: 22, color: billedTotal > 0 ? '#b45309' : undefined }}>
            ¥{billedTotal.toLocaleString()}
          </div>
          <div className="kpi-sub">
            {billedRows.length} 件
            {overdueCount > 0 && (
              <span className="overdue-badge">期限超過 {overdueCount} 件</span>
            )}
          </div>
        </div>
      </div>

      {/* ── 2カラム: 請求アクション待ち + 保守記録 ── */}
      <div className="dash-grid">
        <div className="card">
          <div className="card-header-row">
            <h3 className="section-title" style={{ margin: 0 }}>請求アクション待ち</h3>
            <button className="kpi-link" style={{ fontSize: 12 }} onClick={() => onNavigate('billing')}>すべて見る →</button>
          </div>
          <table>
            <thead>
              <tr><th>案件</th><th>請求期間</th><th>金額</th><th>支払期日</th><th>状態</th></tr>
            </thead>
            <tbody>
              {actionRows.length === 0 && (
                <tr><td colSpan={5} className="empty-cell">アクション待ちの請求はありません</td></tr>
              )}
              {actionRows.map(r => {
                const isOverdue = r.invoice.status === 'billed' && (r.invoice.payment_due_date ?? '') < today
                return (
                  <tr key={r.invoice.id} style={isOverdue ? { background: '#fff7ed' } : {}}>
                    <td>{r.project_name}</td>
                    <td>{r.invoice.billing_period ?? '-'}</td>
                    <td className="amount">¥{(r.invoice.amount ?? 0).toLocaleString()}</td>
                    <td style={isOverdue ? { color: '#dc2626', fontWeight: 700 } : {}}>
                      {r.invoice.payment_due_date ?? '-'}
                    </td>
                    <td><StatusBadge status={r.invoice.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3 className="section-title">最近の保守記録</h3>
          <table>
            <thead>
              <tr><th>案件</th><th>発生日</th><th>作業種別</th><th>状態</th></tr>
            </thead>
            <tbody>
              {recentMaintenance.length === 0 && (
                <tr><td colSpan={4} className="empty-cell">記録がありません</td></tr>
              )}
              {recentMaintenance.slice(0, 6).map(m => (
                <tr key={m.id}>
                  <td>{m.project_name}</td>
                  <td>{m.occurrence_date ?? '-'}</td>
                  <td>{m.work_type ?? '-'}</td>
                  <td><StatusBadge status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
