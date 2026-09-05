import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Modal } from '../components/Modal'
import { BillingUnitTable } from '../components/BillingUnitTable'
import { applyInvoiceRecipientPlan, issueInvoiceUnit, recipientForUnit, upcomingInvoiceUnits, type BillingUnit, type RecipientPlan } from '../lib/billing-unit'
import { fmtYen } from '../lib/utils'
import '../styles.css'

// 架空データ専用。actions/data/supabase/Appを取り込まない。再読込するとリセット。
const names: Record<number, string> = { 1: '顧客A（旧所有者）', 2: '顧客B', 3: '顧客C' }
const name = (id: number) => names[id] ?? '請求先要確認'
const seed = (year: number, fixed = false): BillingUnit => ({
  id: `demo-${year}-annual`, projectId: 1, serviceYear: year, roundLabel: '第1回', method: '請求書',
  scheduledDate: `${year}-06-01`, recipientId: 1, lifecycle: fixed ? 'fixed' : 'planned',
  issuedOn: fixed ? `${year}-06-01` : null, receivedOn: null, frozenAmount: fixed ? 100000 : null,
  frozenLineItems: fixed ? [{ name: '保守料', amount: 100000 }] : null,
  frozenAt: fixed ? `${year}-06-01T00:00:00Z` : null, revision: 1,
})

function Preview() {
  const [units, setUnits] = useState<BillingUnit[]>([seed(2026, true), seed(2027), seed(2028)])
  const [ownerId, setOwnerId] = useState(1)
  const [plan, setPlan] = useState<RecipientPlan>({ projectId: 1, defaultRecipientId: 1, overrides: {} })
  const [annualAmount, setAnnualAmount] = useState(100000)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'settings' | 'confirm'>('settings')
  const [newOwner, setNewOwner] = useState(2)
  const [transferDate, setTransferDate] = useState('2026-09-05')
  const [nextRecipient, setNextRecipient] = useState(1)
  const [laterRecipient, setLaterRecipient] = useState(2)
  const [message, setMessage] = useState('')
  const next = upcomingInvoiceUnits(units)[0]
  const proposed: RecipientPlan = { projectId: 1, defaultRecipientId: laterRecipient,
    overrides: next ? { ...plan.overrides, [next.id]: nextRecipient } : { ...plan.overrides } }
  const [confirmed, setConfirmed] = useState<{ plan: RecipientPlan; expected: Record<string, number> } | null>(null)
  const reviewUnits = units.map(unit => ({ ...unit, recipientId: recipientForUnit(unit, proposed) }))

  function startTransfer() {
    setNewOwner(ownerId === 2 ? 3 : 2)
    setNextRecipient(next?.recipientId ?? ownerId)
    setLaterRecipient(ownerId === 2 ? 3 : 2)
    setStep('settings'); setOpen(true)
  }
  function apply() {
    if (!confirmed) return
    try {
      const changed = applyInvoiceRecipientPlan(units, confirmed.plan, confirmed.expected)
      setUnits(changed); setPlan(confirmed.plan); setOwnerId(newOwner); setOpen(false)
      setMessage('この画面内だけに反映しました。本番の所有者・請求・契約は変更していません。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '確認し直してください'); setOpen(false) }
  }
  function addYear() {
    const year = Math.max(...units.map(u => u.serviceYear)) + 1
    const unit = seed(year)
    setUnits([...units, { ...unit, recipientId: recipientForUnit(unit, plan) }])
  }
  const select = (label: string, value: number, set: (v: number) => void) => <label className="form-group">
    <span className="form-label">{label}</span><select className="form-input" value={value} onChange={e => set(Number(e.target.value))}>
      {Object.entries(names).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select>
  </label>

  return <main style={{ maxWidth: 1200, margin: '24px auto', padding: '0 20px', display: 'grid', gap: 16 }}>
    <div className="notice">ローカル検証専用・架空データです。本番DBへの接続・保存・請求書送信はしません。再読込で初期状態に戻ります。</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ flex: 1 }}><h1 style={{ margin: 0, fontSize: 23 }}>サンプル発電所</h1><p>現在の所有者：{name(ownerId)}</p></div>
      <button className="btn btn-main" onClick={startTransfer}>所有者を変更</button>
    </div>
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', color: '#64748b', borderBottom: '1px solid #e2e8f0', paddingBottom: 12 }}>
      {['基本情報', '設備情報', '契約情報', '保守情報', '保守対応', '請求情報', '請求詳細', 'その他'].map(tab =>
        <span key={tab} style={{ color: tab === '請求詳細' ? '#0284c7' : undefined, fontWeight: tab === '請求詳細' ? 700 : 400 }}>{tab}</span>)}
    </div>
    {message && <div role="status" className="notice">{message}</div>}
    <div className="card" style={{ padding: 20 }}><h2 style={{ fontSize: 17 }}>今回の請求</h2>
      <p>2026年 第1回・顧客A（旧所有者）・100,000円・発行済／未入金</p>
      <small>所有者変更で未入金の請求先・金額は変わりません。「今回の請求」の既存の意味は維持します。</small>
    </div>
    <div className="card" style={{ padding: 20 }}><h2 style={{ fontSize: 17 }}>請求スケジュール・請求先</h2>
      <p>次回：{next ? `${next.scheduledDate}・${name(next.recipientId!)}` : '未発行の予定なし'} ／ 今後の既定：{name(plan.defaultRecipientId)}</p>
      <BillingUnitTable units={units} recipientName={name} plannedAmount={() => annualAmount} />
    </div>
    <div className="card" style={{ padding: 20 }}><h2 style={{ fontSize: 17 }}>動作確認用（完成画面には出さない操作）</h2>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="form-group"><span className="form-label">今後の年次保守料（税込）</span><select className="form-input" value={annualAmount} onChange={e => setAnnualAmount(Number(e.target.value))}>
          <option value={100000}>100,000円</option><option value={120000}>120,000円</option>
        </select></label>
        <button className="btn btn-ghost" onClick={addYear}>翌年の予定を追加して確認</button>
        <button className="btn btn-main" disabled={!next} onClick={() => {
          if (!next) return
          const issued = issueInvoiceUnit(next, next.revision, { issuedOn: next.scheduledDate!, amount: annualAmount,
            lineItems: [{ name: '保守料', amount: annualAmount }], frozenAt: `${next.scheduledDate}T00:00:00Z` })
          setUnits(units.map(u => u.id === issued.id ? issued : u))
          // 消費済み例外は次回へ移さない。既定先は継続。
          const overrides = { ...plan.overrides }; delete overrides[issued.id]
          setPlan({ ...plan, overrides })
          setMessage('選んだ回を発行済みにしました（画面内のテストのみ）。以降の金額変更では、この回の確定額は変わりません。')
        }}>次回を発行済みにして確認</button>
      </div>
      <p style={{ color: '#64748b' }}>未実装：本番保存、契約項目の変更、口座振替の固定境界、訂正、顧客別履歴、移転履歴の永続保存。</p>
    </div>
    {open && <Modal title={step === 'settings' ? '所有者を変更' : '所有者変更の確認'} onClose={() => setOpen(false)} width={800}>
      <p className="notice">画面内の動作確認です。実際の変更・発行・送信・引落口座変更は行いません。</p>
      {step === 'settings' ? <form onSubmit={e => {
        e.preventDefault()
        setConfirmed({ plan: proposed, expected: Object.fromEntries(upcomingInvoiceUnits(units).map(u => [u.id, u.revision])) })
        setStep('confirm')
      }}>
        {select('新しい所有者', newOwner, setNewOwner)}
        <label className="form-group"><span className="form-label">所有者変更日</span><input required type="date" className="form-input" value={transferDate} onChange={e => setTransferDate(e.target.value)} /></label>
        <p>保守・請求条件：そのまま引き継ぐ（条件変更は今回の検証対象外）</p>
        <p>次の未発行の請求：{next?.scheduledDate}・{next?.roundLabel}・予定額 {fmtYen(annualAmount)}</p>
        {select('次回の請求先', nextRecipient, setNextRecipient)}
        {select('その次からの請求先', laterRecipient, setLaterRecipient)}
        <p>発行済みの2026年分は、顧客Aのまま残します。</p>
        <div style={{ display: 'flex', justifyContent: 'end', gap: 12 }}><button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>キャンセル</button>
          <button className="btn btn-main" disabled={newOwner === ownerId || !next}>確認へ</button></div>
      </form> : <>
        <p>{name(ownerId)} → {name(newOwner)} ／ 所有者変更日：{transferDate}</p>
        <p>その次からの請求先：{name(laterRecipient)}（翌年以降も継続）</p>
        <BillingUnitTable units={reviewUnits} recipientName={name} plannedAmount={() => annualAmount} />
        <p>発行済み・入金済みの請求は変更しません。保守条件はそのままです。</p>
        <div style={{ display: 'flex', justifyContent: 'end', gap: 12 }}><button className="btn btn-ghost" onClick={() => setStep('settings')}>設定に戻る</button>
          <button className="btn btn-main" onClick={apply}>この画面内だけに反映</button></div>
      </>}
    </Modal>}
  </main>
}

// 通常の本番ビルドはこのHTMLを入口に含めない。万一読み込まれてもDEV以外は起動しない。
if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<Preview />)
