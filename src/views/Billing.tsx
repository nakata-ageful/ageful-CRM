import { useState } from 'react'
import type { BillingRow, AnnualRecord, PaymentEntry } from '../types'
import { updateAnnualRecord, createAnnualRecord, deleteAnnualRecord } from '../lib/actions'
import { invoiceAmount, withdrawalAmount } from '../lib/billing'
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

/** 「X月Y日」「Y日」を YYYY-MM-DD に変換（month_default は 口座振替の引落日に使う） */
function toIsoDate(year: number, dayStr: string, monthDefault?: number): string | null {
  const { month, day } = parseScheduleDay(dayStr)
  const m = month ?? monthDefault
  if (m == null || day == null) return null
  return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// 金額計算（年間総額・均等割・手数料・請求対象フラグ）は lib/billing.ts に共通化

export function Billing({ rows, onReload, onViewDetail }: Props) {
  const toast = useToast()
  const today = new Date()
  const currentYear = today.getFullYear()
  const currentMonth = today.getMonth() + 1
  // 請求予定の対象範囲: 今月・来月・再来月（3ヶ月分）。月をキーに年を引けるようにする（3ヶ月の窓なので月の重複は起きない）
  const upcomingMonthYears = Array.from({ length: 3 }, (_, i) => {
    const raw = currentMonth - 1 + i
    return { month: (raw % 12) + 1, year: currentYear + Math.floor(raw / 12) }
  })
  const yearByUpcomingMonth = new Map(upcomingMonthYears.map(m => [m.month, m.year]))

  // ───────────────────────────────────────────────
  // データ展開
  // ───────────────────────────────────────────────

  /**
   * 請求予定: 請求書のみ、当月/翌月の予定日が対象。
   * 既存 annual_record（同じ year + billing_scheduled_date）があるものは除外（=既に発行済 or 入金済）
   */
  type UpcomingItem = {
    row: BillingRow
    round: number
    totalRounds: number
    scheduledDateISO: string  // YYYY-MM-DD
    scheduleDayLabel: string  // 例: "1月15日"
    amount: number
  }
  const upcomingInvoices: UpcomingItem[] = rows.flatMap(r => {
    const c = r.contract
    if (c?.billing_method !== '請求書') return []
    const days = c?.billing_schedule_days ?? []
    const totalRounds = days.length
    if (totalRounds === 0) return []

    // 今月・来月・再来月にあたる予定回を候補として抽出
    const candidates = days
      .map((day, i) => ({ day, round: i + 1, month: parseScheduleDay(day).month }))
      .filter(cd => cd.month != null && yearByUpcomingMonth.has(cd.month))
      .map(cd => {
        const year = yearByUpcomingMonth.get(cd.month!)!
        return { ...cd, year, iso: toIsoDate(year, cd.day) }
      })
      .filter(cd => cd.iso != null) as { day: string; round: number; year: number; iso: string }[]
    if (candidates.length === 0) return []

    // 年度ごとに「予定日が未設定のまま請求/入金/振替失敗が入った記録」の数を数える。
    // これらは発行ボタンを通さず（CSVインポート等で）作られた記録で、実質その年の請求が
    // 済んでいることを意味する。スケジュール回に正確に紐づく記録は除く（=正規の発行済み）。
    // 回ごとデータ（payments）を持つ記録は各回に日付が明示されているので浮遊扱いしない。
    const floatingByYear: Record<number, number> = {}
    for (const rec of r.records) {
      if (rec.payments?.length) continue
      const handled = rec.billing_date || rec.received_date || rec.transfer_failed
      if (!handled) continue
      const tied = days.some(d => toIsoDate(rec.year, d) === rec.billing_scheduled_date)
      if (tied) continue
      floatingByYear[rec.year] = (floatingByYear[rec.year] ?? 0) + 1
    }

    const results: UpcomingItem[] = []
    candidates.sort((a, b) => a.iso.localeCompare(b.iso))
    for (const cand of candidates) {
      // 既にこの予定日そのものの記録がある（発行済 or 入金済）→ 未入金/入金済セクション側へ
      // 記録全体の予定日でも、回ごとデータ内の予定日でもひも付いていれば発行済みとみなす
      if (r.records.some(rec => rec.billing_scheduled_date === cand.iso || rec.payments?.some(p => p.scheduled_date === cand.iso))) continue
      // 予定日未設定のまま請求された記録がこの年度にあれば、その分この回を消費して除外
      if ((floatingByYear[cand.year] ?? 0) > 0) { floatingByYear[cand.year]--; continue }
      results.push({
        row: r,
        round: cand.round,
        totalRounds,
        scheduledDateISO: cand.iso,
        scheduleDayLabel: cand.day,
        amount: invoiceAmount(c, cand.round, totalRounds),
      })
    }
    return results
  }).sort((a, b) => a.scheduledDateISO.localeCompare(b.scheduledDateISO))

  /**
   * 未入金・入金済は「回」単位で判定する（対象は今年度＋昨年度＝過去1年。ユーザー指定）。
   * - 分割入金の記録（payments あり）: 回ごとの billing_date / received_date で判定。
   *   記録全体の received_date は「最後に入金があった回の日付」が入る仕様なので判定に使わない。
   * - 単回の記録（payments なし）: 従来通り記録全体の billing_date / received_date で判定。
   */
  const inScopeYear = (rec: AnnualRecord) => rec.year >= currentYear - 1
  type UnpaidItem = { row: BillingRow; record: AnnualRecord; payment?: PaymentEntry; totalRounds?: number }
  const unpaidItems: UnpaidItem[] = rows.flatMap(r =>
    r.records.filter(inScopeYear).flatMap((rec): UnpaidItem[] => {
      if (rec.payments?.length) {
        return rec.payments
          .filter(p => !p.received_date && p.billing_date)
          .map(p => ({ row: r, record: rec, payment: p, totalRounds: rec.payments!.length }))
      }
      if (!rec.received_date && (rec.billing_date || rec.transfer_failed)) return [{ row: r, record: rec }]
      return []
    })
  ).sort((a, b) => (a.payment?.billing_date ?? a.record.billing_date ?? '').localeCompare(b.payment?.billing_date ?? b.record.billing_date ?? ''))

  type PaidItem = { row: BillingRow; record: AnnualRecord; payment?: PaymentEntry; totalRounds?: number }
  const paidItems: PaidItem[] = rows.flatMap(r =>
    r.records.filter(inScopeYear).flatMap((rec): PaidItem[] => {
      if (rec.payments?.length) {
        return rec.payments
          .filter(p => p.received_date)
          .map(p => ({ row: r, record: rec, payment: p, totalRounds: rec.payments!.length }))
      }
      if (rec.received_date) return [{ row: r, record: rec }]
      return []
    })
  ).sort((a, b) => (b.payment?.received_date ?? b.record.received_date ?? '').localeCompare(a.payment?.received_date ?? a.record.received_date ?? ''))

  /**
   * 口座振替（常時表示）: billing_method='口座振替' の発電所一覧
   */
  const withdrawalRows = rows.filter(r => r.contract?.billing_method === '口座振替')

  // ───────────────────────────────────────────────
  // アクション
  // ───────────────────────────────────────────────

  // 請求予定リスト: 行ごとの一時入力（billing_date, payment_due_date）
  const [issueInputs, setIssueInputs] = useState<Record<string, { billing_date: string; payment_due_date: string }>>({})
  // 未入金リスト: 行ごとの一時入力（received_date）。キーは「記録id:回seq」（単回は seq=0）
  const [receivedDates, setReceivedDates] = useState<Record<string, string>>({})
  const unpaidKey = (item: UnpaidItem) => `${item.record.id}:${item.payment?.seq ?? 0}`
  const [saving, setSaving] = useState(false)
  const [showPaid, setShowPaid] = useState(false)
  const [showWithdrawal, setShowWithdrawal] = useState(false)

  /** 発行: annual_record 作成して未入金へ移動 */
  async function handleIssue(u: UpcomingItem) {
    if (!u.row.contract) return
    const key = `${u.row.project_id}-${u.scheduledDateISO}`
    const inp = issueInputs[key]
    if (!inp?.billing_date) { toast('請求日を入力してください'); return }
    setSaving(true)
    try {
      await createAnnualRecord(u.row.contract.id, currentYear, {
        billing_scheduled_date: u.scheduledDateISO,
        billing_date: inp.billing_date,
        payment_due_date: inp.payment_due_date || null,
      })
      setIssueInputs(prev => { const n = { ...prev }; delete n[key]; return n })
      await onReload()
      toast('請求書を発行しました')
    } finally { setSaving(false) }
  }

  /** 入金確認: received_date を入れて入金済へ移動（分割入金はその回だけ入金にする） */
  async function handleMarkPaid(item: UnpaidItem) {
    const rec = item.record
    const key = unpaidKey(item)
    const rd = receivedDates[key]
    if (!rd) { toast('入金日を入力してください'); return }
    setSaving(true)
    try {
      if (item.payment) {
        // 記録全体の received_date / status は請求詳細の保存処理と同じルールで更新する
        const payments = (rec.payments ?? []).map(p => p.seq === item.payment!.seq ? { ...p, received_date: rd } : p)
        const allReceived = payments.every(p => !!p.received_date)
        const lastReceived = [...payments].reverse().find(p => p.received_date)?.received_date ?? null
        await updateAnnualRecord(rec.id, {
          payments,
          received_date: lastReceived,
          status: allReceived ? '入金済' : '請求済',
        })
      } else {
        await updateAnnualRecord(rec.id, { received_date: rd, status: '入金済' })
      }
      setReceivedDates(prev => { const n = { ...prev }; delete n[key]; return n })
      await onReload()
      toast('入金済に移動しました')
    } finally { setSaving(false) }
  }

  /** 振替失敗トグル: 1クリックで作成 or 取り消し */
  async function toggleTransferFailed(r: BillingRow) {
    if (!r.contract) return
    // 今月分の振替失敗レコードを探す（billing_scheduled_date が今月の1日のもの）
    const failKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`
    const existing = r.records.find(rec => rec.transfer_failed && rec.billing_scheduled_date === failKey)
    setSaving(true)
    try {
      if (existing) {
        if (existing.billing_date || existing.received_date) {
          await updateAnnualRecord(existing.id, { transfer_failed: false })
        } else {
          await deleteAnnualRecord(existing.id)
        }
        toast('振替失敗を取り消しました')
      } else {
        // 新規作成（1クリックで transfer_failed=true まで）
        await createAnnualRecord(r.contract.id, currentYear, {
          billing_scheduled_date: failKey,
          transfer_failed: true,
        })
        toast('振替失敗をマークしました')
      }
      await onReload()
    } finally { setSaving(false) }
  }

  // ───────────────────────────────────────────────
  // レンダリング
  // ───────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── 1. 未入金 ── */}
      <SectionCard title="未入金" color="#ef4444" emptyText="未入金の案件はありません">
        {unpaidItems.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
              <thead>
                <tr>
                  <th style={thStyle}>発電所</th>
                  <th style={thStyle}>顧客</th>
                  <th style={thStyle}>回数</th>
                  <th style={thStyle}>請求日</th>
                  <th style={thStyle}>入金予定日</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>金額（税込）</th>
                  <th style={thStyle}>入金日</th>
                  <th style={thStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {unpaidItems.map(item => {
                  const c = item.row.contract
                  const key = unpaidKey(item)
                  // 金額: 分割入金の回はその回の請求額、振替失敗なら口座振替の月額、それ以外は line_items / 請求書の概算
                  let amount: number | null = null
                  if (item.payment && item.totalRounds) {
                    amount = invoiceAmount(c, item.payment.seq, item.totalRounds)
                  } else if (item.record.transfer_failed && item.record.billing_scheduled_date) {
                    const m = Number(item.record.billing_scheduled_date.slice(5, 7))
                    amount = withdrawalAmount(c, m)
                  } else if (item.record.line_items) {
                    amount = item.record.line_items.reduce((s, i) => s + i.amount, 0)
                  } else if (item.record.billing_scheduled_date && c?.billing_method === '請求書') {
                    // 請求書: 予定日と回数から推定
                    const days = c?.billing_schedule_days ?? []
                    const idx = days.findIndex(d => toIsoDate(item.record.year, d) === item.record.billing_scheduled_date)
                    if (idx >= 0) amount = invoiceAmount(c, idx + 1, days.length)
                  }
                  return (
                    <tr key={key}>
                      <td style={tdStyle}>
                        <button className="link-btn" onClick={() => onViewDetail(item.row.project_id)}>{item.row.project_name}</button>
                        {item.record.transfer_failed && (
                          <span style={{ marginLeft: 6, fontSize: 10, background: '#fef2f2', color: '#dc2626', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>振替失敗</span>
                        )}
                      </td>
                      <td style={tdStyle}>{item.row.customer_name}</td>
                      <td style={tdStyle}>{item.payment && item.totalRounds ? `${item.payment.seq}/${item.totalRounds}回目` : '—'}</td>
                      <td style={tdStyle}>{item.payment?.billing_date ?? item.record.billing_date ?? '—'}</td>
                      <td style={tdStyle}>{item.record.payment_due_date ?? '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{amount != null ? fmtYen(amount) : '—'}</td>
                      <td style={tdStyle}>
                        <input type="date" {...dateInputRange()} className="form-input" style={{ padding: '5px 8px', fontSize: 13 }}
                          value={receivedDates[key] ?? ''}
                          onChange={e => setReceivedDates(prev => ({ ...prev, [key]: e.target.value }))} />
                      </td>
                      <td style={tdStyle}>
                        <button className="btn btn-main btn-sm" disabled={saving || !receivedDates[key]} onClick={() => handleMarkPaid(item)}>
                          入金済に移動
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

      {/* ── 2. 今月・来月・再来月の請求予定 ── */}
      <SectionCard title="今月・来月・再来月の請求予定" color="#0ea5e9" emptyText="該当する請求予定はありません">
        {upcomingInvoices.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
              <thead>
                <tr>
                  <th style={thStyle}>発電所</th>
                  <th style={thStyle}>顧客</th>
                  <th style={thStyle}>予定日</th>
                  <th style={thStyle}>回数</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>金額（税込）</th>
                  <th style={thStyle}>請求日</th>
                  <th style={thStyle}>入金予定日</th>
                  <th style={thStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {upcomingInvoices.map(u => {
                  const key = `${u.row.project_id}-${u.scheduledDateISO}`
                  const inp = issueInputs[key] ?? { billing_date: '', payment_due_date: '' }
                  return (
                    <tr key={key}>
                      <td style={tdStyle}>
                        <button className="link-btn" onClick={() => onViewDetail(u.row.project_id)}>{u.row.project_name}</button>
                      </td>
                      <td style={tdStyle}>{u.row.customer_name}</td>
                      <td style={tdStyle}>{u.scheduleDayLabel}</td>
                      <td style={tdStyle}>{u.round}/{u.totalRounds}回目</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{fmtYen(u.amount)}</td>
                      <td style={tdStyle}>
                        <input type="date" {...dateInputRange()} className="form-input" style={{ padding: '5px 8px', fontSize: 13 }}
                          value={inp.billing_date}
                          onChange={e => setIssueInputs(prev => ({ ...prev, [key]: { ...inp, billing_date: e.target.value } }))} />
                      </td>
                      <td style={tdStyle}>
                        <input type="date" {...dateInputRange()} className="form-input" style={{ padding: '5px 8px', fontSize: 13 }}
                          value={inp.payment_due_date}
                          onChange={e => setIssueInputs(prev => ({ ...prev, [key]: { ...inp, payment_due_date: e.target.value } }))} />
                      </td>
                      <td style={tdStyle}>
                        <button className="btn btn-main btn-sm" disabled={saving || !inp.billing_date} onClick={() => handleIssue(u)}>
                          発行
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

      {/* ── 3. 口座振替（開閉式） ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <button
          style={{ width: '100%', padding: '12px 20px', borderLeft: '4px solid #8b5cf6', background: '#fff', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left' }}
          onClick={() => setShowWithdrawal(p => !p)}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed' }}>
            口座振替（常時）
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#94a3b8' }}>{withdrawalRows.length}件</span>
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{showWithdrawal ? '▲ 閉じる' : '▼ 開く'}</span>
        </button>
        {showWithdrawal && (withdrawalRows.length === 0 ? (
          <div style={{ padding: '20px 24px', color: '#94a3b8', fontSize: 13 }}>口座振替の発電所はありません</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
              <thead>
                <tr>
                  <th style={thStyle}>発電所</th>
                  <th style={thStyle}>顧客</th>
                  <th style={thStyle}>引落日</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>今月の月額（税込）</th>
                  <th style={thStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {withdrawalRows.map(r => {
                  const day = r.contract?.billing_schedule_days?.[0] ?? '—'
                  const monthly = withdrawalAmount(r.contract, currentMonth)
                  // 今月の振替失敗が立ってるか
                  const failKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`
                  const failed = r.records.some(rec => rec.transfer_failed && rec.billing_scheduled_date === failKey)
                  return (
                    <tr key={r.project_id} style={failed ? { background: '#fef2f2' } : undefined}>
                      <td style={tdStyle}>
                        <button className="link-btn" onClick={() => onViewDetail(r.project_id)}>{r.project_name}</button>
                      </td>
                      <td style={tdStyle}>{r.customer_name}</td>
                      <td style={tdStyle}>{day}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{fmtYen(monthly)}</td>
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
        ))}
      </div>

      {/* ── 4. 入金済（今年度） ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <button
          style={{ width: '100%', padding: '12px 20px', borderLeft: '4px solid #10b981', background: '#fff', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left' }}
          onClick={() => setShowPaid(p => !p)}
        >
          <span style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>
            入金済
            <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 400, color: '#94a3b8' }}>{paidItems.length}件</span>
          </span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{showPaid ? '▲ 閉じる' : '▼ 開く'}</span>
        </button>
        {showPaid && (
          paidItems.length === 0 ? (
            <div style={{ padding: '20px 24px', color: '#94a3b8', fontSize: 13 }}>入金済の案件はありません</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', whiteSpace: 'nowrap' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>発電所</th>
                    <th style={thStyle}>顧客</th>
                    <th style={thStyle}>回数</th>
                    <th style={thStyle}>請求日</th>
                    <th style={thStyle}>入金日</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>金額（税込）</th>
                  </tr>
                </thead>
                <tbody>
                  {paidItems.map(item => {
                    const c = item.row.contract
                    let amount: number | null = null
                    if (item.payment && item.totalRounds) {
                      amount = invoiceAmount(c, item.payment.seq, item.totalRounds)
                    } else if (item.record.line_items) {
                      amount = item.record.line_items.reduce((s, i) => s + i.amount, 0)
                    } else if (item.record.transfer_failed && item.record.billing_scheduled_date) {
                      const m = Number(item.record.billing_scheduled_date.slice(5, 7))
                      amount = withdrawalAmount(c, m)
                    } else if (item.record.billing_scheduled_date && c?.billing_method === '請求書') {
                      const days = c?.billing_schedule_days ?? []
                      const idx = days.findIndex(d => toIsoDate(item.record.year, d) === item.record.billing_scheduled_date)
                      if (idx >= 0) amount = invoiceAmount(c, idx + 1, days.length)
                    }
                    return (
                      <tr key={`${item.record.id}:${item.payment?.seq ?? 0}`}>
                        <td style={tdStyle}>
                          <button className="link-btn" onClick={() => onViewDetail(item.row.project_id)}>{item.row.project_name}</button>
                        </td>
                        <td style={tdStyle}>{item.row.customer_name}</td>
                        <td style={tdStyle}>{item.payment && item.totalRounds ? `${item.payment.seq}/${item.totalRounds}回目` : '—'}</td>
                        <td style={tdStyle}>{item.payment?.billing_date ?? item.record.billing_date ?? '—'}</td>
                        <td style={{ ...tdStyle, color: '#059669', fontWeight: 600 }}>{item.payment?.received_date ?? item.record.received_date}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{amount != null ? fmtYen(amount) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      <div style={{ fontSize: 11, color: '#94a3b8', padding: '4px 8px' }}>
        金額・スケジュール・手数料は <b>発電所タブ &gt; 請求情報</b> から設定してください。
      </div>
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
