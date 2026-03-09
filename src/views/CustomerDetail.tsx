import { useState } from 'react'
import type { CustomerDetail as Detail, Project } from '../types'
import { StatusBadge } from '../components/StatusBadge'
import { Modal } from '../components/Modal'
import { createProject, updateProject, type ProjectInput } from '../lib/actions'
import { getCustomerDetail } from '../lib/data'

type Props = {
  detail: Detail
  onBack: () => void
  onReload: (id: number) => void
}

const emptyProject: ProjectInput = {
  customer_id: 0,
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

export function CustomerDetail({ detail, onBack, onReload }: Props) {
  const { customer, projects, recentMaintenance } = detail
  const [projectModal, setProjectModal] = useState<'create' | 'edit' | null>(null)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [form, setForm] = useState<ProjectInput>(emptyProject)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function openCreate() {
    setForm({ ...emptyProject, customer_id: customer.id })
    setEditProject(null)
    setProjectModal('create')
    setError('')
  }

  function openEdit(p: Project) {
    setForm({
      customer_id: customer.id,
      project_number: p.project_number ?? '',
      project_name: p.project_name,
      site_address: p.site_address ?? '',
      key_number: p.key_number ?? '',
      grid_id: p.grid_id ?? '',
      grid_certified_at: p.grid_certified_at ?? '',
      fit_period: p.fit_period != null ? String(p.fit_period) : '',
      fit_end_date: p.fit_end_date ?? '',
      power_supply_start_date: p.power_supply_start_date ?? '',
      generation_point_id: p.generation_point_id ?? '',
      customer_number: p.customer_number ?? '',
      handover_date: p.handover_date ?? '',
      abolition_date: p.abolition_date ?? '',
      sales_company: p.sales_company ?? '',
      referrer: p.referrer ?? '',
      sales_price: p.sales_price != null ? String(p.sales_price) : '',
      reference_price: p.reference_price != null ? String(p.reference_price) : '',
      land_cost: p.land_cost != null ? String(p.land_cost) : '',
      amuras_member_no: p.amuras_member_no ?? '',
      monitoring_system: p.monitoring_system ?? '',
      notes: p.notes ?? '',
      latitude: p.latitude != null ? String(p.latitude) : '',
      longitude: p.longitude != null ? String(p.longitude) : '',
    })
    setEditProject(p)
    setProjectModal('edit')
    setError('')
  }

  async function handleSave() {
    if (!form.project_name.trim()) { setError('案件名は必須です'); return }
    setSaving(true)
    try {
      if (projectModal === 'create') await createProject(form)
      else if (projectModal === 'edit' && editProject) await updateProject(editProject.id, form)
      setProjectModal(null)
      // 顧客詳細を再取得して表示を更新
      onReload(customer.id)
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button className="back-btn" onClick={onBack}>← 顧客一覧に戻る</button>

      <div className="card">
        <h3 className="section-title">顧客情報</h3>
        <div className="info-grid">
          <div className="info-field"><span>種別</span><b>{customer.type === 'corporate' ? '法人' : '個人'}</b></div>
          {customer.company_name && <div className="info-field"><span>会社名</span><b>{customer.company_name}</b></div>}
          <div className="info-field"><span>担当者</span><b>{customer.contact_name}</b></div>
          <div className="info-field"><span>電話</span><b>{customer.phone ?? '-'}</b></div>
          <div className="info-field"><span>メール</span><b>{customer.email ?? '-'}</b></div>
          <div className="info-field"><span>住所</span><b>{customer.address ?? '-'}</b></div>
          {customer.notes && <div className="info-field" style={{ gridColumn: '1/-1' }}><span>備考</span><b>{customer.notes}</b></div>}
        </div>
      </div>

      <div className="card">
        <div className="card-header-row">
          <h3 className="section-title" style={{ margin: 0 }}>案件一覧（{projects.length} 件）</h3>
          <button className="btn btn-main btn-sm" onClick={openCreate}>＋ 案件を追加</button>
        </div>
        {projects.length === 0 ? (
          <p className="empty-cell">案件がありません</p>
        ) : (
          <table>
            <thead>
              <tr><th>案件名</th><th>案件番号</th><th>設置住所</th><th>パネル</th><th>PCS</th><th>操作</th></tr>
            </thead>
            <tbody>
              {projects.map(p => (
                <tr key={p.id}>
                  <td><strong>{p.project_name}</strong></td>
                  <td>{p.project_number ?? '-'}</td>
                  <td>{p.site_address ?? '-'}</td>
                  <td>{p.spec ? `${p.spec.panel_kw ?? '-'}kW / ${p.spec.panel_count ?? '-'}枚` : '-'}</td>
                  <td>{p.spec ? `${p.spec.pcs_kw ?? '-'}kW / ${p.spec.pcs_count ?? '-'}台` : '-'}</td>
                  <td>
                    <button className="btn-icon" title="編集" onClick={() => openEdit(p)}>✎</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">最近の保守記録</h3>
        {recentMaintenance.length === 0 ? (
          <p className="empty-cell">保守記録がありません</p>
        ) : (
          <table>
            <thead>
              <tr><th>案件</th><th>発生日</th><th>作業種別</th><th>対応内容</th><th>状態</th></tr>
            </thead>
            <tbody>
              {recentMaintenance.map(m => (
                <tr key={m.id}>
                  <td>{m.project_name ?? '-'}</td>
                  <td>{m.occurrence_date ?? '-'}</td>
                  <td>{m.work_type ?? '-'}</td>
                  <td>{m.response ?? '-'}</td>
                  <td><StatusBadge status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {(projectModal === 'create' || projectModal === 'edit') && (
        <Modal
          title={projectModal === 'create' ? '案件を新規登録' : '案件を編集'}
          onClose={() => setProjectModal(null)}
        >
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <label className="form-label required" style={{ gridColumn: '1/-1' }}>
              案件名
              <input className="form-input" value={form.project_name} onChange={e => setForm(f => ({ ...f, project_name: e.target.value }))} />
            </label>
            <label className="form-label">
              案件番号
              <input className="form-input" placeholder="PJ-2026-001" value={form.project_number} onChange={e => setForm(f => ({ ...f, project_number: e.target.value }))} />
            </label>
            <label className="form-label">
              キー番号
              <input className="form-input" value={form.key_number} onChange={e => setForm(f => ({ ...f, key_number: e.target.value }))} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              設置住所
              <input className="form-input" value={form.site_address} onChange={e => setForm(f => ({ ...f, site_address: e.target.value }))} />
            </label>
          </div>
          <div className="modal-footer">
            <button className="btn btn-sub" onClick={() => setProjectModal(null)}>キャンセル</button>
            <button className="btn btn-main" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}

// 顧客詳細の再取得を外部から呼べるよう型をエクスポート
export type { getCustomerDetail }
