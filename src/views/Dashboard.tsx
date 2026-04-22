import type { DashboardStats, MaintenanceResponse, BillingRow } from '../types'
import { StatusBadge } from '../components/StatusBadge'
import { fmtYen } from '../lib/utils'

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
  const activeList = maintenanceList.filter(m => m.status === '対応中')

  // 未入金アラート: 請求日あり・入金日なし（分割払い対応）
  const unpaidRows = billingRows.filter(r => {
    const rec = r.currentYearRecord
    if (!rec) return false
    // 分割払い: payments配列内に請求予定日or請求日があり未入金のエントリがあるか
    if (rec.payments && rec.payments.length > 0) {
      return rec.payments.some(p => (p.scheduled_date || p.billing_date) && !p.received_date)
    }
    // 単回払い
    return rec.billing_date && !rec.received_date
  })

  // 口座振替で振替日を過ぎているが入金確認がない案件
  const transferOverdueRows = billingRows.filter(r => {
    if (r.contract?.billing_method !== '口座振替') return false
    const rec = r.currentYearRecord
    if (!rec || rec.received_date || rec.transfer_failed) return false
    const dueDate = dueDayToDate(r.contract?.billing_due_day)
    return dueDate ? dueDate <= today : false
  })

  // 請求予定: 請求予定日あり・請求日なし
  const scheduledRows = billingRows
    .filter(r => {
      const rec = r.currentYearRecord
      return rec?.billing_scheduled_date && !rec.billing_date
    })
    .sort((a, b) => {
      const da = a.currentYearRecord?.billing_scheduled_date ?? ''
      const db = b.currentYearRecord?.billing_scheduled_date ?? ''
      return da.localeCompare(db)
    })

  // 未入金合計金額（分割払い対応: 未入金回数分を加算）
  const unpaidTotal = unpaidRows.reduce((sum, r) => {
    const rec = r.currentYearRecord!
    if (rec.payments && rec.payments.length > 0) {
      const unpaidCount = rec.payments.filter(p => (p.scheduled_date || p.billing_date) && !p.received_date).length
      const perPayment = r.contract?.billing_amount_inc ?? 0
      return sum + perPayment * unpaidCount
    }
    const amount = rec.line_items?.reduce((s, i) => s + i.amount, 0) ?? r.contract?.billing_amount_inc ?? 0
    return sum + amount
  }, 0)

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
          <div className="kpi-value">{unpaidRows.length}</div>
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
              {unpaidRows.length === 0 && (
                <tr><td colSpan={5} className="empty-cell">未入金の請求はありません</td></tr>
              )}
              {unpaidRows.slice(0, 8).map(r => {
                const rec = r.currentYearRecord!
                const hasPayments = rec.payments && rec.payments.length > 0
                const unpaidPayments = hasPayments ? rec.payments!.filter(p => (p.scheduled_date || p.billing_date) && !p.received_date) : []
                const amount = hasPayments
                  ? (r.contract?.billing_amount_inc ?? 0) * unpaidPayments.length
                  : rec.line_items?.reduce((s, i) => s + i.amount, 0) ?? r.contract?.billing_amount_inc ?? null
                const isOverdue = hasPayments
                  ? unpaidPayments.some(p => p.scheduled_date! <= today)
                  : rec.payment_due_date ? rec.payment_due_date <= today : false
                return (
                  <tr key={r.project_id} className="clickable-row" onClick={() => onViewBilling(r.project_id)}>
                    <td>
                      <strong>{r.project_name}</strong>
                      {hasPayments && (
                        <span style={{ marginLeft: 6, fontSize: 10, background: '#fef3c7', color: '#d97706', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>
                          {rec.payments!.length}回中{unpaidPayments.length}回未入金
                        </span>
                      )}
                    </td>
                    <td>{r.customer_name}</td>
                    <td className="amount">{fmtYen(amount)}</td>
                    <td style={{ color: isOverdue ? '#dc2626' : '#94a3b8', fontWeight: isOverdue ? 600 : 400 }}>
                      {hasPayments
                        ? unpaidPayments.map(p => p.scheduled_date).join(', ')
                        : rec.payment_due_date ?? '—'}
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
              {scheduledRows.length === 0 && (
                <tr><td colSpan={5} className="empty-cell">請求予定のある案件はありません</td></tr>
              )}
              {scheduledRows.slice(0, 8).map(r => {
                const rec = r.currentYearRecord!
                const amount = rec.line_items?.reduce((s, i) => s + i.amount, 0) ?? r.contract?.billing_amount_inc ?? null
                const isOverdue = rec.billing_scheduled_date! <= today
                return (
                  <tr key={r.project_id} className="clickable-row" onClick={() => onViewBilling(r.project_id)}>
                    <td><strong>{r.project_name}</strong></td>
                    <td>{r.customer_name}</td>
                    <td style={{ color: isOverdue ? '#dc2626' : '#0ea5e9', fontWeight: 600 }}>
                      {rec.billing_scheduled_date}
                      {isOverdue && <span style={{ marginLeft: 6, fontSize: 10, background: '#fee2e2', color: '#dc2626', borderRadius: 99, padding: '1px 5px' }}>超過</span>}
                    </td>
                    <td>{r.contract?.billing_method
                      ? <span style={{ fontSize: 11.5, fontWeight: 600, background: '#f1f5f9', color: '#475569', borderRadius: 4, padding: '2px 8px' }}>{r.contract.billing_method}</span>
                      : '—'
                    }</td>
                    <td className="amount">{fmtYen(amount)}</td>
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
