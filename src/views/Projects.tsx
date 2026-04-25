import { useState } from 'react'
import type { ProjectRow, Customer, CustomerInput } from '../types'
import type { ProjectInput } from '../lib/actions'
import { Modal } from '../components/Modal'
import { createCustomer, createProject, deleteProject } from '../lib/actions'
import { useToast } from '../components/Toast'

type Props = {
  projects: ProjectRow[]
  customers: Customer[]
  onReload: () => void
  onViewDetail: (projectId: number) => void
}

type CustomerMode = 'existing' | 'new'

const emptyCustomerForm: CustomerInput = {
  name: '',
  name_kana: '',
  company_name: '',
  is_corporate: false,
  email: '',
  phone: '',
  postal_code: '',
  address: '',
}

const emptyProjectForm: Omit<ProjectInput, 'customer_id'> = {
  project_no: '',
  project_name: '',
  plant_name: '',
  site_postal_code: '',
  site_prefecture: '',
  site_address: '',
  latitude: '',
  longitude: '',
  google_coordinates: '',
  panel_kw: '',
  panel_count: '',
  panel_maker: '',
  panel_model: '',
  pcs_kw: '',
  pcs_count: '',
  pcs_maker: '',
  pcs_model: '',
  grid_id: '',
  grid_certified_at: '',
  fit_period: '',
  power_supply_start_date: '',
  customer_number: '',
  generation_point_id: '',
  meter_reading_day: '',
  monitoring_system: '',
  monitoring_id: '',
  monitoring_user: '',
  monitoring_pw: '',
  has_4g: false,
  key_number: '',
  local_association: '',
  old_owner: '',
  sales_company: '',
  referrer: '',
  power_change_date: '',
  handover_date: '',
  sales_price: '',
  reference_price: '',
  land_cost: '',
  amuras_member_no: '',
  notes: '',
}

export function Projects({ projects, customers, onReload, onViewDetail }: Props) {
  const toast = useToast()
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
      (p.project_no ?? '').toLowerCase().includes(q) ||
      p.customer_name.toLowerCase().includes(q) ||
      (p.site_address ?? '').toLowerCase().includes(q) ||
      (p.site_prefecture ?? '').toLowerCase().includes(q)
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
        if (!customerForm.name.trim()) { setError('顧客名は必須です'); setSaving(false); return }
        const newCustomer = await createCustomer(customerForm)
        customerId = newCustomer.id
      }
      await createProject({ ...projectForm, customer_id: customerId })
      setModal(false)
      onReload()
      toast('案件を追加しました')
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  function pf(key: keyof typeof emptyProjectForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setProjectForm(f => ({ ...f, [key]: e.target.value }))
  }

  return (
    <>
      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          placeholder="案件名・案件番号・顧客名・設置住所で検索..."
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
              <th>案件名</th><th>顧客</th><th>都道府県</th><th>FIT</th>
              <th>委託先</th><th>引渡日</th><th>監視</th><th style={{ width: 48 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} className="empty-cell">該当する案件がありません</td></tr>
            )}
            {filtered.map(p => (
              <tr key={p.id} className="clickable-row" onClick={() => onViewDetail(p.id)}>
                <td>
                  <strong>{p.project_name}</strong>
                  {p.project_no && <div style={{ fontSize: 11, color: '#64748b' }}>{p.project_no}</div>}
                </td>
                <td>
                  {p.company_name
                    ? <><span style={{ fontSize: 12, color: '#64748b' }}>{p.company_name}</span><br />{p.customer_name}</>
                    : p.customer_name
                  }
                </td>
                <td>{p.site_prefecture ?? '-'}</td>
                <td>{p.fit_period != null ? `${p.fit_period}円` : '-'}</td>
                <td>{p.subcontractor ?? '-'}</td>
                <td>{p.handover_date ?? '-'}</td>
                <td>{p.monitoring_system ?? '-'}</td>
                <td>
                  <button
                    className="btn-icon"
                    title="削除"
                    onClick={async (e) => {
                      e.stopPropagation()
                      if (!confirm(`「${p.project_name}」を削除しますか？\n関連する契約・請求データも削除されます。`)) return
                      await deleteProject(p.id)
                      onReload()
                      toast('案件を削除しました')
                    }}
                  >🗑</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title="新規案件登録" onClose={() => setModal(false)} width={680}>
          {error && <div className="form-error">{error}</div>}

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
                      {c.company_name ? `${c.company_name}（${c.name}）` : c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : (
            <div className="form-grid">
              <label className="form-label required">
                顧客名（個人名）
                <input className="form-input" value={customerForm.name} onChange={e => setCustomerForm(f => ({ ...f, name: e.target.value }))} />
              </label>
              <label className="form-label">
                会社名（法人の場合）
                <input className="form-input" value={customerForm.company_name} onChange={e => setCustomerForm(f => ({ ...f, company_name: e.target.value, is_corporate: !!e.target.value }))} />
              </label>
              <label className="form-label">
                電話番号
                <input className="form-input" type="tel" value={customerForm.phone} onChange={e => setCustomerForm(f => ({ ...f, phone: e.target.value }))} />
              </label>
              <label className="form-label">
                メール
                <input className="form-input" type="email" value={customerForm.email} onChange={e => setCustomerForm(f => ({ ...f, email: e.target.value }))} />
              </label>
            </div>
          )}

          <div className="form-section-divider" />
          <div className="form-section-title">案件基本情報</div>
          <div className="form-grid">
            <label className="form-label required" style={{ gridColumn: '1/-1' }}>
              案件名
              <input className="form-input" value={projectForm.project_name} onChange={pf('project_name')} />
            </label>
            <label className="form-label">
              案件番号
              <input className="form-input" value={projectForm.project_no} onChange={pf('project_no')} />
            </label>
            <label className="form-label">
              キー番号
              <input className="form-input" value={projectForm.key_number} onChange={pf('key_number')} />
            </label>
            <label className="form-label">
              都道府県
              <input className="form-input" value={projectForm.site_prefecture} onChange={pf('site_prefecture')} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              設置住所
              <input className="form-input" value={projectForm.site_address} onChange={pf('site_address')} />
            </label>
          </div>

          <div className="form-section-divider" />
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
              FIT（円）
              <input className="form-input" type="number" min="0" value={projectForm.fit_period} onChange={pf('fit_period')} />
            </label>
            <label className="form-label">
              給電開始日
              <input className="form-input" type="date" value={projectForm.power_supply_start_date} onChange={pf('power_supply_start_date')} />
            </label>
            <label className="form-label">
              お客さま番号
              <input className="form-input" value={projectForm.customer_number} onChange={pf('customer_number')} />
            </label>
            <label className="form-label">
              発電地点特定番号
              <input className="form-input" value={projectForm.generation_point_id} onChange={pf('generation_point_id')} />
            </label>
          </div>

          <div className="form-section-divider" />
          <div className="form-section-title">販売情報</div>
          <div className="form-grid">
            <label className="form-label">
              引渡日
              <input className="form-input" type="date" value={projectForm.handover_date} onChange={pf('handover_date')} />
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
              販売価格（円）
              <input className="form-input" type="number" min="0" value={projectForm.sales_price} onChange={pf('sales_price')} />
            </label>
          </div>

          <div className="form-section-divider" />
          <div className="form-section-title">遠隔監視</div>
          <div className="form-grid">
            <label className="form-label">
              監視システム
              <input className="form-input" placeholder="FusionSolar、エントリア 等" value={projectForm.monitoring_system} onChange={pf('monitoring_system')} />
            </label>
            <label className="form-label">
              監視ID
              <input className="form-input" value={projectForm.monitoring_id} onChange={pf('monitoring_id')} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              備考
              <textarea className="form-input" rows={3} value={projectForm.notes} onChange={pf('notes')} style={{ resize: 'vertical' }} />
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
