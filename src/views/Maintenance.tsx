import { useState } from 'react'
import type { MaintenanceLog, MaintenanceInput, MaintenanceStatus } from '../types'
import { Modal } from '../components/Modal'
import { Confirm } from '../components/Confirm'
import { createMaintenanceLog, updateMaintenanceStatus, deleteMaintenanceLog } from '../lib/actions'
import { projectStore } from '../lib/mock-store'
import { hasSupabaseEnv } from '../lib/supabase'

type Props = {
  logs: MaintenanceLog[]
  onReload: () => void
}

const emptyForm: MaintenanceInput = {
  project_id: 0,
  inquiry_date: '',
  occurrence_date: '',
  work_type: '',
  target_area: '',
  situation: '',
  response: '',
  report: '',
}

export function Maintenance({ logs, onReload }: Props) {
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<MaintenanceInput>(emptyForm)
  const [deleteTarget, setDeleteTarget] = useState<MaintenanceLog | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const projects = hasSupabaseEnv ? [] : projectStore.getAll()

  function exportCSV() {
    const header = ['案件名', '顧客名', '受付日', '発生日', '作業種別', '対象部位', '状態']
    const body = filtered.map(m => [
      m.project_name ?? '', m.customer_name ?? '',
      m.inquiry_date ?? '', m.occurrence_date ?? '',
      m.work_type ?? '', m.target_area ?? '', m.status,
    ])
    const csv = [header, ...body].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `maintenance_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filtered = logs.filter(m => {
    const q = search.toLowerCase()
    const matchStatus = statusFilter === 'all' || m.status === statusFilter
    const matchSearch = (m.project_name ?? '').toLowerCase().includes(q) ||
      (m.customer_name ?? '').toLowerCase().includes(q) ||
      (m.work_type ?? '').toLowerCase().includes(q)
    return matchStatus && matchSearch
  })

  function openCreate() {
    setForm({ ...emptyForm, project_id: projects[0]?.id ?? 0 })
    setModal(true)
    setError('')
  }

  async function handleSave() {
    if (!form.project_id) { setError('案件を選択してください'); return }
    setSaving(true)
    try {
      await createMaintenanceLog(form)
      setModal(false)
      onReload()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(id: number, status: MaintenanceStatus) {
    await updateMaintenanceStatus(id, status)
    onReload()
  }

  async function handleDelete() {
    if (!deleteTarget) return
    await deleteMaintenanceLog(deleteTarget.id)
    setDeleteTarget(null)
    onReload()
  }

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-left">
          <input
            className="search-input"
            type="search"
            placeholder="案件名・顧客名・作業種別で検索..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="all">すべてのステータス</option>
            <option value="pending">未対応</option>
            <option value="in_progress">対応中</option>
            <option value="completed">完了</option>
          </select>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sub" onClick={exportCSV}>CSV出力</button>
          <button className="btn btn-main" onClick={openCreate}>＋ 新規記録</button>
        </div>
      </div>

      <div className="card">
        <div className="table-meta">{filtered.length} 件</div>
        <table>
          <thead>
            <tr>
              <th>案件</th><th>顧客</th><th>発生日</th><th>作業種別</th>
              <th>対象部位</th><th>状態</th><th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="empty-cell">該当する記録がありません</td></tr>
            )}
            {filtered.map(m => (
              <tr key={m.id}>
                <td>{m.project_name}</td>
                <td>{m.customer_name}</td>
                <td>{m.occurrence_date ?? '-'}</td>
                <td>{m.work_type ?? '-'}</td>
                <td>{m.target_area ?? '-'}</td>
                <td>
                  <select
                    className={`status-select status-select--${m.status}`}
                    value={m.status}
                    onChange={e => handleStatusChange(m.id, e.target.value as MaintenanceStatus)}
                  >
                    <option value="pending">未対応</option>
                    <option value="in_progress">対応中</option>
                    <option value="completed">完了</option>
                  </select>
                </td>
                <td>
                  <button className="btn-icon btn-icon--danger" title="削除" onClick={() => setDeleteTarget(m)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal title="保守記録を新規作成" onClose={() => setModal(false)} width={600}>
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <label className="form-label required" style={{ gridColumn: '1/-1' }}>
              案件
              <select
                className="form-select"
                value={form.project_id}
                onChange={e => setForm(f => ({ ...f, project_id: Number(e.target.value) }))}
              >
                <option value={0}>-- 案件を選択 --</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.project_name}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              受付日
              <input className="form-input" type="date" value={form.inquiry_date} onChange={e => setForm(f => ({ ...f, inquiry_date: e.target.value }))} />
            </label>
            <label className="form-label">
              発生日
              <input className="form-input" type="date" value={form.occurrence_date} onChange={e => setForm(f => ({ ...f, occurrence_date: e.target.value }))} />
            </label>
            <label className="form-label">
              作業種別
              <input className="form-input" placeholder="PCS点検・定期保守 など" value={form.work_type} onChange={e => setForm(f => ({ ...f, work_type: e.target.value }))} />
            </label>
            <label className="form-label">
              対象部位
              <input className="form-input" placeholder="パネル・PCS・通信機器 など" value={form.target_area} onChange={e => setForm(f => ({ ...f, target_area: e.target.value }))} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              状況
              <textarea className="form-textarea" rows={2} value={form.situation} onChange={e => setForm(f => ({ ...f, situation: e.target.value }))} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              対応内容
              <textarea className="form-textarea" rows={2} value={form.response} onChange={e => setForm(f => ({ ...f, response: e.target.value }))} />
            </label>
          </div>
          <div className="modal-footer">
            <button className="btn btn-sub" onClick={() => setModal(false)}>キャンセル</button>
            <button className="btn btn-main" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存する'}
            </button>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <Confirm
          message={`「${deleteTarget.work_type ?? '保守記録'}」を削除しますか？`}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
}
