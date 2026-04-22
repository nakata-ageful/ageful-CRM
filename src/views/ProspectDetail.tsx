import { useState } from 'react'
import type { Prospect, ProspectApplyStatus, ProspectContractStatus } from '../types'
import { updateProspect, convertProspectToCustomer } from '../lib/actions'
import { fmtNum } from '../lib/utils'
import { tasksForCompany } from '../lib/prospect-tasks'

const APPLY_STATUSES: ProspectApplyStatus[] = ['未', '提出済', '通過', '不通', '不可']
const CONTRACT_STATUSES: ProspectContractStatus[] = ['未', '完了', '不可']


function ApplyBadge({ status }: { status: ProspectApplyStatus }) {
  return <span className={`prospect-badge prospect-apply-${status}`}>{status}</span>
}
function ContractBadge({ status }: { status: ProspectContractStatus }) {
  return <span className={`prospect-badge prospect-contract-${status}`}>{status}</span>
}

// ── タスクパネル ──────────────────────────────────────────

function TaskPanel({
  title, mode, company, checkedMap, subTaskMap, status, memo, statuses,
  onTaskChange, onSubTaskChange, onStatusChange, onMemoChange,
}: {
  title: string
  mode: 'apply' | 'contract'
  company: string
  checkedMap: Record<string, boolean>
  subTaskMap: Record<string, Record<string, boolean>>
  status: ProspectApplyStatus | ProspectContractStatus
  memo: string
  statuses: string[]
  onTaskChange: (name: string, checked: boolean) => void
  onSubTaskChange: (name: string, sub: string, checked: boolean) => void
  onStatusChange: (s: string) => void
  onMemoChange: (v: string) => void
}) {
  const tasks = tasksForCompany(mode, company)

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '2px solid #f1f5f9' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{title}</span>
        {mode === 'apply' ? <ApplyBadge status={status as ProspectApplyStatus} /> : <ContractBadge status={status as ProspectContractStatus} />}
      </div>

      {/* タスクリスト */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {tasks.map(task => (
          <div key={task.name}>
            <label className="prospect-task-line">
              <input
                type="checkbox"
                className="prospect-checkbox"
                checked={Boolean(checkedMap[task.name])}
                onChange={e => onTaskChange(task.name, e.target.checked)}
              />
              <span style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>{task.name}</span>
            </label>
            {task.subTasks.length > 0 && (
              <div style={{ marginLeft: 24, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {task.subTasks.map(sub => (
                  <label key={sub} className="prospect-task-line">
                    <input
                      type="checkbox"
                      className="prospect-checkbox"
                      checked={Boolean(subTaskMap[task.name]?.[sub])}
                      onChange={e => onSubTaskChange(task.name, sub, e.target.checked)}
                    />
                    <span style={{ fontSize: 12.5, color: '#64748b' }}>{sub}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
        {tasks.length === 0 && (
          <p style={{ fontSize: 12.5, color: '#94a3b8' }}>ローン会社を設定するとタスクが表示されます</p>
        )}
      </div>

      {/* ステータス */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#94a3b8' }}>ステータス</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {statuses.map(s => (
            <button
              key={s}
              className={`prospect-status-btn prospect-status-btn--${mode === 'apply' ? s : s + '-contract'} ${status === s ? 'active' : ''}`}
              onClick={() => onStatusChange(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* メモ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#94a3b8' }}>メモ</span>
        <textarea
          rows={3}
          style={{ width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13.5, fontFamily: 'inherit', resize: 'vertical', outline: 'none' }}
          value={memo}
          onChange={e => onMemoChange(e.target.value)}
          placeholder="メモを入力..."
          onFocus={e => { e.target.style.borderColor = '#38bdf8'; e.target.style.boxShadow = '0 0 0 3px rgba(56,189,248,.12)' }}
          onBlur={e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = '' }}
        />
      </div>
    </div>
  )
}

// ── 変換確認モーダル ──────────────────────────────────────

function ConvertModal({
  prospect,
  onConfirm,
  onClose,
}: {
  prospect: Prospect
  onConfirm: () => Promise<void>
  onClose: () => void
}) {
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    setLoading(true)
    await onConfirm()
    setLoading(false)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">顧客管理へ登録</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize: 13.5, color: '#374151', marginBottom: 16 }}>
            以下のデータを顧客管理システムへ登録します。登録後は「案件」ページで続きの情報を入力してください。
          </p>
          <div className="info-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="info-field"><span>顧客名</span><b>{prospect.customer_name}</b></div>
            <div className="info-field"><span>物件名</span><b>{prospect.project_name}</b></div>
            <div className="info-field"><span>ローン会社</span><b>{prospect.loan_company ?? '未設定'}</b></div>
            <div className="info-field"><span>物件所在地</span><b>{prospect.site_address ?? '—'}</b></div>
            <div className="info-field"><span>設備費</span><b>{fmtNum(prospect.equipment)} 円</b></div>
            <div className="info-field"><span>土地費</span><b>{fmtNum(prospect.land_cost)} 円</b></div>
            <div className="info-field"><span>融資額</span><b>{fmtNum(prospect.loan_amount)} 円</b></div>
            <div className="info-field"><span>売買契約日</span><b>{prospect.sale_contract_date ?? '—'}</b></div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-sub" onClick={onClose}>キャンセル</button>
            <button className="btn btn-main" onClick={handleConfirm} disabled={loading}>
              {loading ? '登録中...' : '登録する'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── メイン ────────────────────────────────────────────────

export function ProspectDetailView({
  prospect: initial,
  onBack,
  onConverted,
}: {
  prospect: Prospect
  onBack: () => void
  onConverted: (customerId: number) => void
}) {
  const [p, setP] = useState<Prospect>(initial)
  const [showConvert, setShowConvert] = useState(false)
  const [saving, setSaving] = useState(false)

  async function save(updated: Partial<Omit<Prospect, 'id' | 'created_at'>>) {
    const next = { ...p, ...updated }
    setP(next)
    setSaving(true)
    await updateProspect(p.id, updated)
    setSaving(false)
  }

  async function handleConvert() {
    const customerId = await convertProspectToCustomer(p)
    setP(prev => ({ ...prev, converted_customer_id: customerId, converted_at: new Date().toISOString() }))
    setShowConvert(false)
    onConverted(customerId)
  }

  const total = (p.equipment ?? 0) + (p.land_cost ?? 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button className="back-btn" onClick={onBack}>← 一覧へ</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <span style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>{p.customer_name}</span>
          <span style={{ fontSize: 14, color: '#64748b', fontWeight: 500 }}>{p.project_name}</span>
          {p.loan_company && (
            <span style={{ background: '#e0f2fe', color: '#0369a1', fontSize: 11.5, fontWeight: 600, borderRadius: 99, padding: '2px 9px' }}>{p.loan_company}</span>
          )}
        </div>
        {saving && <span style={{ fontSize: 12, color: '#94a3b8' }}>保存中...</span>}
        {p.converted_customer_id ? (
          <span style={{ fontSize: 12.5, background: '#d1fae5', color: '#065f46', borderRadius: 99, padding: '4px 12px', fontWeight: 600 }}>✓ 顧客管理済</span>
        ) : p.contract_status === '完了' ? (
          <button className="btn btn-main btn-sm" onClick={() => setShowConvert(true)}>顧客管理へ登録 →</button>
        ) : null}
      </div>

      {/* 金額カード */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: '設備費', value: p.equipment },
          { label: '土地費', value: p.land_cost },
          { label: '合計', value: total },
          { label: '融資額', value: p.loan_amount },
        ].map(({ label, value }) => (
          <div key={label} className="kpi-card" style={{ borderLeftColor: label === '融資額' ? '#0ea5e9' : undefined }}>
            <div className="kpi-label">{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
              {fmtNum(value)}<span style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8', marginLeft: 2 }}>円</span>
            </div>
          </div>
        ))}
      </div>

      {/* 日付・住所情報 */}
      <div className="card">
        <div className="section-title">基本情報</div>
        <div className="info-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="info-field">
            <span>商談開始日</span>
            <input
              type="date" className="form-input" style={{ marginTop: 4 }}
              value={p.lead_date ?? ''}
              onChange={e => save({ lead_date: e.target.value || null })}
            />
          </div>
          <div className="info-field">
            <span>申込提出日</span>
            <input
              type="date" className="form-input" style={{ marginTop: 4 }}
              value={p.apply_submit_date ?? ''}
              onChange={e => save({ apply_submit_date: e.target.value || null })}
            />
          </div>
          <div className="info-field">
            <span>審査結果日</span>
            <input
              type="date" className="form-input" style={{ marginTop: 4 }}
              value={p.apply_result_date ?? ''}
              onChange={e => save({ apply_result_date: e.target.value || null })}
            />
          </div>
          <div className="info-field">
            <span>売買契約日</span>
            <input
              type="date" className="form-input" style={{ marginTop: 4 }}
              value={p.sale_contract_date ?? ''}
              onChange={e => save({ sale_contract_date: e.target.value || null })}
            />
          </div>
          <div className="info-field">
            <span>土地契約日</span>
            <input
              type="date" className="form-input" style={{ marginTop: 4 }}
              value={p.land_contract_date ?? ''}
              onChange={e => save({ land_contract_date: e.target.value || null })}
            />
          </div>
          <div className="info-field">
            <span>引渡し予定日</span>
            <input
              type="date" className="form-input" style={{ marginTop: 4 }}
              value={p.handover_date ?? ''}
              onChange={e => save({ handover_date: e.target.value || null })}
            />
          </div>
          <div className="info-field" style={{ gridColumn: '1 / -1' }}>
            <span>物件所在地</span>
            <input
              type="text" className="form-input" style={{ marginTop: 4 }}
              value={p.site_address ?? ''}
              onChange={e => save({ site_address: e.target.value || null })}
              placeholder="茨城県鹿嶋市..."
            />
          </div>
        </div>
      </div>

      {/* タスクパネル */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <TaskPanel
          title="申込"
          mode="apply"
          company={p.loan_company ?? ''}
          checkedMap={p.apply_tasks}
          subTaskMap={p.apply_sub_tasks}
          status={p.apply_status}
          memo={p.apply_memo ?? ''}
          statuses={APPLY_STATUSES}
          onTaskChange={(name, checked) => save({ apply_tasks: { ...p.apply_tasks, [name]: checked } })}
          onSubTaskChange={(name, sub, checked) =>
            save({ apply_sub_tasks: { ...p.apply_sub_tasks, [name]: { ...(p.apply_sub_tasks[name] ?? {}), [sub]: checked } } })
          }
          onStatusChange={s => save({ apply_status: s as ProspectApplyStatus })}
          onMemoChange={v => save({ apply_memo: v || null })}
        />
        <TaskPanel
          title="契約"
          mode="contract"
          company={p.loan_company ?? ''}
          checkedMap={p.contract_tasks}
          subTaskMap={p.contract_sub_tasks}
          status={p.contract_status}
          memo={p.contract_memo ?? ''}
          statuses={CONTRACT_STATUSES}
          onTaskChange={(name, checked) => save({ contract_tasks: { ...p.contract_tasks, [name]: checked } })}
          onSubTaskChange={(name, sub, checked) =>
            save({ contract_sub_tasks: { ...p.contract_sub_tasks, [name]: { ...(p.contract_sub_tasks[name] ?? {}), [sub]: checked } } })
          }
          onStatusChange={s => save({ contract_status: s as ProspectContractStatus })}
          onMemoChange={v => save({ contract_memo: v || null })}
        />
      </div>

      {showConvert && (
        <ConvertModal
          prospect={p}
          onConfirm={handleConvert}
          onClose={() => setShowConvert(false)}
        />
      )}
    </div>
  )
}
