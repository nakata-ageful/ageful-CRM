import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { PGlite } from '@electric-sql/pglite'
import { createInvoiceTestDb } from './invoice-test-db'
import '../styles.css'

type Mode = 'plan' | 'issue' | 'collection' | 'correction'
type Unit = { id: number; service_year: number; revision: number; lifecycle: string;
  recipient_customer_id: number | null; scheduled_date: string | null; issued_on: string | null;
  received_on: string | null; payment_due_on: string | null; frozen_amount: number | null;
  frozen_line_items: { name: string; amount: number }[] | null }
type Event = { id: number; event_type: string; recorded_at: string; reason: string | null;
  before_value: Unit; after_value: Unit }
const names = (id: number | null) => id === 1 ? '顧客A' : id === 2 ? '顧客B' : '請求先要確認'
const yen = (n: number | null) => n == null ? '未確定' : `${n.toLocaleString()}円`
const labels: Record<Mode, string> = { plan: '予定を保存', issue: '発行', collection: '入金確認', correction: '訂正を保存' }
const eventLabels: Record<string, string> = { plan_changed: '予定を保存', issued: '発行', collection_recorded: '入金確認', corrected: '訂正' }

function InvoiceDbPreview() {
  const [db, setDb] = useState<PGlite | null>(null)
  const [units, setUnits] = useState<Unit[]>([])
  const [events, setEvents] = useState<Event[]>([])
  const [selected, setSelected] = useState<Unit | null>(null)
  const [mode, setMode] = useState<Mode>('plan')
  const [payer, setPayer] = useState('1')
  const [scheduled, setScheduled] = useState('')
  const [issued, setIssued] = useState('')
  const [received, setReceived] = useState('')
  const [due, setDue] = useState('')
  const [items, setItems] = useState([{ name: '保守料', amount: '82500' }])
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState('確認画面を準備しています…')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const alive = useRef(true)

  async function reload(client: PGlite) {
    // JSON dates use YYYY-MM-DD consistently with the RPC payload and audit snapshots.
    const rows = await client.query<{ unit: Unit }>('select to_jsonb(u) as unit from billing_units u order by scheduled_date nulls last,id')
    const history = await client.query<Event>('select * from billing_unit_events order by id desc')
    const current = rows.rows.map(r => r.unit)
    if (alive.current) { setUnits(current); setEvents(history.rows) }
    return current
  }
  useEffect(() => {
    let instance: PGlite | null = null
    alive.current = true
    void createInvoiceTestDb().then(async client => {
      instance = client
      if (!alive.current) { await client.close(); return }
      await reload(client)
      if (alive.current) { setDb(client); setMessage('対象の請求の「予定を編集」から操作できます。') }
    }).catch(e => { if (alive.current) { setError(String(e)); setMessage('準備に失敗しました。再読み込みしてください。') } })
    return () => { alive.current = false; if (instance) void instance.close() }
  }, [])

  function edit(unit: Unit, nextMode: Mode) {
    setSelected(unit); setMode(nextMode); setPayer(unit.recipient_customer_id?.toString() ?? '')
    setScheduled(unit.scheduled_date ?? ''); setIssued(unit.issued_on ?? unit.scheduled_date ?? '')
    setReceived(unit.received_on ?? ''); setDue(unit.payment_due_on ?? '')
    setItems(unit.frozen_line_items?.map(i => ({ name: i.name, amount: String(i.amount) })) ?? [{ name: '保守料', amount: '82500' }])
    setReason(''); setError('')
  }
  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!db || !selected || busy.current) return
    busy.current = true; setSaving(true); setError('')
    try {
      let value: object
      if (mode === 'plan') value = { recipient_customer_id: payer ? Number(payer) : null, scheduled_date: scheduled || null }
      else if (mode === 'collection') value = { received_on: received || null }
      else {
        const lines = items.map(i => ({ name: i.name.trim(), amount: Number(i.amount.replace(/,/g, '')) }))
        if (!lines.length || items.some(i => !i.amount.trim()) || lines.some(i => !i.name || !Number.isSafeInteger(i.amount) || i.amount < 0)) {
          throw new Error('明細名と金額を入力してください。')
        }
        const total = lines.reduce((n, i) => n + i.amount, 0)
        if (!Number.isSafeInteger(total)) throw new Error('合計金額が大きすぎます。')
        value = { recipient_customer_id: payer ? Number(payer) : null, scheduled_date: scheduled || null,
          frozen_amount: total, frozen_line_items: lines, issued_on: issued || null,
          received_on: mode === 'issue' ? null : received || null, payment_due_on: due || null }
      }
      await db.query('select public.write_invoice_unit($1,$2,$3,$4,$5::jsonb,$6)',
        [crypto.randomUUID(), selected.id, selected.revision, mode, JSON.stringify(value), mode === 'correction' ? reason : null])
      const rows = await reload(db)
      const updated = rows.find(u => u.id === selected.id)!
      setMessage(`${selected.service_year}年：「${labels[mode]}」が完了しました。下の変更履歴にも保存されています。`)
      edit(updated, updated.lifecycle === 'planned' ? 'plan' : updated.lifecycle === 'issued' ? 'collection' : 'correction')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { busy.current = false; setSaving(false) }
  }
  const dateInput = (label: string, v: string, set: (v: string) => void, required = false) =>
    <label className="form-group"><span className="form-label">{label}</span>
      <input className="form-input" type="date" value={v} onInput={e => set(e.currentTarget.value)} onChange={e => set(e.target.value)} required={required} /></label>

  return <main style={{ maxWidth: 1100, margin: '24px auto', padding: '0 20px', display: 'grid', gap: 18 }}>
    <div className="notice">架空データ専用の確認画面です。本番の請求や顧客は変更しません。保存先はこの画面内の検証用DBで、再読み込みすると初期状態に戻ります。</div>
    <h1 style={{ fontSize: 24, margin: 0 }}>サンプル発電所 ― 請求詳細</h1>
    <p role="status" style={{ margin: 0 }}>{message}</p>
    {error && <div role="alert" style={{ color: '#b91c1c', background: '#fef2f2', padding: 12 }}>{error}</div>}
    {([['planned', '請求予定'], ['issued', '未入金'], ['received', '入金済']] as const).map(([state, label]) =>
      <section className="card" key={state} style={{ padding: 18 }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>{label}（{units.filter(u => u.lifecycle === state).length}件）</h2>
        {!units.some(u => u.lifecycle === state) ? <p style={{ color: '#64748b' }}>該当する請求はありません。</p> :
          <table style={{ width: '100%', textAlign: 'left' }}><thead><tr>{['年度', '請求予定日', '請求先', '金額（税込）', '入金日', '操作'].map(t => <th key={t}>{t}</th>)}</tr></thead>
            <tbody>{units.filter(u => u.lifecycle === state).map(unit => <tr key={unit.id}>
              <td>{unit.service_year}年 第1回</td><td>{unit.scheduled_date ?? '未設定'}</td><td>{names(unit.recipient_customer_id)}</td>
              <td>{yen(unit.frozen_amount)}</td><td>{unit.received_on ?? '—'}</td><td style={{ display: 'flex', gap: 8, padding: 8 }}>
                <button disabled={saving} className="btn btn-main btn-sm" onClick={() => edit(unit, state === 'planned' ? 'plan' : state === 'issued' ? 'collection' : 'correction')}>
                  {state === 'planned' ? '予定を編集' : state === 'issued' ? '入金確認' : '訂正'}</button>
                {state === 'issued' && <button disabled={saving} className="btn btn-sub btn-sm" onClick={() => edit(unit, 'correction')}>訂正</button>}
              </td></tr>)}</tbody></table>}
      </section>)}
    {selected && <section className="card" style={{ padding: 20 }}>
      <h2 style={{ fontSize: 18 }}>{selected.service_year}年 第1回：{labels[mode]}</h2>
      <form onSubmit={save}><fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0 }}>
        {mode === 'collection' ? <>
          <p>請求先：{names(selected.recipient_customer_id)} ／ 確定額：{yen(selected.frozen_amount)}</p>
          {dateInput('入金日', received, setReceived, true)}
        </> : <>
          <label className="form-group"><span className="form-label">請求先</span><select className="form-input" value={payer} onChange={e => setPayer(e.target.value)} required={mode !== 'plan'}>
            <option value="">請求先要確認</option><option value="1">顧客A</option><option value="2">顧客B</option></select></label>
          {dateInput('請求予定日', scheduled, setScheduled)}
          {mode === 'plan' ? <p>金額は未確定のまま予定を保存できます。保存後も「請求予定」に残ります。この指定は選んだ1回だけに適用します。</p> : <>
            {dateInput('請求日', issued, setIssued, mode === 'issue')}
            {dateInput('入金予定日', due, setDue)}
            {mode === 'correction' && dateInput('入金日', received, setReceived)}
            <h3 style={{ fontSize: 15 }}>金額明細</h3>
            {items.map((item, i) => <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <label style={{ flex: 1 }}>明細名<input aria-label={`明細名${i + 1}`} className="form-input" required value={item.name}
                onChange={e => setItems(items.map((v, n) => n === i ? { ...v, name: e.target.value } : v))} /></label>
              <label style={{ flex: 1 }}>金額（税込）<input aria-label={`金額${i + 1}`} className="form-input" required inputMode="numeric" value={item.amount}
                onChange={e => setItems(items.map((v, n) => n === i ? { ...v, amount: e.target.value } : v))} /></label>
              <button type="button" className="btn btn-sub" disabled={items.length === 1} onClick={() => setItems(items.filter((_, n) => n !== i))}>削除</button>
            </div>)}
            <button type="button" className="btn btn-sub" onClick={() => setItems([...items, { name: '', amount: '' }])}>明細を追加</button>
          </>}
        </>}
        {mode === 'correction' && <label className="form-group" style={{ marginTop: 12 }}><span className="form-label">訂正理由</span>
          <textarea className="form-input" required value={reason} onChange={e => setReason(e.target.value)} /></label>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn btn-main" disabled={!db}>{saving ? '保存中…' : labels[mode]}</button>
          {mode === 'plan' && <button className="btn btn-sub" type="button" onClick={() => setMode('issue')}>発行の入力へ</button>}
          <button className="btn btn-sub" type="button" onClick={() => setSelected(null)}>閉じる</button>
        </div>
      </fieldset></form>
    </section>}
    <section className="card" style={{ padding: 20 }}><h2 style={{ fontSize: 18 }}>変更履歴</h2>
      {!events.length && <p>まだ変更はありません。</p>}
      {events.map(event => <details key={event.id} style={{ padding: '10px 0', borderBottom: '1px solid #e2e8f0' }}>
        <summary>{event.after_value.service_year}年：{eventLabels[event.event_type]} ／ {new Date(event.recorded_at).toLocaleString('ja-JP')}</summary>
        <p>担当者：確認用ユーザー{event.reason && ` ／ 訂正理由：${event.reason}`}</p>
        <p>請求先：{names(event.before_value.recipient_customer_id)} → {names(event.after_value.recipient_customer_id)}</p>
        <p>金額：{yen(event.before_value.frozen_amount)} → {yen(event.after_value.frozen_amount)}</p>
        <p>請求予定日：{event.before_value.scheduled_date ?? '未設定'} → {event.after_value.scheduled_date ?? '未設定'} ／ 入金日：{event.before_value.received_on ?? '未登録'} → {event.after_value.received_on ?? '未登録'}</p>
      </details>)}
    </section>
  </main>
}

if (import.meta.env.DEV) createRoot(document.getElementById('root')!).render(<InvoiceDbPreview />)
