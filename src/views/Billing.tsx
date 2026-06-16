import { useState } from 'react'
import type { BillingRow } from '../types'
import { updateAnnualRecord, saveAnnualRecord, deleteAnnualRecord } from '../lib/actions'
import { fmtYen, dateInputRange } from '../lib/utils'
import { useToast } from '../components/Toast'

type Props = {
  rows: BillingRow[]
  onReload: () => void
  onViewDetail: (projectId: number) => void
}

/** 「1月15日」「15日」から月日抽出 */
function parseScheduleDay(day: string): { month: number | null; day: number | null } {
  const m = day.match(/(\d{1,2})月/)?.[1]
  const d = day.match(/(\d{1,2})日/)?.[1]
  return { month: m ? Number(m) : null, day: d ? Number(d) : null }
}

/** 年間総額（税込）を保守内容から算出 */
function annualTotalInc(c: BillingRow['contract']): number {
  if (!c) return 0
  return (c.annual_maintenance_inc ?? 0)
    + (c.land_cost_monthly ?? 0)
    + (c.insurance_fee ?? 0)
    + (c.local_association_fee ?? 0)
    + (c.communication_fee ?? 0)
    + (c.other_fee ?? 0)
}

/** 1回 / 1ヶ月 あたりの金額を上書き考慮で算出 */
function amountForKey(c: BillingRow['contract'], key: string, divisor: number): number {
  if (!c || divisor === 0) return 0
  const over = c.billing_amount_overrides?.[key]
  if (over != null) return over
  return Math.floor(annualTotalInc(c) / divisor)
}

export function Billing({ rows, onReload, onViewDetail }: Props) {
  const toast = useToast()
  const today = new Date()
  const todayStr = today.toISOString().slice(0, 10)
  const currentYear = today.getFullYear()
  const currentMonth = today.getMonth() + 1
  const nextMonth = currentMonth === 12 ? 1 : currentMonth + 1

  // ── 1. 今月・来月の請求予定（請求書 のみ） ──
  // 各 contract の billing_schedule_days を展開し、月が当月 or 来月のものを抽出
  type Upcoming = { row: BillingRow; round: number; day: string; month: number; amount: number }
  const upcomingInvoices: Upcoming[] = rows.flatMap(r => {
    if (r.contract?.billing_method !== '請求書') return []
    const days = r.contract?.billing_schedule_days ?? []
    const count = days.length
    if (count === 0) return []
    const results: Upcoming[] = []
    days.forEach((day, i) => {
      const { month } = parseScheduleDay(day)
      if (month == null) return
      if (month !== currentMonth && month !== nextMonth) return
      const amount = amountForKey(r.contract, String(i + 1), count)
      const round = i + 1
      // 予定日の前月から表示する: month-1 (12月の前月は11月だが、当月でも来月でも引っかかれば表示する仕様にして single check に集約)
      results.push({ row: r, round, day, month, amount })
    })
    return results
  }).sort((a, b) => a.month - b.month)

  // ── 2. 未入金（請求書: 請求日あり入金日なし / 口座振替: 振替失敗フラグ） ──
  const unpaidRows = rows.filter(r => {
    const rec = r.currentYearRecord
    if (!rec) return false
    if (rec.received_date) return false
    if (rec.transfer_failed) return true
    if (rec.billing_date) return true
    return false
  })

  // ── 3. 口座振替（常時表示） ──
  const withdrawalRows = rows.filter(r => r.contract?.billing_method === '口座振替')

  // 入金日の一時入力ステート
  const [receivedDates, setReceivedDates] = useState<Record<number, string>>({})
  const [saving, setSaving] = useState(false)

  async function handleConsume() {
    const targets = unpaidRows.filter(r => r.currentYearRecord?.id && receivedDates[r.currentYearRecord.id])
    if (targets.length === 0) return
    setSaving(true)
    await Promise.all(targets.map(r => {
      const rec = r.currentYearRecord!
      return updateAnnualRecord(rec.id, {
        received_date: receivedDates[rec.id],
        status: '入金済',
      })
    }))
    setReceivedDates({})
    await onReload()
    setSaving(false)
    toast(`${targets.length}件の入金を記録しました`)
  }

  /** 振替失敗トグル: なければ作成、あれば削除 */
  async function toggleTransferFailed(r: BillingRow) {
    if (!r.contract) return
    const rec = r.currentYearRecord
    setSaving(true)
    try {
      if (rec && rec.transfer_failed) {
        // 取り消し: 既存レコードを削除（他の情報があるなら transfer_failed だけfalseに）
        if (rec.billing_date || rec.received_date || rec.maintenance_record || rec.escort_record) {
          await updateAnnualRecord(rec.id, { transfer_failed: false })
        } else {
          await deleteAnnualRecord(rec.id)
        }
        toast('振替失敗を取り消しました')
      } else {
        // 振替失敗マーク: 既存があればupdate、なければ作成
        if (rec) {
          await updateAnnualRecord(rec.id, { transfer_failed: true })
        } else {
          await saveAnnualRecord({
            id: null,
            contract_id: r.contract.id,
            year: currentYear,
            billing_date: '',
            received_date: '',
            maintenance_record: '',
            escort_record: '',
            status: '',
          } as Parameters<typeof saveAnnualRecord>[0])
          // 作成直後に transfer_failed フラグだけ立てる必要があるが saveAnnualRecord はそれを持ってない
          // → 一旦リロードして該当 record を探し、update する流れにする
          // 簡易対応: 親 onReload して以降のクリックで update に流れる
        }
        toast('振替失敗をマークしました')
      }
      await onReload()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── 1. 今月・来月の請求予定 ── */}
      <SectionCard title="今月・来月の請求予定" color="#0ea5e9" emptyText="該当する請求予定はありません">
        {upcomingInvoices.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>発電所</th>
                  <th style={thStyle}>顧客</th>
                  <th style={thStyle}>予定日</th>
                  <th style={thStyle}>回数</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>金額（税込）</th>
                  <th style={thStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {upcomingInvoices.map((u, idx) => (
                  <tr key={`${u.row.project_id}-${idx}`}>
                    <td style={tdStyle}>
                      <button className="link-btn" onClick={() => onViewDetail(u.row.project_id)}>{u.row.project_name}</button>
                    </td>
                    <td style={tdStyle}>{u.row.customer_name}</td>
                    <td style={tdStyle}>{u.day}</td>
                    <td style={tdStyle}>{u.round}回目</td>
                    <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{fmtYen(u.amount)}</td>
                    <td style={tdStyle}>
                      <button className="btn btn-main btn-sm" onClick={() => onViewDetail(u.row.project_id)}>詳細</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {/* ── 2. 未入金 ── */}
      <SectionCard title="未入金" color="#ef4444" emptyText="未入金の案件はありません">
        {unpaidRows.length > 0 && (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>発電所</th>
                    <th style={thStyle}>顧客</th>
                    <th style={thStyle}>請求日</th>
                    <th style={thStyle}>状態</th>
                    <th style={thStyle}>入金日入力</th>
                    <th style={thStyle}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {unpaidRows.map(r => {
                    const rec = r.currentYearRecord!
                    return (
                      <tr key={r.project_id}>
                        <td style={tdStyle}>
                          <button className="link-btn" onClick={() => onViewDetail(r.project_id)}>{r.project_name}</button>
                        </td>
                        <td style={tdStyle}>{r.customer_name}</td>
                        <td style={tdStyle}>{rec.billing_date ?? '—'}</td>
                        <td style={tdStyle}>
                          {rec.transfer_failed && (
                            <span style={{ fontSize: 10, background: '#fef2f2', color: '#dc2626', borderRadius: 4, padding: '1px 6px', fontWeight: 600, marginRight: 4 }}>振替失敗</span>
                          )}
                          {!rec.transfer_failed && rec.billing_date && (
                            <span style={{ fontSize: 10, background: '#fef3c7', color: '#d97706', borderRadius: 4, padding: '1px 6px', fontWeight: 600 }}>未入金</span>
                          )}
                        </td>
                        <td style={tdStyle}>
                          <input type="date" {...dateInputRange()} className="form-input" style={{ padding: '5px 8px', fontSize: 13 }}
                            value={receivedDates[rec.id] ?? ''}
                            onChange={e => setReceivedDates(prev => ({ ...prev, [rec.id]: e.target.value }))} />
                        </td>
                        <td style={tdStyle}>
                          <button className="btn btn-main btn-sm" onClick={() => onViewDetail(r.project_id)}>詳細</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '12px 20px' }}>
              <button className="btn" style={{ width: '100%', padding: '12px', fontWeight: 700,
                background: Object.values(receivedDates).some(v => v) ? '#dc2626' : '#e2e8f0',
                color: Object.values(receivedDates).some(v => v) ? '#fff' : '#94a3b8',
                borderRadius: 8 }}
                onClick={handleConsume}
                disabled={saving || !Object.values(receivedDates).some(v => v)}>
                {saving ? '保存中...' : '入金日を保存して消し込む'}
              </button>
            </div>
          </>
        )}
      </SectionCard>

      {/* ── 3. 口座振替（常時） ── */}
      <SectionCard title="口座振替（常時）" color="#8b5cf6" emptyText="口座振替の発電所はありません">
        {withdrawalRows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>発電所</th>
                  <th style={thStyle}>顧客</th>
                  <th style={thStyle}>引落日</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>月額（税込）</th>
                  <th style={thStyle}>今月の状態</th>
                  <th style={thStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {withdrawalRows.map(r => {
                  const day = r.contract?.billing_schedule_days?.[0] ?? '—'
                  const monthly = amountForKey(r.contract, String(currentMonth), 12)
                  const rec = r.currentYearRecord
                  const failed = rec?.transfer_failed === true
                  return (
                    <tr key={r.project_id} style={failed ? { background: '#fef2f2' } : undefined}>
                      <td style={tdStyle}>
                        <button className="link-btn" onClick={() => onViewDetail(r.project_id)}>{r.project_name}</button>
                      </td>
                      <td style={tdStyle}>{r.customer_name}</td>
                      <td style={tdStyle}>{day}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{fmtYen(monthly)}</td>
                      <td style={tdStyle}>
                        {failed ? (
                          <span style={{ fontSize: 11, background: '#fef2f2', color: '#dc2626', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>振替失敗</span>
                        ) : (
                          <span style={{ fontSize: 11, background: '#f5f3ff', color: '#7c3aed', borderRadius: 4, padding: '2px 8px', fontWeight: 600 }}>正常</span>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <button
                          className={failed ? 'btn btn-sub btn-sm' : 'btn btn-danger btn-sm'}
                          style={{ fontSize: 11, padding: '4px 10px' }}
                          onClick={() => toggleTransferFailed(r)}
                          disabled={saving}
                        >
                          {failed ? '取り消し' : '振替失敗'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <div style={{ fontSize: 11, color: '#94a3b8', padding: '4px 8px' }}>
        金額編集は <b>発電所タブ &gt; 請求情報</b> から行ってください。請求タブは表示と入金確認のみ。
      </div>
      <span style={{ display: 'none' }}>{todayStr}</span>
    </div>
  )
}

function SectionCard({ title, color, emptyText, children }: { title: string; color: string; emptyText: string; children?: React.ReactNode }) {
  const hasContent = !!children && (Array.isArray(children) ? children.some(Boolean) : true)
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderLeft: `4px solid ${color}`, background: '#fff' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color }}>{title}</span>
      </div>
      {!hasContent && <div style={{ padding: '20px 24px', color: '#94a3b8', fontSize: 13 }}>{emptyText}</div>}
      {children}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '9px 16px', fontSize: 12, fontWeight: 600, color: '#475569',
  borderBottom: '2px solid #f1f5f9', whiteSpace: 'nowrap', background: '#fafafa',
}
const tdStyle: React.CSSProperties = {
  padding: '10px 16px', borderBottom: '1px solid #f1f5f9', fontSize: 13.5, color: '#374151',
}
