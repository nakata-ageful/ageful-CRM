import { useState } from 'react'
import type { BillingRow } from '../types'
import { updateAnnualRecord } from '../lib/actions'
import { fmtYen } from '../lib/utils'
import { useToast } from '../components/Toast'

type Props = {
  rows: BillingRow[]
  onReload: () => void
  onViewDetail: (projectId: number) => void
}


/** "6月25日" → 今年の "2026-06-25" に変換 */
function dueDayToDate(dueDayStr: string | null | undefined): string | null {
  if (!dueDayStr) return null
  const m = dueDayStr.match(/(\d{1,2})月(\d{1,2})日/)
  if (!m) return null
  const year = new Date().getFullYear()
  return `${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

export function Billing({ rows, onReload, onViewDetail }: Props) {
  const toast = useToast()
  const today = new Date().toISOString().slice(0, 10)

  // 未入金アラート: 請求日あり・入金日なし（請求書）+ 振替不能（口座振替）+ 分割払い
  const unpaidRows = rows.filter(r => {
    const rec = r.currentYearRecord
    if (!rec) return false
    // 分割払い: payments配列内に請求予定日or請求日があり未入金のエントリがあるか
    if (rec.payments && rec.payments.length > 0) {
      return rec.payments.some(p => (p.scheduled_date || p.billing_date) && !p.received_date)
    }
    if (rec.received_date) return false
    // 口座振替で振替不能の場合
    if (r.contract?.billing_method === '口座振替' && rec.transfer_failed) return true
    // 請求書で請求済・未入金の場合
    return rec.billing_date && !rec.received_date
  })

  // 入金済: 今年度・全入金完了（折りたたみ表示）
  const paidRows = rows
    .filter(r => {
      const rec = r.currentYearRecord
      if (!rec) return false
      // 分割払い: 全回入金済みのみ
      if (rec.payments && rec.payments.length > 0) {
        return rec.payments.every(p => p.received_date)
      }
      return !!rec.received_date
    })
    .sort((a, b) => {
      const da = a.currentYearRecord?.received_date ?? ''
      const db = b.currentYearRecord?.received_date ?? ''
      return db.localeCompare(da) // 新しい順
    })

  // 請求予定: 請求書のみ（口座振替は請求不要）。請求予定日あり・請求日なし
  const scheduledRows = rows
    .filter(r => {
      const rec = r.currentYearRecord
      if (r.contract?.billing_method === '口座振替') return false
      return rec?.billing_scheduled_date && !rec.billing_date
    })
    .sort((a, b) => {
      const da = a.currentYearRecord?.billing_scheduled_date ?? ''
      const db = b.currentYearRecord?.billing_scheduled_date ?? ''
      return da.localeCompare(db)
    })

  // 口座振替: 今年度のレコードがある口座振替案件（振替不能以外）
  const transferRows = rows
    .filter(r => {
      if (r.contract?.billing_method !== '口座振替') return false
      const rec = r.currentYearRecord
      if (!rec) return true // 未作成
      if (rec.transfer_failed) return false // 振替不能は未入金アラートで表示
      if (rec.received_date) return false // 入金済は入金済セクションで表示
      return true
    })

  // 入金日の一時入力ステート（key: annualRecord.id）
  const [receivedDates, setReceivedDates] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)
  const [showPaid, setShowPaid] = useState(false)

  async function handleConsume() {
    const targets = unpaidRows.filter(r => {
      const id = r.currentYearRecord?.id
      return id !== undefined && receivedDates[id]
    })
    if (targets.length === 0) return
    setSaving(true)
    await Promise.all(
      targets.map(r => {
        const rec = r.currentYearRecord!
        return updateAnnualRecord(rec.id, {
          received_date: receivedDates[rec.id],
          status: '入金済',
        })
      })
    )
    setReceivedDates({})
    await onReload()
    setSaving(false)
    toast(`${targets.length}件の入金を記録しました`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── 未入金アラート ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 20px', borderLeft: '4px solid #ef4444', background: '#fff' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#dc2626' }}>
            未入金アラート（請求済・未入金）
          </span>
        </div>

        {unpaidRows.length === 0 ? (
          <div style={{ padding: '20px 24px', color: '#94a3b8', fontSize: 13 }}>未入金の案件はありません</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>発電所名</th>
                    <th style={thStyle}>顧客名</th>
                    <th style={thStyle}>請求日</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>請求金額</th>
                    <th style={thStyle}>入金予定日</th>
                    <th style={thStyle}>入金日を入力</th>
                    <th style={thStyle}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {unpaidRows.map(r => {
                    const rec = r.currentYearRecord!
                    const hasPayments = rec.payments && rec.payments.length > 0
                    const unpaidPayments = hasPayments ? rec.payments!.filter(p => (p.scheduled_date || p.billing_date) && !p.received_date) : []
                    const amount = hasPayments
                      ? (r.contract?.billing_amount_inc ?? 0) * unpaidPayments.length
                      : rec.line_items?.reduce((s, i) => s + i.amount, 0) ?? r.contract?.billing_amount_inc ?? null
                    return (
                      <tr key={r.project_id}>
                        <td style={tdStyle}>
                          <button
                            className="link-btn"
                            onClick={() => onViewDetail(r.project_id)}
                          >
                            {r.project_name}
                          </button>
                          {hasPayments && (
                            <span style={{ marginLeft: 6, fontSize: 10, background: '#fef3c7', color: '#d97706', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>
                              {rec.payments!.length}回中{unpaidPayments.length}回未入金
                            </span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, color: '#0ea5e9', fontWeight: 500 }}>
                          {r.customer_name}
                          {r.contract?.billing_method === '口座振替' && (
                            <span style={{ marginLeft: 4, fontSize: 9, background: '#f5f3ff', color: '#7c3aed', borderRadius: 3, padding: '1px 4px', fontWeight: 600 }}>振替</span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          {rec.billing_date ?? '—'}
                          {rec.transfer_failed && (
                            <span style={{ marginLeft: 6, fontSize: 10, background: '#fef2f2', color: '#dc2626', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>振替不能</span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {fmtYen(amount)}
                        </td>
                        <td style={{ ...tdStyle, color: rec.payment_due_date ? '#0ea5e9' : '#94a3b8', fontWeight: rec.payment_due_date ? 600 : 400 }}>
                          {hasPayments
                            ? unpaidPayments.map(p => p.scheduled_date ?? '—').join(', ')
                            : rec.payment_due_date ?? '—'}
                        </td>
                        <td style={tdStyle}>
                          {hasPayments ? (
                            <button
                              className="btn btn-main btn-sm"
                              onClick={() => onViewDetail(r.project_id)}
                            >
                              請求詳細で入金処理
                            </button>
                          ) : (
                            <input
                              type="date"
                              className="form-input"
                              style={{ padding: '5px 8px', fontSize: 13 }}
                              value={receivedDates[rec.id] ?? ''}
                              onChange={e => setReceivedDates(prev => ({ ...prev, [rec.id]: e.target.value }))}
                            />
                          )}
                        </td>
                        <td style={tdStyle}>
                          <button
                            className="btn btn-main btn-sm"
                            onClick={() => onViewDetail(r.project_id)}
                          >
                            請求詳細
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ padding: '12px 20px' }}>
              <button
                className="btn"
                style={{
                  width: '100%', padding: '13px', fontSize: 14, fontWeight: 700,
                  background: Object.values(receivedDates).some(v => v) ? '#dc2626' : '#e2e8f0',
                  color: Object.values(receivedDates).some(v => v) ? '#fff' : '#94a3b8',
                  borderRadius: 8, cursor: Object.values(receivedDates).some(v => v) ? 'pointer' : 'default',
                }}
                onClick={handleConsume}
                disabled={saving || !Object.values(receivedDates).some(v => v)}
              >
                {saving ? '保存中...' : '未入金リストの入金日を保存して消し込む'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── 来月以降の請求予定 ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 20px', borderLeft: '4px solid #0ea5e9', background: '#fff' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#0369a1' }}>
            来月以降の請求予定
          </span>
        </div>

        {scheduledRows.length === 0 ? (
          <div style={{ padding: '20px 24px', color: '#94a3b8', fontSize: 13 }}>請求予定のある案件はありません</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>発電所名</th>
                  <th style={thStyle}>顧客名</th>
                  <th style={thStyle}>請求予定日</th>
                  <th style={thStyle}>請求方法</th>
                  <th style={thStyle}>保守プラン</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>請求金額（税込）</th>
                  <th style={thStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {scheduledRows.map(r => {
                  const rec = r.currentYearRecord!
                  const amount = rec.line_items?.reduce((s, i) => s + i.amount, 0)
                    ?? r.contract?.billing_amount_inc
                    ?? null
                  const isOverdue = rec.billing_scheduled_date! <= today
                  return (
                    <tr key={r.project_id}>
                      <td style={tdStyle}>
                        <button
                          className="link-btn"
                          onClick={() => onViewDetail(r.project_id)}
                        >
                          {r.project_name}
                        </button>
                      </td>
                      <td style={{ ...tdStyle, color: '#0ea5e9', fontWeight: 500 }}>
                        {r.customer_name}
                      </td>
                      <td style={{ ...tdStyle, color: isOverdue ? '#dc2626' : '#0ea5e9', fontWeight: 600 }}>
                        {rec.billing_scheduled_date}
                        {isOverdue && <span style={{ marginLeft: 6, fontSize: 11, background: '#fee2e2', color: '#dc2626', borderRadius: 99, padding: '1px 6px' }}>超過</span>}
                      </td>
                      <td style={tdStyle}>
                        {r.contract?.billing_method ? (
                          <span style={{ fontSize: 11.5, fontWeight: 600, background: '#f1f5f9', color: '#475569', borderRadius: 4, padding: '2px 8px' }}>
                            {r.contract.billing_method}
                          </span>
                        ) : '—'}
                      </td>
                      <td style={tdStyle}>
                        {r.contract ? (
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {r.contract.plan_inspection && <PlanBadge label="点検" value={r.contract.plan_inspection} />}
                            {r.contract.plan_weeding && <PlanBadge label="除草" value={r.contract.plan_weeding} />}
                            {r.contract.plan_emergency && <PlanBadge label="駆付" value={r.contract.plan_emergency} />}
                            {!r.contract.plan_inspection && !r.contract.plan_weeding && !r.contract.plan_emergency && <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>}
                          </div>
                        ) : '—'}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {fmtYen(amount)}
                      </td>
                      <td style={tdStyle}>
                        <button
                          className="btn btn-main btn-sm"
                          onClick={() => onViewDetail(r.project_id)}
                        >
                          請求詳細
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* ── 口座振替（今年度） ── */}
      {transferRows.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', borderLeft: '4px solid #8b5cf6', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed' }}>
              口座振替
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#94a3b8' }}>{transferRows.length}件</span>
            </span>
            {transferRows.filter(r => { const d = dueDayToDate(r.contract?.billing_due_day); return d ? d <= today : false }).length > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, background: '#fef3c7', color: '#d97706', borderRadius: 99, padding: '2px 10px' }}>
                {transferRows.filter(r => { const d = dueDayToDate(r.contract?.billing_due_day); return d ? d <= today : false }).length}件 要確認
              </span>
            )}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>発電所名</th>
                  <th style={thStyle}>顧客名</th>
                  <th style={thStyle}>振替日</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>振替金額（税込）</th>
                  <th style={thStyle}>状態</th>
                  <th style={thStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {transferRows.map(r => {
                  const amount = r.contract?.billing_amount_inc ?? r.contract?.annual_maintenance_inc ?? null
                  const dueDate = dueDayToDate(r.contract?.billing_due_day)
                  const isOverdue = dueDate ? dueDate <= today : false
                  return (
                    <tr key={r.project_id} style={isOverdue ? { background: '#fffbeb' } : undefined}>
                      <td style={tdStyle}>
                        <button className="link-btn" onClick={() => onViewDetail(r.project_id)}>
                          {r.project_name}
                        </button>
                      </td>
                      <td style={{ ...tdStyle, color: '#0ea5e9', fontWeight: 500 }}>{r.customer_name}</td>
                      <td style={tdStyle}>
                        <span style={{ color: isOverdue ? '#d97706' : '#7c3aed', fontWeight: 600 }}>
                          {r.contract?.billing_due_day ?? '—'}
                        </span>
                        {isOverdue && (
                          <span style={{ marginLeft: 6, fontSize: 10, background: '#fef3c7', color: '#d97706', borderRadius: 99, padding: '1px 6px', fontWeight: 700 }}>要確認</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                        {fmtYen(amount)}
                      </td>
                      <td style={tdStyle}>
                        {isOverdue ? (
                          <span style={{ fontSize: 11, fontWeight: 600, background: '#fef3c7', color: '#d97706', borderRadius: 4, padding: '2px 8px' }}>
                            振替日超過
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, fontWeight: 600, background: '#f5f3ff', color: '#7c3aed', borderRadius: 4, padding: '2px 8px' }}>
                            振替待ち
                          </span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <button className="btn btn-main btn-sm" onClick={() => onViewDetail(r.project_id)}>
                          詳細
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 入金済（今年度） ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <button
          style={{ width: '100%', padding: '12px 20px', borderLeft: '4px solid #10b981', background: '#fff', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left' }}
          onClick={() => setShowPaid(p => !p)}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>
            入金済（今年度）
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#94a3b8' }}>{paidRows.length}件</span>
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{showPaid ? '▲ 閉じる' : '▼ 開く'}</span>
        </button>

        {showPaid && (
          paidRows.length === 0 ? (
            <div style={{ padding: '20px 24px', color: '#94a3b8', fontSize: 13 }}>入金済の案件はありません</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>発電所名</th>
                    <th style={thStyle}>顧客名</th>
                    <th style={thStyle}>請求日</th>
                    <th style={thStyle}>入金日</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>請求金額</th>
                    <th style={thStyle}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {paidRows.map(r => {
                    const rec = r.currentYearRecord!
                    const amount = rec.line_items?.reduce((s, i) => s + i.amount, 0)
                      ?? r.contract?.billing_amount_inc
                      ?? null
                    return (
                      <tr key={r.project_id}>
                        <td style={tdStyle}>
                          <button className="link-btn" onClick={() => onViewDetail(r.project_id)}>
                            {r.project_name}
                          </button>
                        </td>
                        <td style={{ ...tdStyle, color: '#0ea5e9', fontWeight: 500 }}>{r.customer_name}</td>
                        <td style={tdStyle}>{rec.billing_date ?? '—'}</td>
                        <td style={{ ...tdStyle, color: '#059669', fontWeight: 600 }}>{rec.received_date}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {fmtYen(amount)}
                        </td>
                        <td style={tdStyle}>
                          <button className="btn btn-main btn-sm" onClick={() => onViewDetail(r.project_id)}>
                            修正・詳細
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>
    </div>
  )
}

function PlanBadge({ label, value }: { label: string; value: string }) {
  const color = value === 'なし' ? '#94a3b8' : value === '無制限' ? '#059669' : '#0ea5e9'
  const bg = value === 'なし' ? '#f1f5f9' : value === '無制限' ? '#ecfdf5' : '#f0f9ff'
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color, background: bg, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>
      {label}:{value}
    </span>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '9px 16px',
  fontSize: 12, fontWeight: 600, color: '#475569',
  borderBottom: '2px solid #f1f5f9', whiteSpace: 'nowrap',
  background: '#fafafa',
}
const tdStyle: React.CSSProperties = {
  padding: '10px 16px', borderBottom: '1px solid #f1f5f9',
  fontSize: 13.5, color: '#374151',
}
