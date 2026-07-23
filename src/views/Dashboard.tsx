import type { DashboardStats, MaintenanceResponse, BillingRow } from '../types'
import { StatusBadge } from '../components/StatusBadge'
import { fmtYen } from '../lib/utils'
import { computeUnpaidUnits, unpaidUnitAmount, computeUpcomingInvoices } from '../lib/billing'

type Props = {
  stats: DashboardStats
  maintenanceList: MaintenanceResponse[]
  billingRows: BillingRow[]
  onNavigate: (view: string) => void
  onViewMaintenance: (id: number) => void
  onViewBilling: (projectId: number) => void
}


/** "6月25日" → 今年の "2026-06-25" に変換 */
function dueDayToDate(dueDayStr: string | null | undefined): string | null {
  if (!dueDayStr) return null
  const m = dueDayStr.match(/(\d{1,2})月(\d{1,2})日/)
  if (!m) return null
  const year = new Date().getFullYear()
  return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

export function Dashboard({ stats, maintenanceList, billingRows, onNavigate, onViewMaintenance, onViewBilling }: Props) {
  const today = new Date().toISOString().slice(0, 10)
  const currentYear = new Date().getFullYear()
  const activeList = maintenanceList.filter(m => m.status === '対応中')

  // 未入金アラート: 請求タブと同一ロジック（回ごと・今年度＋昨年度）で算出
  const unpaidUnits = computeUnpaidUnits(billingRows, currentYear)
    .sort((a, b) => (a.payment?.billing_date ?? a.record.billing_date ?? '').localeCompare(b.payment?.billing_date ?? b.record.billing_date ?? ''))
  const unpaidTotal = unpaidUnits.reduce((sum, u) => sum + (unpaidUnitAmount(u) ?? 0), 0)

  // 口座振替で振替日を過ぎているが入金確認がない案件（今年度＋昨年度の全記録を対象）
  const transferOverdueRows = billingRows.filter(r => {
    if (r.contract?.billing_method !== '口座振替') return false
    const dueDate = dueDayToDate(r.contract?.billing_due_day)
    if (!dueDate || dueDate > today) return false
    // 対象期間に「入金済み or 振替失敗」の記録があれば処理済みとみなす
    const handled = r.records.some(rec => rec.year >= currentYear - 1 && (rec.received_date || rec.transfer_failed))
    return !handled
  })

  // 請求予定: 請求タブと同じ「今月・来月・再来月の請求予定」を共有ロジックで算出
  const scheduledItems = computeUpcomingInvoices(billingRows)

  return (
    <>
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
          <div className="kpi-label">対応中の保守</div>
          <div className="kpi-value warn">{stats.activeMaintenanceCount}</div>
          <button className="kpi-link" onClick={() => onNavigate('maintenance-responses')}>確認する →</button>
        </div>
        <div className="kpi-card kpi-card--info">
          <div className="kpi-label">未入金アラート</div>
          <div className="kpi-value">{unpaidUnits.length}</div>
          {unpaidTotal > 0 && (
            <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 700, marginBottom: 4 }}>{fmtYen(unpaidTotal)}</div>
          )}
          <button className="kpi-link" onClick={() => onNavigate('billing')}>確認する →</button>
        </div>
        {transferOverdueRows.length > 0 && (
          <div className="kpi-card" style={{ borderColor: '#f59e0b' }}>
            <div className="kpi-label" style={{ color: '#d97706' }}>振替 要確認</div>
            <div className="kpi-value" style={{ color: '#d97706' }}>{transferOverdueRows.length}</div>
            <div style={{ fontSize: 11, color: '#92400e', marginBottom: 4 }}>振替日を過ぎて未入金</div>
            <button className="kpi-link" onClick={() => onNavigate('billing')}>確認する →</button>
          </div>
        )}
      </div>

      <div className="dash-grid">
        {/* 対応中の保守 */}
        <div className="card">
          <div className="card-header-row">
            <h3 className="section-title" style={{ margin: 0 }}>対応中の保守</h3>
            <button className="kpi-link" style={{ fontSize: 12 }} onClick={() => onNavigate('maintenance-responses')}>すべて見る →</button>
          </div>
          <table>
            <thead>
              <tr><th>発電所</th><th>顧客</th><th>問合日</th><th>状況</th><th>状態</th></tr>
            </thead>
            <tbody>
              {activeList.length === 0 && (
                <tr><td colSpan={5} className="empty-cell">対応中の保守はありません</td></tr>
              )}
              {activeList.slice(0, 8).map(m => (
                <tr key={m.id} className="clickable-row" onClick={() => onViewMaintenance(m.id)}>
                  <td><strong>{m.project_name ?? '-'}</strong></td>
                  <td>{m.customer_name ?? '-'}</td>
                  <td>{m.inquiry_date ?? '-'}</td>
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.situation ?? '-'}</td>
                  <td><StatusBadge status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 未入金アラート */}
        <div className="card">
          <div className="card-header-row">
            <h3 className="section-title" style={{ margin: 0 }}>未入金アラート</h3>
            <button className="kpi-link" style={{ fontSize: 12 }} onClick={() => onNavigate('billing')}>すべて見る →</button>
          </div>
          <table>
            <thead>
              <tr><th>案件</th><th>顧客</th><th>請求金額</th><th>入金予定日</th><th>状態</th></tr>
            </thead>
            <tbody>
              {unpaidUnits.length === 0 && (
                <tr><td colSpan={5} className="empty-cell">未入金の請求はありません</td></tr>
              )}
              {unpaidUnits.slice(0, 8).map((u, i) => {
                const rec = u.record
                const amount = unpaidUnitAmount(u)
                const dueDate = u.payment?.billing_date ?? rec.payment_due_date ?? null
                const isOverdue = dueDate ? dueDate <= today : false
                return (
                  <tr key={`${rec.id}:${u.payment?.seq ?? 0}:${i}`} className="clickable-row" onClick={() => onViewBilling(u.row.project_id)}>
                    <td>
                      <strong>{u.row.project_name}</strong>
                      {u.payment && u.totalRounds && (
                        <span style={{ marginLeft: 6, fontSize: 10, background: '#fef3c7', color: '#d97706', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>
                          第{u.payment.seq}回/全{u.totalRounds}回
                        </span>
                      )}
                    </td>
                    <td>{u.row.customer_name}</td>
                    <td className="amount">{fmtYen(amount)}</td>
                    <td style={{ color: isOverdue ? '#dc2626' : '#94a3b8', fontWeight: isOverdue ? 600 : 400 }}>
                      {dueDate ?? '—'}
                      {isOverdue && <span style={{ marginLeft: 4, fontSize: 10, background: '#fee2e2', color: '#dc2626', borderRadius: 99, padding: '1px 5px' }}>超過</span>}
                    </td>
                    <td><StatusBadge status={rec.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* 請求予定 */}
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-header-row">
            <h3 className="section-title" style={{ margin: 0 }}>請求予定</h3>
            <button className="kpi-link" style={{ fontSize: 12 }} onClick={() => onNavigate('billing')}>すべて見る →</button>
          </div>
          <table>
            <thead>
              <tr><th>案件</th><th>顧客</th><th>請求予定日</th><th>請求方法</th><th style={{ textAlign: 'right' }}>請求金額（税込）</th></tr>
            </thead>
            <tbody>
              {scheduledItems.length === 0 && (
                <tr><td colSpan={5} className="empty-cell">請求予定のある案件はありません</td></tr>
              )}
              {scheduledItems.slice(0, 8).map((s, i) => {
                const isOverdue = s.scheduledDateISO <= today
                const method = s.row.contract?.billing_method ?? null
                return (
                  <tr key={`${s.row.project_id}:${s.scheduledDateISO}:${i}`} className="clickable-row" onClick={() => onViewBilling(s.row.project_id)}>
                    <td>
                      <strong>{s.row.project_name}</strong>
                      {s.totalRounds > 1 && (
                        <span style={{ marginLeft: 6, fontSize: 10, background: '#f1f5f9', color: '#64748b', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>第{s.round}回/全{s.totalRounds}回</span>
                      )}
                    </td>
                    <td>{s.row.customer_name}</td>
                    <td style={{ color: isOverdue ? '#dc2626' : '#0ea5e9', fontWeight: 600 }}>
                      {s.scheduledDateISO}
                      {isOverdue && <span style={{ marginLeft: 6, fontSize: 10, background: '#fee2e2', color: '#dc2626', borderRadius: 99, padding: '1px 5px' }}>超過</span>}
                    </td>
                    <td>{method
                      ? <span style={{ fontSize: 11.5, fontWeight: 600, background: '#f1f5f9', color: '#475569', borderRadius: 4, padding: '2px 8px' }}>{method}</span>
                      : '—'
                    }</td>
                    <td className="amount">{fmtYen(s.amount)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
