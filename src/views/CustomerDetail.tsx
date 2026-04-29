import { useRef, useState } from 'react'
import type { CustomerDetailData, CustomerInput } from '../types'
import type { ProjectInput } from '../lib/actions'
import { Modal } from '../components/Modal'
import { createProject, updateCustomer, uploadAttachment, deleteAttachment } from '../lib/actions'
import { fmtDate } from '../lib/utils'
import { useToast } from '../components/Toast'

type Props = {
  detail: CustomerDetailData
  onBack: () => void
  onReload: () => void
  onViewProject: (projectId: number) => void
}

const emptyProject: Omit<ProjectInput, 'customer_id'> = {
  project_no: '', project_name: '', plant_name: '', site_postal_code: '', site_prefecture: '',
  site_address: '', latitude: '', longitude: '', google_coordinates: '',
  panel_kw: '', panel_count: '', panel_maker: '', panel_model: '',
  pcs_kw: '', pcs_count: '', pcs_maker: '', pcs_model: '',
  grid_id: '', grid_certified_at: '', fit_period: '', power_supply_start_date: '',
  customer_number: '', generation_point_id: '', meter_reading_day: '',
  monitoring_system: '', monitoring_id: '', monitoring_user: '', monitoring_pw: '',
  has_4g: false, key_number: '', local_association: '', old_owner: '',
  sales_company: '', referrer: '', power_change_date: '', handover_date: '', sales_price: '',
  reference_price: '', land_cost: '', amuras_member_no: '', notes: '',
}

export function CustomerDetailView({ detail, onBack, onReload, onViewProject }: Props) {
  const toast = useToast()
  const { customer, projects, attachments } = detail

  const [editModal, setEditModal] = useState(false)
  const [editForm, setEditForm] = useState<CustomerInput>({
    name: customer.name,
    name_kana: customer.name_kana ?? '',
    company_name: customer.company_name ?? '',
    is_corporate: customer.is_corporate,
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    postal_code: customer.postal_code ?? '',
    address: customer.address ?? '',
    notes: customer.notes ?? '',
  })

  const [projectModal, setProjectModal] = useState(false)
  const [projectForm, setProjectForm] = useState<Omit<ProjectInput, 'customer_id'>>(emptyProject)

  // ── PDF アップロード ──
  const [uploadModal, setUploadModal] = useState(false)
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadDesc, setUploadDesc] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSaveCustomer() {
    if (!editForm.name.trim()) { setError('顧客名は必須です'); return }
    setSaving(true)
    try {
      await updateCustomer(customer.id, editForm)
      setEditModal(false)
      onReload()
      toast('顧客情報を保存しました')
    } catch (e) { setError(String(e)) } finally { setSaving(false) }
  }

  async function handleSaveProject() {
    if (!projectForm.project_name.trim()) { setError('案件名は必須です'); return }
    setSaving(true)
    try {
      await createProject({ ...projectForm, customer_id: customer.id })
      setProjectModal(false)
      onReload()
      toast('案件を追加しました')
    } catch (e) { setError(String(e)) } finally { setSaving(false) }
  }

  // ── ファイル選択 ──────────────────────────────────────────

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setUploadFile(file)
    setUploadErr('')
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const file = e.dataTransfer.files[0] ?? null
    setUploadFile(file)
    setUploadErr('')
  }

  async function handleUpload() {
    if (!uploadFile) { setUploadErr('ファイルを選択してください'); return }
    setUploading(true); setUploadErr('')
    try {
      await uploadAttachment(customer.id, uploadFile, uploadDesc)
      setUploadModal(false)
      setUploadFile(null)
      setUploadDesc('')
      onReload()
      toast('ファイルをアップロードしました')
    } catch (e) {
      setUploadErr(String(e))
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteAttachment(id: number, fileUrl: string) {
    if (!confirm('この添付ファイルを削除しますか？')) return
    await deleteAttachment(id, fileUrl)
    onReload()
    toast('ファイルを削除しました')
  }

  return (
    <>
      <button className="back-btn" onClick={onBack}>← 顧客一覧に戻る</button>

      <div className="card">
        <div className="card-header-row">
          <h3 className="section-title" style={{ margin: 0 }}>顧客情報</h3>
          <button className="btn btn-sub btn-sm" onClick={() => { setEditForm({
            name: customer.name,
            name_kana: customer.name_kana ?? '',
            company_name: customer.company_name ?? '',
            is_corporate: customer.is_corporate,
            email: customer.email ?? '',
            phone: customer.phone ?? '',
            postal_code: customer.postal_code ?? '',
            address: customer.address ?? '',
            notes: customer.notes ?? '',
          }); setError(''); setEditModal(true) }}>
            編集
          </button>
        </div>
        {customer.is_corporate ? (
          <div className="info-grid">
            <div className="info-field"><span>種別</span><b>法人</b></div>
            <div className="info-field"><span>会社名</span><b>{customer.company_name ?? '-'}</b></div>
            <div className="info-field"><span>担当者名</span><b>{customer.name}</b></div>
            <div className="info-field"><span>ふりがな</span><b>{customer.name_kana ?? '-'}</b></div>
            <div className="info-field"><span>電話</span><b>{customer.phone ?? '-'}</b></div>
            <div className="info-field"><span>メール</span><b>{customer.email ?? '-'}</b></div>
            <div className="info-field"><span>郵便番号</span><b>{customer.postal_code ?? '-'}</b></div>
            <div className="info-field"><span>住所</span><b>{customer.address ?? '-'}</b></div>
            <div className="info-field" style={{ gridColumn: '1/-1' }}><span>備考</span><b style={{ whiteSpace: 'pre-wrap', minHeight: '5lh' }}>{customer.notes || '-'}</b></div>
          </div>
        ) : (
          <div className="info-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="info-field"><span>種別</span><b>個人</b></div>
            <div className="info-field"><span>顧客名</span><b>{customer.name}</b></div>
            <div className="info-field"><span>ふりがな</span><b>{customer.name_kana ?? '-'}</b></div>
            <div className="info-field"><span>電話</span><b>{customer.phone ?? '-'}</b></div>
            <div className="info-field" style={{ gridColumn: '2 / -1' }}><span>メール</span><b>{customer.email ?? '-'}</b></div>
            <div className="info-field"><span>郵便番号</span><b>{customer.postal_code ?? '-'}</b></div>
            <div className="info-field" style={{ gridColumn: '2 / -1' }}><span>住所</span><b>{customer.address ?? '-'}</b></div>
            <div className="info-field" style={{ gridColumn: '1/-1' }}><span>備考</span><b style={{ whiteSpace: 'pre-wrap', minHeight: '5lh' }}>{customer.notes || '-'}</b></div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header-row">
          <h3 className="section-title" style={{ margin: 0 }}>案件一覧（{projects.length} 件）</h3>
          <button className="btn btn-main btn-sm" onClick={() => { setProjectForm(emptyProject); setError(''); setProjectModal(true) }}>
            ＋ 案件を追加
          </button>
        </div>
        {projects.length === 0 ? (
          <p className="empty-cell">案件がありません</p>
        ) : (
          <table>
            <thead>
              <tr><th>案件名</th><th>都道府県</th><th>FIT</th><th>委託先</th><th>保守開始日</th></tr>
            </thead>
            <tbody>
              {projects.map(p => (
                <tr key={p.id} className="clickable-row" onClick={() => onViewProject(p.id)}>
                  <td>
                    <strong>{p.project_name}</strong>
                    {p.project_no && <div style={{ fontSize: 11, color: '#64748b' }}>{p.project_no}</div>}
                  </td>
                  <td>{p.site_prefecture ?? '-'}</td>
                  <td>{p.fit_period != null ? `${p.fit_period}円` : '-'}</td>
                  <td>{p.subcontractor ?? '-'}</td>
                  <td>{p.maintenance_start_date ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── 添付ファイル ── */}
      <div className="card">
        <div className="card-header-row">
          <h3 className="section-title" style={{ margin: 0 }}>
            添付ファイル（{attachments.length} 件）
          </h3>
          <button className="btn btn-main btn-sm" onClick={() => { setUploadFile(null); setUploadDesc(''); setUploadErr(''); setUploadModal(true) }}>
            ＋ ファイルを追加
          </button>
        </div>

        {attachments.length === 0 ? (
          <p className="empty-cell">添付ファイルがありません</p>
        ) : (
          <div className="attachment-list">
            {attachments.map(a => (
              <div key={a.id} className="attachment-item">
                <span className="attachment-icon">
                  {a.file_type === 'pdf' ? '📄' : a.file_type === 'image' ? '🖼' : '📎'}
                </span>
                <div className="attachment-info">
                  <div className="attachment-name">{a.file_name}</div>
                  {a.description && <div className="attachment-desc">{a.description}</div>}
                  <div className="attachment-date">{fmtDate(a.uploaded_at)}</div>
                </div>
                <div className="attachment-actions">
                  <a href={a.file_url} target="_blank" rel="noopener noreferrer" className="btn btn-sub btn-sm">
                    開く
                  </a>
                  <button className="btn-icon" title="削除" onClick={() => handleDeleteAttachment(a.id, a.file_url)}>
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 顧客編集モーダル */}
      {editModal && (
        <Modal title="顧客情報を編集" onClose={() => setEditModal(false)}>
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <label className="form-label required">
              顧客名
              <input className="form-input" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="form-label">
              ふりがな
              <input className="form-input" value={editForm.name_kana} onChange={e => setEditForm(f => ({ ...f, name_kana: e.target.value }))} placeholder="やまだ たろう" />
            </label>
            <label className="form-label">
              会社名（法人の場合）
              <input className="form-input" value={editForm.company_name} onChange={e => setEditForm(f => ({ ...f, company_name: e.target.value, is_corporate: !!e.target.value }))} />
            </label>
            <label className="form-label">
              電話番号
              <input className="form-input" type="tel" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
            </label>
            <label className="form-label">
              メールアドレス
              <input className="form-input" type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="form-label">
              郵便番号
              <input className="form-input" value={editForm.postal_code} onChange={e => setEditForm(f => ({ ...f, postal_code: e.target.value }))} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              住所
              <input className="form-input" value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              備考
              <textarea className="form-input" rows={3} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
            </label>
          </div>
          <div className="modal-footer">
            <button className="btn btn-sub" onClick={() => setEditModal(false)}>キャンセル</button>
            <button className="btn btn-main" onClick={handleSaveCustomer} disabled={saving}>{saving ? '保存中...' : '保存する'}</button>
          </div>
        </Modal>
      )}

      {/* 案件追加モーダル */}
      {projectModal && (
        <Modal title="案件を追加" onClose={() => setProjectModal(false)}>
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <label className="form-label required" style={{ gridColumn: '1/-1' }}>
              案件名
              <input className="form-input" value={projectForm.project_name} onChange={e => setProjectForm(f => ({ ...f, project_name: e.target.value }))} />
            </label>
            <label className="form-label">
              案件番号
              <input className="form-input" value={projectForm.project_no} onChange={e => setProjectForm(f => ({ ...f, project_no: e.target.value }))} />
            </label>
            <label className="form-label">
              都道府県
              <input className="form-input" value={projectForm.site_prefecture} onChange={e => setProjectForm(f => ({ ...f, site_prefecture: e.target.value }))} />
            </label>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              設置住所
              <input className="form-input" value={projectForm.site_address} onChange={e => setProjectForm(f => ({ ...f, site_address: e.target.value }))} />
            </label>
            <label className="form-label">
              FIT（円）
              <input className="form-input" type="number" value={projectForm.fit_period} onChange={e => setProjectForm(f => ({ ...f, fit_period: e.target.value }))} />
            </label>
            <label className="form-label">
              引渡日
              <input className="form-input" type="date" value={projectForm.handover_date} onChange={e => setProjectForm(f => ({ ...f, handover_date: e.target.value }))} />
            </label>
          </div>
          <div className="modal-footer">
            <button className="btn btn-sub" onClick={() => setProjectModal(false)}>キャンセル</button>
            <button className="btn btn-main" onClick={handleSaveProject} disabled={saving}>{saving ? '保存中...' : '追加する'}</button>
          </div>
        </Modal>
      )}

      {/* ファイルアップロードモーダル */}
      {uploadModal && (
        <Modal title="ファイルを追加" onClose={() => setUploadModal(false)}>
          {uploadErr && <div className="form-error">{uploadErr}</div>}

          {/* ドロップゾーン */}
          <div
            className={`upload-dropzone ${uploadFile ? 'upload-dropzone--selected' : ''}`}
            onDragOver={e => e.preventDefault()}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            {uploadFile ? (
              <>
                <div className="upload-file-icon">
                  {uploadFile.type.includes('pdf') ? '📄' : uploadFile.type.startsWith('image/') ? '🖼' : '📎'}
                </div>
                <div className="upload-file-name">{uploadFile.name}</div>
                <div className="upload-file-size">{(uploadFile.size / 1024).toFixed(0)} KB</div>
                <div className="upload-change-hint">クリックでファイルを変更</div>
              </>
            ) : (
              <>
                <div className="upload-drop-icon">📂</div>
                <div className="upload-drop-text">クリックまたはドラッグ＆ドロップでファイルを選択</div>
                <div className="upload-drop-hint">PDF・画像・Word・Excel など</div>
              </>
            )}
          </div>

          <div className="form-grid" style={{ marginTop: 16 }}>
            <label className="form-label" style={{ gridColumn: '1/-1' }}>
              説明（任意）
              <input
                className="form-input"
                placeholder="例：保守契約書、完了証明書 など"
                value={uploadDesc}
                onChange={e => setUploadDesc(e.target.value)}
              />
            </label>
          </div>

          <div className="modal-footer">
            <button className="btn btn-sub" onClick={() => setUploadModal(false)}>キャンセル</button>
            <button className="btn btn-main" onClick={handleUpload} disabled={uploading || !uploadFile}>
              {uploading ? 'アップロード中...' : 'アップロード'}
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
