import type { BillingRow, Invoice } from '../types'
import { updateInvoiceStatus } from '../lib/actions'

type Props = {
  rows: BillingRow[]
  onReload: () => void
}

function exportCSV(rows: BillingRow[]) {
  const header = ['案件名', '契約種別', '請求期間', '金額', '支払期日', '状態', '入金日']
  const body = rows.map(r => [
    r.project_name,
    r.contract_name,
    r.invoice.billing_period ?? '',
    r.invoice.amount ?? 0,
    r.invoice.payment_due_date ?? '',
    r.invoice.status,
    r.invoice.paid_at ?? '',
  ])
  const csv = [header, ...body].map(row => row.map(v => `"${v}"`).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `billing_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function Billing({ rows, onReload }: Props) {
  const unbilledRows = rows.filter(r => r.invoice.status === 'unbilled')
  const billedRows   = rows.filter(r => r.invoice.status === 'billed')
  const paidRows     = rows.filter(r => r.invoice.status === 'paid')

  const unbilledTotal = unbilledRows.reduce((s, r) => s + (r.invoice.amount ?? 0), 0)
  const billedTotal   = billedRows.reduce((s, r) => s + (r.invoice.amount ?? 0), 0)
  const paidTotal     = paidRows.reduce((s, r) => s + (r.invoice.amount ?? 0), 0)

  async function handleStatusChange(invoice: Invoice, status: Invoice['status']) {
    await updateInvoiceStatus(invoice.id, status)
    onReload()
  }

  return (
    <>
      <div className="kpi-grid kpi-grid--3">
        <div className="kpi-card kpi-card--warn">
          <div className="kpi-label">未請求</div>
          <div className="kpi-value warn" style={{ fontSize: 22 }}>¥{unbilledTotal.toLocaleString()}</div>
          <div className="kpi-sub">{unbilledRows.length} 件 — まだ発行していない</div>
        </div>
        <div className="kpi-card kpi-card--info">
          <div className="kpi-label">請求済み 未入金</div>
          <div className="kpi-value info" style={{ fontSize: 22 }}>¥{billedTotal.toLocaleString()}</div>
          <div className="kpi-sub">{billedRows.length} 件 — 入金待ち</div>
        </div>
        <div className="kpi-card kpi-card--ok">
          <div className="kpi-label">入金済み</div>
          <div className="kpi-value ok" style={{ fontSize: 22 }}>¥{paidTotal.toLocaleString()}</div>
          <div className="kpi-sub">{paidRows.length} 件</div>
        </div>
      </div>

      <div className="card">
        <div className="card-header-row">
          <h3 className="section-title" style={{ margin: 0 }}>契約・請求一覧</h3>
          <button className="btn btn-sub" onClick={() => exportCSV(rows)}>CSV出力</button>
        </div>
        <table>
          <thead>
            <tr>
              <th>案件</th><th>契約種別</th><th>請求期間</th>
              <th>金額</th><th>支払期日</th><th>入金日</th><th>状態</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="empty-cell">請求データがありません</td></tr>
            )}
            {rows.map(row => (
              <tr key={row.invoice.id}>
                <td>{row.project_name}</td>
                <td>{row.contract_name}</td>
                <td>{row.invoice.billing_period ?? '-'}</td>
                <td className="amount">¥{(row.invoice.amount ?? 0).toLocaleString()}</td>
                <td>{row.invoice.payment_due_date ?? '-'}</td>
                <td>{row.invoice.paid_at ?? '-'}</td>
                <td>
                  <select
                    className={`status-select status-select--${row.invoice.status}`}
                    value={row.invoice.status}
                    onChange={e => handleStatusChange(row.invoice, e.target.value as Invoice['status'])}
                  >
                    <option value="unbilled">未請求</option>
                    <option value="billed">請求済み</option>
                    <option value="paid">入金済み</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
