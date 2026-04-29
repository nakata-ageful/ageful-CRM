import { useState } from 'react'
import type { Prospect, ProspectApplyStatus, ProspectContractStatus } from '../types'
import { updateProspect } from '../lib/actions'
import { fmtNum } from '../lib/utils'
import { buildTaskMap, buildSubTaskMap, tasksForCompany } from '../lib/prospect-tasks'

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
  onAddTask, onRemoveTask, onAddSubTask, onRemoveSubTask,
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
  onAddTask: (name: string) => void
  onRemoveTask: (name: string) => void
  onAddSubTask: (taskName: string, subName: string) => void
  onRemoveSubTask: (taskName: string, subName: string) => void
}) {
  const [newTask, setNewTask] = useState('')
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null)
  const [newSub, setNewSub] = useState('')

  // 定義順でソート、定義にないカスタム項目は末尾に追加
  const definedOrder = tasksForCompany(mode, company).map(t => t.name)
  const allKeys = Object.keys(checkedMap)
  const taskNames = [
    ...definedOrder.filter(n => allKeys.includes(n)),
    ...allKeys.filter(n => !definedOrder.includes(n)),
  ]

  function handleAddTask() {
    const name = newTask.trim()
    if (!name || checkedMap[name] !== undefined) return
    onAddTask(name)
    setNewTask('')
  }

  function handleAddSub(taskName: string) {
    const name = newSub.trim()
    if (!name) return
    if (subTaskMap[taskName]?.[name] !== undefined) return
    onAddSubTask(taskName, name)
    setNewSub('')
    setAddingSubFor(null)
  }

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12, borderBottom: '2px solid #f1f5f9' }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{title}</span>
        {mode === 'apply' ? <ApplyBadge status={status as ProspectApplyStatus} /> : <ContractBadge status={status as ProspectContractStatus} />}
      </div>

      {/* タスクリスト */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {taskNames.map(taskName => {
          const subs = subTaskMap[taskName] ? Object.keys(subTaskMap[taskName]) : []
          return (
            <div key={taskName}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <label className="prospect-task-line" style={{ flex: 1 }}>
                  <input
                    type="checkbox"
                    className="prospect-checkbox"
                    checked={Boolean(checkedMap[taskName])}
                    onChange={e => onTaskChange(taskName, e.target.checked)}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500, color: '#1e293b' }}>{taskName}</span>
                </label>
                <button
                  onClick={() => { setAddingSubFor(addingSubFor === taskName ? null : taskName); setNewSub('') }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#94a3b8', padding: '2px 4px' }}
                  title="小項目を追加"
                >+小</button>
                <button
                  onClick={() => { if (confirm(`「${taskName}」を削除しますか？`)) onRemoveTask(taskName) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#cbd5e1', padding: '2px 4px' }}
                  title="削除"
                >✕</button>
              </div>
              {subs.length > 0 && (
                <div style={{ marginLeft: 24, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {subs.map(sub => (
                    <div key={sub} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <label className="prospect-task-line" style={{ flex: 1 }}>
                        <input
                          type="checkbox"
                          className="prospect-checkbox"
                          checked={Boolean(subTaskMap[taskName]?.[sub])}
                          onChange={e => onSubTaskChange(taskName, sub, e.target.checked)}
                        />
                        <span style={{ fontSize: 12.5, color: '#64748b' }}>{sub}</span>
                      </label>
                      <button
                        onClick={() => { if (confirm(`「${sub}」を削除しますか？`)) onRemoveSubTask(taskName, sub) }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#cbd5e1', padding: '2px 4px' }}
                        title="削除"
                      >✕</button>
                    </div>
                  ))}
                </div>
              )}
              {addingSubFor === taskName && (
                <div style={{ marginLeft: 24, marginTop: 4, display: 'flex', gap: 4 }}>
                  <input
                    type="text"
                    className="form-input"
                    style={{ fontSize: 12, padding: '3px 8px', flex: 1 }}
                    value={newSub}
                    onChange={e => setNewSub(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAddSub(taskName); if (e.key === 'Escape') setAddingSubFor(null) }}
                    placeholder="小項目名を入力..."
                    autoFocus
                  />
                  <button
                    onClick={() => handleAddSub(taskName)}
                    style={{ fontSize: 11, padding: '3px 8px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 5, cursor: 'pointer' }}
                  >追加</button>
                </div>
              )}
            </div>
          )
        })}
        {taskNames.length === 0 && (
          <p style={{ fontSize: 12.5, color: '#94a3b8' }}>項目がありません</p>
        )}
      </div>

      {/* 大項目追加 */}
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          type="text"
          className="form-input"
          style={{ fontSize: 12.5, padding: '4px 8px', flex: 1 }}
          value={newTask}
          onChange={e => setNewTask(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleAddTask() }}
          placeholder="大項目を追加..."
        />
        <button
          onClick={handleAddTask}
          disabled={!newTask.trim()}
          style={{ fontSize: 12, padding: '4px 10px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 5, cursor: 'pointer', opacity: newTask.trim() ? 1 : 0.5 }}
        >追加</button>
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
          rows={10}
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

// ── メイン ────────────────────────────────────────────────

export function ProspectDetailView({
  prospect: initial,
  onBack,
  onViewCustomer,
}: {
  prospect: Prospect
  onBack: () => void
  onViewCustomer: (customerId: number) => void
}) {
  const [p, setP] = useState<Prospect>(initial)
  const [saving, setSaving] = useState(false)

  async function save(updated: Partial<Omit<Prospect, 'id' | 'created_at'>>) {
    const next = { ...p, ...updated }
    setP(next)
    setSaving(true)
    await updateProspect(p.id, updated, p.converted_customer_id)
    setSaving(false)
  }

  async function handleLoanCompanyChange(company: string | null) {
    const c = company || ''
    save({
      loan_company: company,
      apply_tasks: buildTaskMap('apply', c),
      contract_tasks: buildTaskMap('contract', c),
      apply_sub_tasks: buildSubTaskMap('apply', c),
      contract_sub_tasks: buildSubTaskMap('contract', c),
    })
  }


  const total = (p.equipment ?? 0) + (p.land_cost ?? 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ヘッダー */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button className="back-btn" onClick={onBack}>← 一覧へ</button>
        <div style={{ flex: 1 }} />
        {saving && <span style={{ fontSize: 12, color: '#94a3b8' }}>保存中...</span>}
        {p.converted_customer_id && (
          <button className="btn btn-main btn-sm" onClick={() => onViewCustomer(p.converted_customer_id!)}>顧客・案件を見る →</button>
        )}
      </div>

      {/* 金額カード */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {([
          { label: '設備代', key: 'equipment' as const, value: p.equipment },
          { label: '土地代', key: 'land_cost' as const, value: p.land_cost },
          { label: '合計', key: null, value: total },
          { label: '融資額', key: 'loan_amount' as const, value: p.loan_amount },
        ] as const).map(({ label, key, value }) => (
          <div key={label} className="kpi-card" style={{ borderLeftColor: label === '融資額' ? '#0ea5e9' : undefined }}>
            <div className="kpi-label">{label}</div>
            {key ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
                <input
                  type="text"
                  inputMode="numeric"
                  className="form-input"
                  style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', width: '100%', padding: '2px 6px', textAlign: 'right' }}
                  value={value != null ? fmtNum(value) : ''}
                  onChange={e => {
                    const raw = e.target.value.replace(/,/g, '')
                    const v = raw ? Number(raw) : null
                    if (raw && isNaN(Number(raw))) return
                    save({ [key]: v })
                  }}
                  placeholder="0"
                />
                <span style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8', flexShrink: 0 }}>円</span>
              </div>
            ) : (
              <div style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', lineHeight: 1 }}>
                {fmtNum(value)}<span style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8', marginLeft: 2 }}>円</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 基本情報 */}
      <div className="card">
        <div className="section-title">基本情報</div>
        <div className="info-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {/* 1行目: 顧客名 / ふりがな / パネル容量 */}
          <div className="info-field">
            <span>顧客名</span>
            <input
              type="text" className="form-input" style={{ marginTop: 4 }}
              value={p.customer_name}
              onChange={e => save({ customer_name: e.target.value })}
            />
          </div>
          <div className="info-field">
            <span>フリガナ</span>
            <input
              type="text" className="form-input" style={{ marginTop: 4 }}
              value={p.customer_name_kana ?? ''}
              onChange={e => save({ customer_name_kana: e.target.value || null })}
              placeholder="やまだ たろう"
            />
          </div>
          <div className="info-field">
            <span>パネル容量 (kW)</span>
            <input
              type="text" inputMode="decimal" className="form-input" style={{ marginTop: 4 }}
              value={p.panel_kw ?? ''}
              onChange={e => {
                const v = e.target.value
                if (v === '' || /^[\d.]*$/.test(v)) save({ panel_kw: v ? Number(v) : null })
              }}
              placeholder="0"
            />
          </div>
          {/* 2行目: 発電所名 / 物件所在地 / 信販利用 */}
          <div className="info-field">
            <span>発電所名</span>
            <input
              type="text" className="form-input" style={{ marginTop: 4 }}
              value={p.project_name}
              onChange={e => save({ project_name: e.target.value })}
            />
          </div>
          <div className="info-field">
            <span>物件所在地</span>
            <input
              type="text" className="form-input" style={{ marginTop: 4 }}
              value={p.site_address ?? ''}
              onChange={e => save({ site_address: e.target.value || null })}
              placeholder="茨城県鹿嶋市..."
            />
          </div>
          <div className="info-field">
            <span>信販利用</span>
            <select
              className="form-input" style={{ marginTop: 4 }}
              value={p.loan_company ?? ''}
              onChange={e => handleLoanCompanyChange(e.target.value || null)}
            >
              <option value="">未設定</option>
              <option value="アプラス">アプラス</option>
              <option value="ジャックス">ジャックス</option>
              <option value="なし">なし</option>
            </select>
          </div>
          {/* 3行目: 販売会社 / 紹介者 */}
          <div className="info-field">
            <span>販売会社</span>
            <input
              type="text" className="form-input" style={{ marginTop: 4 }}
              value={p.sales_company ?? ''}
              onChange={e => save({ sales_company: e.target.value || null })}
              placeholder="販売会社名"
            />
          </div>
          <div className="info-field">
            <span>紹介者</span>
            <input
              type="text" className="form-input" style={{ marginTop: 4 }}
              value={p.referrer ?? ''}
              onChange={e => save({ referrer: e.target.value || null })}
              placeholder="紹介者名"
            />
          </div>
        </div>
      </div>

      {/* 日付情報 */}
      <div className="card">
        <div className="section-title">日付</div>
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
          onAddTask={name => save({ apply_tasks: { ...p.apply_tasks, [name]: false } })}
          onRemoveTask={name => {
            const { [name]: _, ...rest } = p.apply_tasks
            const { [name]: __, ...restSub } = p.apply_sub_tasks
            save({ apply_tasks: rest, apply_sub_tasks: restSub })
          }}
          onAddSubTask={(taskName, subName) =>
            save({ apply_sub_tasks: { ...p.apply_sub_tasks, [taskName]: { ...(p.apply_sub_tasks[taskName] ?? {}), [subName]: false } } })
          }
          onRemoveSubTask={(taskName, subName) => {
            const { [subName]: _, ...rest } = (p.apply_sub_tasks[taskName] ?? {})
            save({ apply_sub_tasks: { ...p.apply_sub_tasks, [taskName]: rest } })
          }}
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
          onAddTask={name => save({ contract_tasks: { ...p.contract_tasks, [name]: false } })}
          onRemoveTask={name => {
            const { [name]: _, ...rest } = p.contract_tasks
            const { [name]: __, ...restSub } = p.contract_sub_tasks
            save({ contract_tasks: rest, contract_sub_tasks: restSub })
          }}
          onAddSubTask={(taskName, subName) =>
            save({ contract_sub_tasks: { ...p.contract_sub_tasks, [taskName]: { ...(p.contract_sub_tasks[taskName] ?? {}), [subName]: false } } })
          }
          onRemoveSubTask={(taskName, subName) => {
            const { [subName]: _, ...rest } = (p.contract_sub_tasks[taskName] ?? {})
            save({ contract_sub_tasks: { ...p.contract_sub_tasks, [taskName]: rest } })
          }}
        />
      </div>

    </div>
  )
}
