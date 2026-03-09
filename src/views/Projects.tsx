import { useState } from 'react'
import type { ProjectRow, Customer, CustomerInput } from '../types'
import type { ProjectInput } from '../lib/actions'
import { Modal } from '../components/Modal'
import { createCustomer, createProject } from '../lib/actions'

type Props = {
  projects: ProjectRow[]
  customers: Customer[]
  onReload: () => void
  onViewDetail: (customerId: number) => void
}

type CustomerMode = 'existing' | 'new'

const emptyCustomerForm: CustomerInput = {
  type: 'individual',
  company_name: '',
  contact_name: '',
  email: '',
  phone: '',
  postal_code: '',
  address: '',
  notes: '',
}

const emptyProjectForm: Omit<ProjectInput, 'customer_id'> = {
  project_number: '',
  project_name: '',
  site_address: '',
  key_number: '',
  grid_id: '',
  grid_certified_at: '',
  fit_period: '',
  fit_end_date: '',
  power_supply_start_date: '',
  generation_point_id: '',
  customer_number: '',
  handover_date: '',
  abolition_date: '',
  sales_company: '',
  referrer: '',
  sales_price: '',
  reference_price: '',
  land_cost: '',
  amuras_member_no: '',
  monitoring_system: '',
  notes: '',
  latitude: '',
  longitude: '',
}

function fitEndAlert(fitEndDate: string | null): { label: string; style: React.CSSProperties } | null {
  if (!fitEndDate) return null
  const today = new Date()
  const end = new Date(fitEndDate)
  const diffDays = Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 0) return { label: '満了', style: { color: '#dc2626', fontWeight: 700 } }
  if (diffDays <= 365) return { label: fitEndDate, style: { color: '#ea580c', fontWeight: 600 } }
  return null
}

export function Projects({ projects, customers, onReload, onViewDetail }: Props) {
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [customerMode, setCustomerMode] = useState<CustomerMode>('existing')
  const [selectedCustomerId, setSelectedCustomerId] = useState<number>(customers[0]?.id ?? 0)
  const [customerForm, setCustomerForm] = useState<CustomerInput>(emptyCustomerForm)
  const [projectForm, setProjectForm] = useState<Omit<ProjectInput, 'customer_id'>>(emptyProjectForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const filtered = projects.filter(p => {
    const q = search.toLowerCase()
    return (
      p.project_name.toLowerCase().includes(q) ||
      (p.project_number ?? '').toLowerCase().includes(q) ||
      p.customer_name.toLowerCase().includes(q) ||
      (p.site_address ?? '').toLowerCase().includes(q) ||
      (p.sales_company ?? '').toLowerCase().includes(q)
    )
  })

  function openCreate() {
    setCustomerMode('existing')
    setSelectedCustomerId(customers[0]?.id ?? 0)
    setCustomerForm(emptyCustomerForm)
    setProjectForm(emptyProjectForm)
    setModal(true)
    setError('')
  }

  async function handleSave() {
    if (!projectForm.project_name.trim()) { setError('案件名は必須です'); return }
    setSaving(true)
    try {
      let customerId: number
      if (customerMode === 'existing') {
        if (!selectedCustomerId) { setError('顧客を選択してください'); setSaving(false); return }
        customerId = selectedCustomerId
      } else {
        if (!customerForm.contact_name.trim()) { setError('担当者名は必須です'); setSaving(false); return }
        const newCustomer = await createCustomer(customerForm)
        customerId = newCustomer.id
      }
      await createProject({ ...projectForm, customer_id: customerId })
      setModal(false)
      onReload()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  function pf(key: keyof typeof emptyProjectForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setProjectForm(f => ({ ...f, [key]: e.target.value }))
  }

  return (
    <>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="案件名・顧客名・設置住所・販売会社で検索..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className="btn btn-main" onClick={openCreate}>＋ 新規案件登録</button>
      </div>

      <div className="card">
        <div className="table-meta">{filtered.length} 件</div>
        <table>
          <thead>
            <tr>
              <th>案件名</th><th>顧客</th><th>設置住所</th><th>FIT満了</th><th>引渡日</th><th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="empty-cell">該当する案件がありません</td></tr>
            )}
            {filtered.map(p => {
              const fitAlert = fitEndAlert(p.fit_end_date)
              return (
                <tr key={p.id} className="clickable-row" onClick={() => onViewDetail(p.customer_id)}>
                  <td>
                    <strong>{p.project_name}</strong>
                    {p.project_number && <div style={{ fontSize: 11, color: '#64748b' }}>{p.project_number}</div>}
                  </td>
                  <td>
                    {p.company_name
                      ? <><span style={{ fontSize: 12, color: '#64748b' }}>{p.company_name}</span><br />{p.customer_name}</>
                      : p.customer_name
                    }
                  </td>
                  <td>{p.site_address ?? '-'}</td>
                  <td>
                    {fitAlert
                      ? <span style={fitAlert.style}>{fitAlert.label}</span>
                      : (p.fit_end_date ?? '-')
                    }
                  </td>
                  <td>{p.handover_date ?? '-'}</td>
                  <td onClick={e => e.stopPropagation()}>
                    <button className="btn btn-sm btn-sub" onClick={() => onViewDetail(p.customer_id)}>
                      詳細
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title="新規案件登録" onClose={() => setModal(false)} width={680}>
          {error && <div className="form-error">{error}</div>}

          {/* 顧客情報 */}
          <div className="form-section-title">顧客情報</div>
          <div className="radio-group">
            <label className="radio-label">
              <input type="radio" value="existing" checked={customerMode === 'existing'} onChange={() => setCustomerMode('existing')} />
              既存顧客を選択
            </label>
            <label className="radio-label">
              <input type="radio" value="new" checked={customerMode === 'new'} onChange={() => setCustomerMode('new')} />
              新規顧客を作成
            </label>
          </div>

          {customerMode === 'existing' ? (
            <div className="form-grid">
              <label className="form-label required" style={{ gridColumn: '1/-1' }}>
                顧客を選択
                <select className="form-select" value={selectedCustomerId} onChange={e => setSelectedCustomerId(Number(e.target.value))}>
                  <option value={0}>-- 顧客を選択 --</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.company_name ? `${c.company_name}（${c.contact_name}）` : c.contact_name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="form-grid">
              <label className="form-label">
                種別
                <select className="form-select" value={customerForm.type} onChange={e => setCustomerForm(f => ({ ...f, type: e.target.value as 'individual' | 'corporate' }))}>
                  <option value="individual">個人</option>
                  <option value="corporate">法人</option>
                </select>
              </label>
              {customerForm.type === 'corporate' && (
                <label className="form-label">
                  会社名
                  <input className="form-input" value={customerForm.company_name} onChange={e => setCustomerForm(f => ({ ...f, company_name: e.target.value }))} />
                </label>
              )}
              <label className="form-label required">
                担当者名
                <input className="form-input" value={customerForm.contact_name} onChange={e => setCustomerForm(f => ({ ...f, contact_name: e.target.value }))} />
              </label>
              <label className="form-label">
                電話番号
                <input className="form-input" type="tel" value={customerForm.phone} onChange={e => setCustomerForm(f => ({ ...f, phone: e.target.value }))} />
              </label>
              <label className="form-label">
                メール
                <input className="form-input" type="email" value={customerForm.email} onChange={e => setCustomerForm(f => ({ ...f, email: e.target.value }))} />
              </label>
              <label className="form-label" style={{ gridColumn: '1/-1' }}>
                住所
                <input className="form-input" value={customerForm.address} onChange={e => setCustomerForm(f => ({ ...f, address: e.target.value }))} />
              </label>
            </div>
          )}

          <div className="form-section-divider" />
          {/* 基本情報 */}
          <div className="form-section-title">案件基本情報</div>
          <div className="form-grid">
            <label className="form-label required" style={{ gridColumn: '1/-1' }}>
              案件名
              <input className="form-input" value={projectForm.project_name} onChange={pf('project_name')} />
            </label>
            <label className="form-label">
              案件番号
              <input className="form-input" placeholder="PJ-2026-001" value={projectForm.project_number} onChange={pf('project_number')} />
            </label>
            <label className="form-label">
              キー番号
              <input className="form-input" value={projectForm.key_number} onChange={pf('key_number')} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              設置住所
              <input className="form-input" value={projectForm.site_address} onChange={pf('site_address')} />
            </label>
          </div>

          <div className="form-section-divider" />
          {/* FIT・系統情報 */}
          <div className="form-section-title">FIT・系統情報</div>
          <div className="form-grid">
            <label className="form-label">
              系統ID
              <input className="form-input" value={projectForm.grid_id} onChange={pf('grid_id')} />
            </label>
            <label className="form-label">
              系統認定日
              <input className="form-input" type="date" value={projectForm.grid_certified_at} onChange={pf('grid_certified_at')} />
            </label>
            <label className="form-label">
              FIT期間（年）
              <input className="form-input" type="number" min="0" placeholder="20" value={projectForm.fit_period} onChange={pf('fit_period')} />
            </label>
            <label className="form-label">
              給電開始日
              <input className="form-input" type="date" value={projectForm.power_supply_start_date} onChange={pf('power_supply_start_date')} />
            </label>
            <label className="form-label">
              FIT満了日
              <input className="form-input" type="date" value={projectForm.fit_end_date} onChange={pf('fit_end_date')} />
            </label>
            <label className="form-label">
              お客さま番号
              <input className="form-input" value={projectForm.customer_number} onChange={pf('customer_number')} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              発電地点特定番号
              <input className="form-input" value={projectForm.generation_point_id} onChange={pf('generation_point_id')} />
            </label>
          </div>

          <div className="form-section-divider" />
          {/* 販売情報 */}
          <div className="form-section-title">販売情報</div>
          <div className="form-grid">
            <label className="form-label">
              引渡日
              <input className="form-input" type="date" value={projectForm.handover_date} onChange={pf('handover_date')} />
            </label>
            <label className="form-label">
              撤廃日
              <input className="form-input" type="date" value={projectForm.abolition_date} onChange={pf('abolition_date')} />
            </label>
            <label className="form-label">
              販売会社
              <input className="form-input" value={projectForm.sales_company} onChange={pf('sales_company')} />
            </label>
            <label className="form-label">
              紹介者
              <input className="form-input" value={projectForm.referrer} onChange={pf('referrer')} />
            </label>
            <label className="form-label">
              販売価格（円・税込）
              <input className="form-input" type="number" min="0" value={projectForm.sales_price} onChange={pf('sales_price')} />
            </label>
            <label className="form-label">
              価格参照（円・税込）
              <input className="form-input" type="number" min="0" value={projectForm.reference_price} onChange={pf('reference_price')} />
            </label>
            <label className="form-label">
              土地代（円）
              <input className="form-input" type="number" min="0" value={projectForm.land_cost} onChange={pf('land_cost')} />
            </label>
          </div>

          <div className="form-section-divider" />
          {/* 保守管理 */}
          <div className="form-section-title">保守管理</div>
          <div className="form-grid">
            <label className="form-label">
              アムラス会員番号
              <input className="form-input" value={projectForm.amuras_member_no} onChange={pf('amuras_member_no')} />
            </label>
            <label className="form-label">
              遠隔監視システム
              <input className="form-input" placeholder="FusionSolar、エコめがね 等" value={projectForm.monitoring_system} onChange={pf('monitoring_system')} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              備考
              <textarea className="form-input" rows={3} value={projectForm.notes} onChange={pf('notes')} placeholder="遠隔監視のID/PW など自由記述" style={{ resize: 'vertical' }} />
            </label>
          </div>

          <div className="form-section-divider" />
          {/* 座標 */}
          <div className="form-section-title">Google Map 座標</div>
          <div className="form-grid">
            <label className="form-label">
              緯度
              <input className="form-input" type="number" step="0.0000001" placeholder="34.000000" value={projectForm.latitude} onChange={pf('latitude')} />
            </label>
            <label className="form-label">
              経度
              <input className="form-input" type="number" step="0.0000001" placeholder="135.000000" value={projectForm.longitude} onChange={pf('longitude')} />
            </label>
          </div>

          <div className="modal-footer">
            <button className="btn btn-sub" onClick={() => setModal(false)}>キャンセル</button>
            <button className="btn btn-main" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '登録する'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
