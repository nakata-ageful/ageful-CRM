import { useState, useMemo, useRef } from 'react'
import type { Prospect, ProspectApplyStatus, ProspectContractStatus, ProspectInput, Customer } from '../types'
import { createProspect, deleteProspect } from '../lib/actions'
import { fmtNum, dateInputRange } from '../lib/utils'
import { useToast } from '../components/Toast'
import {prospectCustomerId,ownershipProspectLabel} from '../lib/ownership-workflow'
import {prospectCustomerDisplay} from '../lib/prospect-customer-display'

const APPLY_STATUSES: ProspectApplyStatus[] = ['未', '提出済', '通過', '不通', '不可']
const CONTRACT_STATUSES: ProspectContractStatus[] = ['未', '完了', '不可']

/** スペースを全て除去して正規化 */
function normalizeName(name: string): string {
  return name.replace(/[\s\u3000]/g, '')
}

type ExistingCustomerOption = {
  id: number
  name: string
  name_kana: string
  is_corporate: boolean
  company_name: string
  company_name_kana?: string
  source: 'prospect' | 'customer'
}

function ApplyBadge({ status }: { status: ProspectApplyStatus }) {
  return <span className={`prospect-badge prospect-apply-${status}`}>{status}</span>
}

function ContractBadge({ status }: { status: ProspectContractStatus }) {
  return <span className={`prospect-badge prospect-contract-${status}`}>{status}</span>
}

function AddModal({ onSave, onClose, existingCustomers, newProspectReady }: {
  onSave: (input: ProspectInput, operationKey: string) => Promise<void>
  onClose: () => void
  existingCustomers: ExistingCustomerOption[]
  newProspectReady?: boolean
}) {
  const [mode, setMode] = useState<'new' | 'existing' | 'undecided'>('new')
  const [customerType, setCustomerType] = useState<'' | 'individual' | 'corporate'>('')
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [comboOpen, setComboOpen] = useState(false)
  const [form, setForm] = useState<ProspectInput>({
    customer_name: '', customer_name_kana: '', project_name: '', loan_company: '',
    equipment: '', land_cost: '', loan_amount: '',
    site_address: '', panel_kw: '', sales_company: '', referrer: '', lead_date: '',
    is_corporate: false, company_name: '', company_name_kana: '',
  })
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const operationRef = useRef<{ signature: string; key: string } | null>(null)
  const uncertainRef = useRef(false)
  const [uncertain, setUncertain] = useState(false)
  const [checkList, setCheckList] = useState(false)
  const [error, setError] = useState('')
  const set = (k: keyof ProspectInput, v: string) => { if (!uncertainRef.current) setForm(f => ({ ...f, [k]: v })) }

  function handleSelectExisting(value: string) {
    if (savingRef.current || uncertainRef.current) return
    setSelectedCustomer(value)
    const id = Number(value)
    const cust = existingCustomers.find(c => c.id === id)
    if (cust) {
      const label = cust.is_corporate && cust.company_name
        ? `${cust.company_name} / ${cust.name}${cust.name_kana ? ` (${cust.name_kana})` : ''}`
        : `${cust.name}${cust.name_kana ? ` (${cust.name_kana})` : ''}`
      setCustomerSearch(label)
      setComboOpen(false)
      setForm(f => ({
        ...f,
        customer_name: cust.name,
        customer_name_kana: cust.name_kana,
        company_name: cust.company_name,
        company_name_kana: cust.company_name_kana ?? '',
        is_corporate: cust.is_corporate,
        existing_customer_id: cust.id,
      }))
    }
  }

  function handleModeChange(newMode: 'new' | 'existing' | 'undecided') {
    if (savingRef.current || uncertainRef.current || checkList || (newMode === 'undecided' && !newProspectReady)) return
    setMode(newMode)
    setError('')
    setCustomerSearch('')
    setComboOpen(false)
    setSelectedCustomer('')
    setForm(f => ({ ...f, customer_name: '', customer_name_kana: '', company_name: '', company_name_kana: '',
      is_corporate: newMode === 'new' && customerType === 'corporate', existing_customer_id: undefined }))
  }

  function handleCustomerTypeChange(t: 'individual' | 'corporate') {
    if (savingRef.current || uncertainRef.current || customerType === t) return
    setCustomerType(t)
    setForm(f => ({ ...f, is_corporate: t === 'corporate', company_name: '', company_name_kana: '' }))
  }

  async function handleSave() {
    if (savingRef.current || checkList || !form.project_name.trim()) return
    if (mode === 'undecided' && !newProspectReady) return
    if (mode === 'new' && !customerType) return
    if (mode !== 'undecided' && !form.customer_name.trim()) return
    if (mode === 'existing' && (!selectedCustomer || !form.existing_customer_id)) return
    if (mode === 'new' && customerType === 'corporate' && !(form.company_name ?? '').trim()) return
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      const input = { ...form, customer_undecided: mode === 'undecided',
        ...(mode === 'undecided' ? { customer_name: '', customer_name_kana: '', company_name: '', company_name_kana: '', is_corporate: false, existing_customer_id: undefined }
          : mode === 'new' ? { existing_customer_id: undefined } : {}) }
      // This field belongs to customers, not the strict undecided-prospect RPC.
      if (mode === 'undecided') delete input.company_name_kana
      const signature = JSON.stringify(input)
      if (!operationRef.current || operationRef.current.signature !== signature) {
        if (uncertainRef.current) throw Error('前回と同じ内容で保存結果を確認してください')
        operationRef.current = { signature, key: crypto.randomUUID() }
      }
      await onSave(input, operationRef.current.key)
      uncertainRef.current = false
      setUncertain(false)
      setCheckList(false)
    } catch (e) {
      const code = typeof e === 'object' && e && 'code' in e ? String(e.code) : ''
      const rejected = /^(22|23|42)/.test(code) || code === 'P0001'
      uncertainRef.current = mode === 'undecided' && !rejected
      setUncertain(uncertainRef.current)
      setCheckList(mode !== 'undecided' && !rejected)
      setError(e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  function close() {
    if (savingRef.current) return
    if (uncertainRef.current) { setError('保存結果が未確認です。再読み込みせず、下のボタンで同じ内容の保存結果を確認してください'); return }
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-box" role="dialog" aria-modal="true" aria-label="案件を追加" style={{ maxWidth: 560, overflow: 'hidden' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <h2 className="modal-title">案件を追加</h2>
          <button className="modal-close" disabled={saving || uncertain} onClick={close}>✕</button>
        </div>
        <div className="modal-body" style={{ minHeight: 0 }}>
          {error && <p className="form-error" role="alert">{error}</p>}
          {uncertain && <p role="alert">保存結果が未確認です。再読み込みや別の登録をせず、同じ内容で保存結果を確認してください。</p>}
          {checkList && <p role="alert">保存結果が未確認です。再保存せず、この画面を閉じて見込み・顧客の一覧を確認してください。</p>}
          <fieldset disabled={saving || uncertain || checkList} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {/* 既存/新規/顧客未定切り替え */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            <button
              className={`filter-tab ${mode === 'existing' ? 'active' : ''}`}
              onClick={() => handleModeChange('existing')}
            >
              既存顧客
            </button>
            <button
              className={`filter-tab ${mode === 'new' ? 'active' : ''}`}
              onClick={() => handleModeChange('new')}
            >
              新規顧客
            </button>
            <button
              className={`filter-tab ${mode === 'undecided' ? 'active' : ''}`}
              disabled={!newProspectReady}
              onClick={() => handleModeChange('undecided')}
            >
              顧客未定
            </button>
          </div>
          {!newProspectReady && <p>顧客未定の登録は準備中です</p>}

          <div className="form-grid">
            {mode === 'existing' ? (
              <>
                <label className="form-label required" style={{ gridColumn: '1/-1', position: 'relative' }}>
                  顧客を選択（入力で絞り込み）
                  <input
                    className="form-input"
                    value={customerSearch}
                    placeholder="会社名・氏名・フリガナで検索"
                    onFocus={() => setComboOpen(true)}
                    onChange={e => {
                      setCustomerSearch(e.target.value)
                      setComboOpen(true)
                      // 入力を変更したら既存の選択を解除（新しい候補を選び直す前提）
                      if (selectedCustomer) {
                        setSelectedCustomer('')
                        setForm(f => ({ ...f, customer_name: '', customer_name_kana: '', company_name: '', company_name_kana: '', existing_customer_id: undefined }))
                      }
                    }}
                    onBlur={() => {
                      // クリック確定を捕まえるため少し遅延してから閉じる
                      setTimeout(() => setComboOpen(false), 150)
                    }}
                  />
                  {comboOpen && (() => {
                    const q = customerSearch.trim().toLowerCase()
                    const filtered = q && !selectedCustomer
                      ? existingCustomers.filter(c =>
                          c.name.toLowerCase().includes(q) ||
                          c.name_kana.toLowerCase().includes(q) ||
                          c.company_name.toLowerCase().includes(q) ||
                          (c.company_name_kana ?? '').toLowerCase().includes(q)
                        )
                      : existingCustomers
                    return (
                      <div style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        zIndex: 20,
                        marginTop: 2,
                        background: '#fff',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        maxHeight: 260,
                        overflowY: 'auto',
                        boxShadow: '0 4px 12px rgba(15,23,42,0.08)',
                      }}>
                        {filtered.length === 0 ? (
                          <div style={{ padding: '10px 12px', fontSize: 13, color: '#94a3b8' }}>該当なし</div>
                        ) : (
                          filtered.map(c => {
                            const label = c.is_corporate && c.company_name
                              ? `${c.company_name} / ${c.name}${c.name_kana ? ` (${c.name_kana})` : ''}`
                              : `${c.name}${c.name_kana ? ` (${c.name_kana})` : ''}`
                            return (
                              <div
                                key={c.id}
                                onMouseDown={e => { e.preventDefault(); handleSelectExisting(String(c.id)) }}
                                style={{
                                  padding: '8px 12px',
                                  fontSize: 13,
                                  cursor: 'pointer',
                                  borderBottom: '1px solid #f1f5f9',
                                  background: String(c.id) === selectedCustomer ? '#eff6ff' : 'transparent',
                                }}
                                onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                onMouseLeave={e => (e.currentTarget.style.background = String(c.id) === selectedCustomer ? '#eff6ff' : 'transparent')}
                              >
                                {label}
                              </div>
                            )
                          })
                        )}
                      </div>
                    )
                  })()}
                </label>
                {selectedCustomer && form.is_corporate && (
                  <>
                    <div className="info-field"><span>会社名</span><b>{form.company_name || '-'}</b></div>
                    <div className="info-field"><span>会社名フリガナ</span><b>{form.company_name_kana || '未登録'}</b></div>
                  </>
                )}
                {selectedCustomer && (
                  <>
                    <label className="form-label">
                      {form.is_corporate ? '担当者名' : '顧客名'}
                      <input
                        className="form-input"
                        value={form.customer_name}
                        readOnly
                        style={{ background: '#f1f5f9' }}
                      />
                    </label>
                    <label className="form-label">
                      {form.is_corporate ? '担当者フリガナ' : 'フリガナ'}
                      <input
                        className="form-input"
                        value={form.customer_name_kana}
                        onChange={e => set('customer_name_kana', e.target.value)}
                        placeholder="やまだ たろう"
                      />
                    </label>
                  </>
                )}
              </>
            ) : mode === 'new' ? (
              <>
                <div role="group" aria-label="新規顧客の種別" style={{ display: 'flex', gap: 8, gridColumn: '1/-1' }}>
                  <button
                    type="button"
                    className={`filter-tab ${customerType === 'individual' ? 'active' : ''}`}
                    aria-pressed={customerType === 'individual'}
                    onClick={() => handleCustomerTypeChange('individual')}
                  >
                    個人
                  </button>
                  <button
                    type="button"
                    className={`filter-tab ${customerType === 'corporate' ? 'active' : ''}`}
                    aria-pressed={customerType === 'corporate'}
                    onClick={() => handleCustomerTypeChange('corporate')}
                  >
                    法人
                  </button>
                </div>
                {!customerType && <p style={{ gridColumn: '1/-1' }}>個人または法人を選んでから、顧客情報を入力してください。</p>}
                {customerType === 'corporate' && (
                  <>
                    <label className="form-label required">会社名<input className="form-input" value={form.company_name ?? ''} onChange={e => set('company_name', e.target.value)} placeholder="株式会社〇〇" /></label>
                    <label className="form-label">会社名フリガナ<input className="form-input" value={form.company_name_kana ?? ''} onChange={e => set('company_name_kana', e.target.value)} placeholder="カブシキガイシャ〇〇" /></label>
                  </>
                )}
                {customerType && <>
                <label className="form-label required">
                  {customerType === 'corporate' ? '担当者名' : '顧客名'}
                  <input className="form-input" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} placeholder="山田 太郎" />
                </label>
                <label className="form-label">
                  {customerType === 'corporate' ? '担当者フリガナ' : 'フリガナ'}
                  <input className="form-input" value={form.customer_name_kana} onChange={e => set('customer_name_kana', e.target.value)} placeholder="やまだ たろう" />
                </label>
                </>}
              </>
            ) : <p style={{ gridColumn: '1/-1' }}>顧客を作らずに新規案件を登録します。顧客が決まったら、この見込みの詳細から設定できます。既存発電所の引継ぎは、発電所詳細の「所有者を変更」から進めてください。</p>}
            <label className="form-label required">
              発電所名
              <input className="form-input" value={form.project_name} onChange={e => set('project_name', e.target.value)} placeholder="鹿嶋市武井" />
            </label>
            <label className="form-label">
              信販利用
              <select className="form-select" value={form.loan_company} onChange={e => set('loan_company', e.target.value)}>
                <option value="">選択してください</option>
                <option value="ジャックス">ジャックス</option>
                <option value="アプラス">アプラス</option>
                <option value="なし">なし</option>
              </select>
            </label>
            <label className="form-label">
              設備代（円）
              <input className="form-input" inputMode="numeric" value={form.equipment} onChange={e => set('equipment', e.target.value)} />
            </label>
            <label className="form-label">
              土地費（円）
              <input className="form-input" inputMode="numeric" value={form.land_cost} onChange={e => set('land_cost', e.target.value)} />
            </label>
            <label className="form-label">
              融資額（円）
              <input className="form-input" inputMode="numeric" value={form.loan_amount} onChange={e => set('loan_amount', e.target.value)} />
            </label>
            <label className="form-label">
              販売会社
              <input className="form-input" value={form.sales_company} onChange={e => set('sales_company', e.target.value)} />
            </label>
            <label className="form-label">
              紹介元
              <input className="form-input" value={form.referrer} onChange={e => set('referrer', e.target.value)} />
            </label>
            <label className="form-label">
              商談開始日
              <input className="form-input" type="date" {...dateInputRange()} value={form.lead_date} onChange={e => set('lead_date', e.target.value)} />
            </label>
          </div>
          </fieldset>
        </div>
          <div className="modal-footer" style={{ position: 'static', flexShrink: 0, margin: 0, padding: '16px 24px 20px', flexWrap: 'wrap' }}>
            <button className="btn btn-sub" disabled={saving || uncertain} onClick={close}>{checkList ? '閉じて一覧を確認' : 'キャンセル'}</button>
            <button className="btn btn-main" onClick={handleSave} disabled={saving || checkList || !form.project_name.trim()
              || (mode === 'undecided' && !newProspectReady)
              || (mode === 'new' && !customerType)
              || (mode !== 'undecided' && !form.customer_name.trim())
              || (mode === 'existing' && (!selectedCustomer || !form.existing_customer_id))
              || (mode === 'new' && customerType === 'corporate' && !(form.company_name ?? '').trim())}>
              {saving ? '保存中...' : uncertain ? '同じ内容で保存結果を確認' : '保存する'}
            </button>
          </div>
      </div>
    </div>
  )
}

export function Prospects({
  prospects,
  customers,
  onReload,
  onViewDetail,
  onViewProject,
  onViewCustomer,
  onViewExistingProject,
  newProspectReady,
}: {
  prospects: Prospect[]
  customers: Customer[]
  onReload: () => void
  onViewDetail: (id: number) => void
  onViewProject: (customerId: number) => void
  onViewCustomer: (customerId: number) => void
  onViewExistingProject?: (projectId:number)=>void
  newProspectReady?: boolean
}) {
  const toast = useToast()
  // 複数選択フィルター: 空配列 = 全件、非空 = OR 条件で絞り込み
  // sessionStorage で詳細画面遷移→戻る時にフィルタを復元
  const [applyFilters, setApplyFilters] = useState<ProspectApplyStatus[]>(() => {
    try {
      const saved = sessionStorage.getItem('prospects_apply_filters')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [contractFilters, setContractFilters] = useState<ProspectContractStatus[]>(() => {
    try {
      const saved = sessionStorage.getItem('prospects_contract_filters')
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })
  const [showAdd, setShowAdd] = useState(false)

  function toggleApply(s: ProspectApplyStatus) {
    setApplyFilters(prev => {
      const next = prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
      sessionStorage.setItem('prospects_apply_filters', JSON.stringify(next))
      return next
    })
  }
  function toggleContract(s: ProspectContractStatus) {
    setContractFilters(prev => {
      const next = prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
      sessionStorage.setItem('prospects_contract_filters', JSON.stringify(next))
      return next
    })
  }

  const filtered = prospects.filter(p =>
    (applyFilters.length === 0 || applyFilters.includes(p.apply_status)) &&
    (contractFilters.length === 0 || contractFilters.includes(p.contract_status))
  )

  // 既存顧客候補（顧客タブ優先 → 見込み補完、重複除去）
  // 既存顧客選択時に顧客IDで紐付けるため、customer源を優先して安定IDを確保する
  const existingCustomers: ExistingCustomerOption[] = useMemo(() => {
    const seen = new Set<string>()
    const result: ExistingCustomerOption[] = []
    // 顧客タブから（IDが確実に存在、法人/個人情報も取れる）
    for (const c of customers) {
      const key = c.is_corporate && c.company_name
        ? `corp:${normalizeName(c.company_name)}:${normalizeName(c.name)}`
        : `ind:${normalizeName(c.name)}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push({
          id: c.id,
          name: c.name,
          name_kana: c.name_kana ?? '',
          is_corporate: c.is_corporate,
          company_name: c.company_name ?? '',
          company_name_kana: c.company_name_kana ?? '',
          source: 'customer',
        })
      }
    }
    // 見込みリストから補完（converted_customer_id があるもの、かつ顧客タブで未取得のもの）
    for (const p of prospects) {
      if (!p.converted_customer_id) continue
      // 既に customer 側で取得済みなら id で重複判定（同一顧客IDは1度だけ）
      if (result.some(r => r.id === p.converted_customer_id)) continue
      const key = `ind:${normalizeName(p.customer_name)}`
      if (!seen.has(key)) {
        seen.add(key)
        result.push({
          id: p.converted_customer_id,
          name: p.customer_name,
          name_kana: p.customer_name_kana ?? '',
          is_corporate: false,
          company_name: '',
          source: 'prospect',
        })
      }
    }
    // 五十音順に並び替え。フリガナがあればそれを優先、無ければ表示名（法人は会社名、個人は氏名）でソート。
    const sortKey = (o: ExistingCustomerOption) =>
      o.name_kana || (o.is_corporate ? o.company_name : o.name)
    result.sort((a, b) => sortKey(a).localeCompare(sortKey(b), 'ja'))
    return result
  }, [prospects, customers])

  async function handleAdd(input: ProspectInput, operationKey: string) {
    try {
      await createProspect(input, operationKey)
      setShowAdd(false)
      onReload()
      toast('見込みを追加しました')
    } catch (e: any) {
      toast(`保存に失敗しました: ${e?.message ?? e}`)
      throw e
    }
  }

  async function handleDelete(e: React.MouseEvent, p: Prospect) {
    e.stopPropagation()
    if (!confirm(`「${prospectCustomerDisplay(p,customers).name} / ${p.project_name}」を削除しますか？`)) return
    await deleteProspect(p.id)
    onReload()
    toast('見込みを削除しました')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* フィルター */}
      <div className="prospect-status-filters">
        <div className="card prospect-status-filter">
          <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.05em' }}>申込</span>
          <button
            className={`filter-tab ${applyFilters.length === 0 ? 'active' : ''}`}
            onClick={() => { setApplyFilters([]); sessionStorage.setItem('prospects_apply_filters', '[]') }}
          >
            すべて
          </button>
          {APPLY_STATUSES.map(s => (
            <button
              key={s}
              className={`filter-tab ${applyFilters.includes(s) ? 'active' : ''}`}
              onClick={() => toggleApply(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="card prospect-status-filter">
          <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.05em' }}>契約</span>
          <button
            className={`filter-tab ${contractFilters.length === 0 ? 'active' : ''}`}
            onClick={() => { setContractFilters([]); sessionStorage.setItem('prospects_contract_filters', '[]') }}
          >
            すべて
          </button>
          {CONTRACT_STATUSES.map(s => (
            <button
              key={s}
              className={`filter-tab ${contractFilters.includes(s) ? 'active' : ''}`}
              onClick={() => toggleContract(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* テーブル */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>{filtered.length} 件</span>
          <button className="btn btn-main btn-sm" onClick={() => setShowAdd(true)}>＋ 案件を追加</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...thStyle, width: '1%', padding: '9px 6px' }}>見込み</th>
                <th style={thStyle}>顧客名</th>
                <th style={thStyle}>発電所名</th>
                <th style={thStyle}>信販利用</th>
                <th style={thStyle}>設備代</th>
                <th style={thStyle}>融資額</th>
                <th style={thStyle}>申込</th>
                <th style={thStyle}>契約</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr
                  key={p.id}
                  className="clickable-row"
                  onClick={() => onViewDetail(p.id)}
                >
                  <td style={{ ...tdStyle, padding: '4px 6px', whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="btn btn-sub btn-sm prospect-detail-button"
                      aria-label={`${p.project_name}の見込み詳細を開く`}
                      onClick={e => {
                        e.stopPropagation()
                        onViewDetail(p.id)
                      }}
                    >詳細</button>
                  </td>
                  <td style={{ ...tdStyle, fontWeight: 600 }} onClick={e => {
                    if (prospectCustomerId(p)) {
                      e.stopPropagation()
                      onViewCustomer(prospectCustomerId(p)!)
                    }
                  }}>
                    {prospectCustomerId(p) ? (
                      <span style={{ color: '#2563eb', cursor: 'pointer', textDecoration: 'underline' }}>{prospectCustomerDisplay(p,customers).name}</span>
                    ) : prospectCustomerDisplay(p,customers).name}
                  </td>
                  <td style={tdStyle} onClick={e => {
                    if(p.new_project_id&&onViewExistingProject){e.stopPropagation();onViewExistingProject(p.new_project_id)}
                    else if(p.ownership_project_id&&onViewExistingProject){e.stopPropagation();onViewExistingProject(p.ownership_project_id)}
                    else if (p.converted_customer_id) {
                      e.stopPropagation()
                      onViewProject(p.converted_customer_id)
                    }
                  }}>
                    {p.converted_customer_id||p.ownership_project_id||p.new_project_id ? (
                      <span style={{ color: '#2563eb', cursor: 'pointer', textDecoration: 'underline' }}>{p.project_name}</span>
                    ) : p.project_name}
                  </td>
                  <td style={tdStyle}>
                    {p.new_project_id!=null&&<span className="prospect-badge">{p.converted_customer_id?'新規案件':'新規案件・顧客未定'}</span>}
                    {p.ownership_project_id&&<span className="prospect-badge">{ownershipProspectLabel(p)}</span>}
                    {p.loan_company && (
                      <span style={{ background: '#e0f2fe', color: '#0369a1', fontSize: 11.5, fontWeight: 600, borderRadius: 99, padding: '2px 8px' }}>
                        {p.loan_company}
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmtNum(p.equipment)}</td>
                  <td style={{ ...tdStyle, fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{fmtNum(p.loan_amount)}</td>
                  <td style={tdStyle}><ApplyBadge status={p.apply_status} /></td>
                  <td style={tdStyle}><ContractBadge status={p.contract_status} /></td>
                  <td style={tdStyle} onClick={e => e.stopPropagation()}>
                    <div className="row-actions">
                      {p.ownership_project_id||p.new_project_id?<button className="btn btn-sub btn-sm" onClick={e=>{e.stopPropagation();onViewDetail(p.id)}}>手続き</button>:<button className="btn-icon btn-icon--danger" onClick={e => handleDelete(e, p)}>✕</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="empty-cell">該当する案件がありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddModal onSave={handleAdd} onClose={() => { setShowAdd(false); onReload() }} existingCustomers={existingCustomers} newProspectReady={newProspectReady} />}
    </div>
  )
}

const thStyle: React.CSSProperties = {
  textAlign: 'center', padding: '9px 12px',
  fontSize: 12, fontWeight: 600, color: '#475569',
  borderBottom: '2px solid #f1f5f9', whiteSpace: 'nowrap',
}
const tdStyle: React.CSSProperties = {
  textAlign: 'center', padding: '10px 12px', borderBottom: '1px solid #f1f5f9',
  fontSize: 15, color: '#374151', whiteSpace: 'nowrap',
}
