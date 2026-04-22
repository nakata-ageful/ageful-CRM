import { useState } from 'react'
import type { MaintenanceResponse } from '../types'
import { StatusBadge } from '../components/StatusBadge'
import { Modal } from '../components/Modal'
import { updateMaintenanceResponse, completeMaintenanceResponse } from '../lib/actions'
import { useToast } from '../components/Toast'

type Props = {
  response: MaintenanceResponse
  onBack: () => void
  onReload: () => void
  onViewProject: (projectId: number) => void
}

export function MaintenanceResponseDetail({ response, onBack, onReload, onViewProject }: Props) {
  const toast = useToast()
  const [editModal, setEditModal] = useState(false)
  const [form, setForm] = useState({
    inquiry_date: response.inquiry_date ?? '',
    occurrence_date: response.occurrence_date ?? '',
    target_area: response.target_area ?? '',
    situation: response.situation ?? '',
    response_content: response.response_content ?? '',
    report: response.report ?? '',
    status: response.status,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true); setError('')
    try {
      await updateMaintenanceResponse(response.id, form)
      setEditModal(false)
      onReload()
      toast('保守対応を保存しました')
    } catch (e) { setError(String(e)) } finally { setSaving(false) }
  }

  async function handleComplete() {
    if (!confirm('この保守対応を完了にしますか？')) return
    try {
      await completeMaintenanceResponse(response.id)
      onReload()
      toast('保守対応を完了にしました')
    } catch (e) { setError(String(e)) }
  }

  return (
    <>
      <button className="back-btn" onClick={onBack}>← 保守対応一覧に戻る</button>

      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 13, color: '#64748b' }}>発電所：</span>
        <button className="link-btn" onClick={() => onViewProject(response.project_id)}>
          {response.project_name ?? '-'}
        </button>
        <span style={{ fontSize: 13, color: '#64748b' }}>顧客：{response.customer_name ?? '-'}</span>
        <StatusBadge status={response.status} />
      </div>

      {error && !editModal && <div className="form-error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="card">
        <div className="card-header-row">
          <h3 className="section-title" style={{ margin: 0 }}>
            保守対応詳細 {response.response_no ? `（${response.response_no}）` : ''}
          </h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sub btn-sm" onClick={() => { setForm({
              inquiry_date: response.inquiry_date ?? '',
              occurrence_date: response.occurrence_date ?? '',
              target_area: response.target_area ?? '',
              situation: response.situation ?? '',
              response_content: response.response_content ?? '',
              report: response.report ?? '',
              status: response.status,
            }); setError(''); setEditModal(true) }}>
              編集
            </button>
            {response.status === '対応中' && (
              <button className="btn btn-main btn-sm" onClick={handleComplete}>
                完了にする
              </button>
            )}
          </div>
        </div>

        <div className="info-grid">
          <div className="info-field"><span>問合日</span><b>{response.inquiry_date ?? '-'}</b></div>
          <div className="info-field"><span>発生日</span><b>{response.occurrence_date ?? '-'}</b></div>
          <div className="info-field"><span>対象箇所</span><b>{response.target_area ?? '-'}</b></div>
        </div>

        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div className="detail-label">状況</div>
            <div className="detail-text">{response.situation || '（未記入）'}</div>
          </div>
          <div>
            <div className="detail-label">対応</div>
            <div className="detail-text">{response.response_content || '（未記入）'}</div>
          </div>
          <div>
            <div className="detail-label">報告</div>
            <div className="detail-text">{response.report || '（未記入）'}</div>
          </div>
        </div>
      </div>

      {editModal && (
        <Modal title="保守対応を編集" onClose={() => setEditModal(false)} width={600}>
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <label className="form-label">
              管理番号
              <input className="form-input" value={response.response_no ?? ''} disabled style={{ backgroundColor: '#f1f5f9' }} />
            </label>
            <label className="form-label">
              状態
              <select className="form-select" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value as '対応中' | '完了' }))}>
                <option value="対応中">対応中</option>
                <option value="完了">完了</option>
              </select>
            </label>
            <label className="form-label">
              問合日
              <input className="form-input" type="date" value={form.inquiry_date} onChange={e => setForm(f => ({ ...f, inquiry_date: e.target.value }))} />
            </label>
            <label className="form-label">
              発生日
              <input className="form-input" type="date" value={form.occurrence_date} onChange={e => setForm(f => ({ ...f, occurrence_date: e.target.value }))} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              対象箇所
              <input className="form-input" value={form.target_area} onChange={e => setForm(f => ({ ...f, target_area: e.target.value }))} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              状況
              <textarea className="form-input" rows={3} value={form.situation} onChange={e => setForm(f => ({ ...f, situation: e.target.value }))} style={{ resize: 'vertical' }} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              対応
              <textarea className="form-input" rows={3} value={form.response_content} onChange={e => setForm(f => ({ ...f, response_content: e.target.value }))} style={{ resize: 'vertical' }} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              報告
              <textarea className="form-input" rows={3} value={form.report} onChange={e => setForm(f => ({ ...f, report: e.target.value }))} style={{ resize: 'vertical' }} />
            </label>
          </div>
          <div className="modal-footer">
            <button className="btn btn-sub" onClick={() => setEditModal(false)}>キャンセル</button>
            <button className="btn btn-main" onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存する'}</button>
          </div>
        </Modal>
      )}
    </>
  )
}
