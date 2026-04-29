import { useState, useMemo } from 'react'
import type { Prospect, ProspectApplyStatus, ProspectContractStatus, ProspectInput, Customer } from '../types'
import { createProspect, deleteProspect } from '../lib/actions'
import { fmtNum } from '../lib/utils'
import { useToast } from '../components/Toast'

type ApplyFilter = 'all' | ProspectApplyStatus
type ContractFilter = 'all' | ProspectContractStatus

const APPLY_STATUSES: ProspectApplyStatus[] = ['未', '提出済', '通過', '不通', '不可']
const CONTRACT_STATUSES: ProspectContractStatus[] = ['未', '完了', '不可']

/** スペースを全て除去して正規化 */
function normalizeName(name: string): string {
  return name.replace(/[\s\u3000]/g, '')
}

type ExistingCustomerOption = {
  name: string
  name_kana: string
  source: 'prospect' | 'customer'
}

function ApplyBadge({ status }: { status: ProspectApplyStatus }) {
  return <span className={`prospect-badge prospect-apply-${status}`}>{status}</span>
}

function ContractBadge({ status }: { status: ProspectContractStatus }) {
  return <span className={`prospect-badge prospect-contract-${status}`}>{status}</span>
}

function AddModal({ onSave, onClose, existingCustomers }: {
  onSave: (input: ProspectInput) => Promise<void>
  onClose: () => void
  existingCustomers: ExistingCustomerOption[]
}) {
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [form, setForm] = useState<ProspectInput>({
    customer_name: '', customer_name_kana: '', project_name: '', loan_company: '',
    equipment: '', land_cost: '', loan_amount: '',
    site_address: '', panel_kw: '', sales_company: '', referrer: '', lead_date: '',
  })
  const [saving, setSaving] = useState(false)
  const set = (k: keyof ProspectInput, v: string) => setForm(f => ({ ...f, [k]: v }))

  function handleSelectExisting(value: string) {
    setSelectedCustomer(value)
    const cust = existingCustomers.find(c => c.name === value)
    if (cust) {
      setForm(f => ({
        ...f,
        customer_name: cust.name,
        customer_name_kana: cust.name_kana,
      }))
    }
  }

  function handleModeChange(newMode: 'new' | 'existing') {
    setMode(newMode)
    if (newMode === 'new') {
      setSelectedCustomer('')
      setForm(f => ({ ...f, customer_name: '', customer_name_kana: '' }))
    }
  }

  async function handleSave() {
    if (!form.customer_name.trim() || !form.project_name.trim()) return
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">案件を追加</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {/* 既存/新規切り替え */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
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
          </div>

          <div className="form-grid">
            {mode === 'existing' ? (
              <>
                <label className="form-label required">
                  顧客を選択
                  <select
                    className="form-select"
                    value={selectedCustomer}
                    onChange={e => handleSelectExisting(e.target.value)}
                  >
                    <option value="">選択してください</option>
                    {existingCustomers.map((c, i) => (
                      <option key={`${c.name}-${i}`} value={c.name}>
                        {c.name}{c.name_kana ? ` (${c.name_kana})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <>
                <label className="form-label required">
                  顧客名
                  <input className="form-input" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} placeholder="山田 太郎" />
                </label>
                <label className="form-label">
                  ふりがな
                  <input className="form-input" value={form.customer_name_kana} onChange={e => set('customer_name_kana', e.target.value)} placeholder="やまだ たろう" />
                </label>
              </>
            )}
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
              物件所在地
              <input className="form-input" value={form.site_address} onChange={e => set('site_address', e.target.value)} placeholder="茨城県鹿嶋市..." />
            </label>
            <label className="form-label">
              設備代（円）
              <input className="form-input" type="number" value={form.equipment} onChange={e => set('equipment', e.target.value)} />
            </label>
            <label className="form-label">
              土地費（円）
              <input className="form-input" type="number" value={form.land_cost} onChange={e => set('land_cost', e.target.value)} />
            </label>
            <label className="form-label">
              融資額（円）
              <input className="form-input" type="number" value={form.loan_amount} onChange={e => set('loan_amount', e.target.value)} />
            </label>
            <label className="form-label">
              kW数
              <input className="form-input" type="number" value={form.panel_kw} onChange={e => set('panel_kw', e.target.value)} placeholder="45.9" />
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
              <input className="form-input" type="date" value={form.lead_date} onChange={e => set('lead_date', e.target.value)} />
            </label>
          </div>
          <div className="modal-footer">
            <button className="btn btn-sub" onClick={onClose}>キャンセル</button>
            <button className="btn btn-main" onClick={handleSave} disabled={saving || !form.customer_name.trim() || !form.project_name.trim()}>
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
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
}: {
  prospects: Prospect[]
  customers: Customer[]
  onReload: () => void
  onViewDetail: (id: number) => void
  onViewProject: (customerId: number) => void
}) {
  const toast = useToast()
  const [applyFilter, setApplyFilter] = useState<ApplyFilter>('all')
  const [contractFilter, setContractFilter] = useState<ContractFilter>('all')
  const [showAdd, setShowAdd] = useState(false)

  const filtered = prospects.filter(p =>
    (applyFilter === 'all' || p.apply_status === applyFilter) &&
    (contractFilter === 'all' || p.contract_status === contractFilter)
  )

  // 既存顧客候補（見込み + 顧客タブ、重複除去）
  const existingCustomers: ExistingCustomerOption[] = useMemo(() => {
    const seen = new Set<string>()
    const result: ExistingCustomerOption[] = []
    // 見込みリストから
    for (const p of prospects) {
      const key = normalizeName(p.customer_name)
      if (!seen.has(key)) {
        seen.add(key)
        result.push({ name: p.customer_name, name_kana: p.customer_name_kana ?? '', source: 'prospect' })
      }
    }
    // 顧客タブから
    for (const c of customers) {
      const key = normalizeName(c.name)
      if (!seen.has(key)) {
        seen.add(key)
        result.push({ name: c.name, name_kana: c.name_kana ?? '', source: 'customer' })
      }
    }
    return result
  }, [prospects, customers])

  async function handleAdd(input: ProspectInput) {
    await createProspect(input)
    setShowAdd(false)
    onReload()
    toast('見込みを追加しました')
  }

  async function handleDelete(e: React.MouseEvent, p: Prospect) {
    e.stopPropagation()
    if (!confirm(`「${p.customer_name} / ${p.project_name}」を削除しますか？`)) return
    await deleteProspect(p.id)
    onReload()
    toast('見込みを削除しました')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* フィルター */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="card" style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.05em' }}>申込</span>
          {(['all', ...APPLY_STATUSES] as (ApplyFilter)[]).map(s => (
            <button
              key={s}
              className={`filter-tab ${applyFilter === s ? 'active' : ''}`}
              onClick={() => setApplyFilter(s)}
            >
              {s === 'all' ? 'すべて' : s}
            </button>
          ))}
        </div>
        <div className="card" style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', letterSpacing: '.05em' }}>契約</span>
          {(['all', ...CONTRACT_STATUSES] as (ContractFilter)[]).map(s => (
            <button
              key={s}
              className={`filter-tab ${contractFilter === s ? 'active' : ''}`}
              onClick={() => setContractFilter(s)}
            >
              {s === 'all' ? 'すべて' : s}
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
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    {p.customer_name}
                  </td>
                  <td style={tdStyle} onClick={e => {
                    if (p.converted_customer_id) {
                      e.stopPropagation()
                      onViewProject(p.converted_customer_id)
                    }
                  }}>
                    {p.converted_customer_id ? (
                      <span style={{ color: '#2563eb', cursor: 'pointer', textDecoration: 'underline' }}>{p.project_name}</span>
                    ) : p.project_name}
                  </td>
                  <td style={tdStyle}>
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
                      <button className="btn-icon btn-icon--danger" onClick={e => handleDelete(e, p)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="empty-cell">該当する案件がありません</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && <AddModal onSave={handleAdd} onClose={() => setShowAdd(false)} existingCustomers={existingCustomers} />}
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
  fontSize: 13.5, color: '#374151',
}
