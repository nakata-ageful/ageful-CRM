import { useState } from 'react'
import type { BillingDetail, BillingLineItem, PaymentEntry, MaintenanceResponse, PeriodicMaintenance } from '../types'
import { updateAnnualRecord, createAnnualRecord, deleteAnnualRecord, updateContract } from '../lib/actions'
import { fmtYen, fmtDate } from '../lib/utils'
import { useToast } from '../components/Toast'

type LineItemForm = { name: string; amount: string }

/** 契約から請求回数を算出（billing_count 優先、なければ年間保守料÷請求金額） */
function calcBillingCount(contract: { billing_count?: number | null; annual_maintenance_inc?: number | null; billing_amount_inc?: number | null }): number {
  if (contract.billing_count && contract.billing_count > 0) return contract.billing_count
  if (contract.annual_maintenance_inc && contract.billing_amount_inc && contract.billing_amount_inc > 0) {
    const count = Math.round(contract.annual_maintenance_inc / contract.billing_amount_inc)
    return count > 0 ? count : 1
  }
  return 1
}

type Props = {
  detail: BillingDetail
  onBack: () => void
  onReload: () => void
  onViewProject: (projectId: number) => void
}


export function BillingDetailView({ detail, onBack, onReload, onViewProject }: Props) {
  const toast = useToast()
  const { project, customer, contract, annualRecords, maintenanceResponses, periodicMaintenance } = detail
  const currentYear = new Date().getFullYear()

  const currentRecord = annualRecords.find(r => r.year === currentYear) ?? null
  const historyRecords = annualRecords.filter(r => r.year !== currentYear).sort((a, b) => b.year - a.year)

  function initLineItems(): LineItemForm[] {
    if (currentRecord?.line_items?.length) {
      return currentRecord.line_items.map(i => ({ name: i.name, amount: i.amount.toString() }))
    }
    const defaults: LineItemForm[] = []
    if (contract.annual_maintenance_inc) defaults.push({ name: '保守料', amount: contract.annual_maintenance_inc.toString() })
    if (contract.land_cost_monthly) defaults.push({ name: '土地代', amount: contract.land_cost_monthly.toString() })
    if (contract.insurance_fee) defaults.push({ name: '保険料', amount: contract.insurance_fee.toString() })
    if (contract.other_fee) defaults.push({ name: 'その他', amount: contract.other_fee.toString() })
    return defaults.length ? defaults : [{ name: '保守料', amount: '' }]
  }

  const isTransfer = contract.billing_method === '口座振替'
  const billingCount = calcBillingCount(contract)

  function initPayments(): PaymentEntry[] {
    if (currentRecord?.payments?.length) return currentRecord.payments
    // 既存の単一入金日がある場合は第1回に変換
    if (billingCount === 1) {
      return [{ seq: 1, scheduled_date: currentRecord?.billing_scheduled_date ?? null, billing_date: currentRecord?.billing_date ?? null, received_date: currentRecord?.received_date ?? null }]
    }
    return Array.from({ length: billingCount }, (_, i) => ({ seq: i + 1, scheduled_date: null, billing_date: null, received_date: null }))
  }

  const [scheduledDate, setScheduledDate] = useState(currentRecord?.billing_scheduled_date ?? '')
  const [billingDate, setBillingDate] = useState(currentRecord?.billing_date ?? '')
  const [paymentDueDate, setPaymentDueDate] = useState(currentRecord?.payment_due_date ?? '')
  const [receivedDate, setReceivedDate] = useState(currentRecord?.received_date ?? '')
  const [payments, setPayments] = useState<PaymentEntry[]>(initPayments)
  const [lineItems, setLineItems] = useState<LineItemForm[]>(initLineItems)
  const [saving, setSaving] = useState(false)
  const [transferFailed, setTransferFailed] = useState(currentRecord?.transfer_failed ?? false)

  // 履歴インライン編集
  const [editingHistoryId, setEditingHistoryId] = useState<number | null>(null)
  const [historyEdit, setHistoryEdit] = useState<{
    billing_date: string
    received_date: string
    line_items: LineItemForm[]
  }>({ billing_date: '', received_date: '', line_items: [] })

  function startHistoryEdit(r: typeof historyRecords[number]) {
    setEditingHistoryId(r.id)
    setHistoryEdit({
      billing_date: r.billing_date ?? '',
      received_date: r.received_date ?? '',
      line_items: r.line_items?.map(i => ({ name: i.name, amount: i.amount.toString() })) ?? [],
    })
  }

  function updateHistoryItem(i: number, field: keyof LineItemForm, value: string) {
    setHistoryEdit(prev => ({
      ...prev,
      line_items: prev.line_items.map((item, idx) => idx === i ? { ...item, [field]: value } : item),
    }))
  }

  async function saveHistoryEdit(id: number) {
    setSaving(true)
    const items: BillingLineItem[] = historyEdit.line_items
      .filter(i => i.name.trim())
      .map(i => ({ name: i.name.trim(), amount: parseInt(i.amount.replace(/,/g, '')) || 0 }))
    const newStatus = historyEdit.billing_date
      ? (historyEdit.received_date ? '入金済' : '請求済')
      : ''
    await updateAnnualRecord(id, {
      billing_date: historyEdit.billing_date || null,
      received_date: historyEdit.received_date || null,
      line_items: items.length ? items : null,
      status: newStatus,
    })
    setEditingHistoryId(null)
    await onReload()
    setSaving(false)
    toast('履歴を保存しました')
  }

  async function handleDeleteRecord(id: number, year: number) {
    if (!confirm(`${year}年度の年次記録を削除しますか？`)) return
    await deleteAnnualRecord(id)
    await onReload()
    toast(`${year}年度の年次記録を削除しました`)
  }

  const total = lineItems.reduce((sum, item) => sum + (parseInt(item.amount.replace(/,/g, '')) || 0), 0)

  function updateItem(i: number, field: keyof LineItemForm, value: string) {
    setLineItems(prev => prev.map((item, idx) => idx === i ? { ...item, [field]: value } : item))
  }

  function buildLineItems(): BillingLineItem[] {
    return lineItems
      .filter(i => i.name.trim())
      .map(i => ({ name: i.name.trim(), amount: parseInt(i.amount.replace(/,/g, '')) || 0 }))
  }

  async function handleSave() {
    setSaving(true)
    const items = buildLineItems()

    // 分割入金の場合: 全回入金済 → 入金済、一部 → 請求済、なし → ブランク
    // 単回の場合: 従来通り
    let effectiveReceivedDate = receivedDate
    let newStatus: '' | '請求済' | '入金済'

    if (billingCount > 1) {
      const allReceived = payments.every(p => !!p.received_date)
      const someBilled = payments.some(p => !!p.billing_date || !!p.scheduled_date)
      const lastReceived = [...payments].reverse().find(p => p.received_date)?.received_date ?? null
      effectiveReceivedDate = lastReceived ?? ''

      if (isTransfer && !transferFailed) {
        newStatus = allReceived ? '入金済' : (someBilled ? '請求済' : '')
      } else {
        newStatus = allReceived ? '入金済' : (someBilled ? '請求済' : '')
      }
    } else {
      newStatus = isTransfer && !transferFailed
        ? (receivedDate ? '入金済' : '')
        : (billingDate ? (receivedDate ? '入金済' : '請求済') : '')
    }

    const payload = {
      billing_scheduled_date: isTransfer ? null : (scheduledDate || null),
      billing_date: (isTransfer && !transferFailed) ? null : (billingDate || null),
      payment_due_date: paymentDueDate || null,
      received_date: effectiveReceivedDate || null,
      line_items: items.length ? items : null,
      payments: billingCount > 1 ? payments : null,
      transfer_failed: isTransfer ? transferFailed : null,
      status: newStatus,
    }

    if (currentRecord) {
      await updateAnnualRecord(currentRecord.id, payload)
    } else {
      await createAnnualRecord(contract.id, currentYear, payload)
    }
    await onReload()
    setSaving(false)
    toast('保存しました')
  }

  // 保守情報編集
  const [editingContract, setEditingContract] = useState(false)
  const [contractEdit, setContractEdit] = useState({
    contractor_name: contract.contractor_name ?? '',
    billing_method: contract.billing_method ?? '',
    billing_due_day: contract.billing_due_day ?? '',
    billing_amount_ex: contract.billing_amount_ex?.toString() ?? '',
    billing_amount_inc: contract.billing_amount_inc?.toString() ?? '',
    annual_maintenance_ex: contract.annual_maintenance_ex?.toString() ?? '',
    annual_maintenance_inc: contract.annual_maintenance_inc?.toString() ?? '',
    billing_count: contract.billing_count?.toString() ?? '',
    land_cost_monthly: contract.land_cost_monthly?.toString() ?? '',
    insurance_fee: contract.insurance_fee?.toString() ?? '',
    other_fee: contract.other_fee?.toString() ?? '',
    maintenance_contract_date: contract.maintenance_contract_date ?? '',
    maintenance_start_date: contract.maintenance_start_date ?? '',
    subcontractor: contract.subcontractor ?? '',
    subcontract_fee_ex: contract.subcontract_fee_ex?.toString() ?? '',
    subcontract_fee_inc: contract.subcontract_fee_inc?.toString() ?? '',
    subcontract_billing_day: contract.subcontract_billing_day ?? '',
    notes: contract.notes ?? '',
  })

  async function saveContractEdit() {
    setSaving(true)
    const toInt = (v: string) => v ? parseInt(v.replace(/,/g, '')) || null : null
    await updateContract(contract.id, {
      contractor_name: contractEdit.contractor_name || null,
      billing_method: contractEdit.billing_method || null,
      billing_due_day: contractEdit.billing_due_day || null,
      billing_amount_ex: toInt(contractEdit.billing_amount_ex),
      billing_amount_inc: toInt(contractEdit.billing_amount_inc),
      annual_maintenance_ex: toInt(contractEdit.annual_maintenance_ex),
      annual_maintenance_inc: toInt(contractEdit.annual_maintenance_inc),
      billing_count: toInt(contractEdit.billing_count),
      land_cost_monthly: toInt(contractEdit.land_cost_monthly),
      insurance_fee: toInt(contractEdit.insurance_fee),
      other_fee: toInt(contractEdit.other_fee),
      maintenance_contract_date: contractEdit.maintenance_contract_date || null,
      maintenance_start_date: contractEdit.maintenance_start_date || null,
      subcontractor: contractEdit.subcontractor || null,
      subcontract_fee_ex: toInt(contractEdit.subcontract_fee_ex),
      subcontract_fee_inc: toInt(contractEdit.subcontract_fee_inc),
      subcontract_billing_day: contractEdit.subcontract_billing_day || null,
      notes: contractEdit.notes || null,
    })
    setEditingContract(false)
    await onReload()
    setSaving(false)
    toast('保守情報を保存しました')
  }

  const custName = customer.company_name ?? customer.name

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button className="back-btn" onClick={onBack}>← 請求一覧へ</button>
        <button className="link-btn" onClick={() => onViewProject(project.id)}>{project.project_name}</button>
        <span style={{ color: '#64748b', fontSize: 13 }}>{custName}</span>
        {saving && <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 'auto' }}>保存中...</span>}
      </div>

      {/* 2-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 520px', gap: 20, alignItems: 'start' }}>

        {/* ── Left main panel ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 請求金額 */}
          <div className="card" style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', color: '#94a3b8' }}>
                請求金額（税込）
              </div>
              <span style={{
                fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 8px',
                background: isTransfer ? '#f0f9ff' : '#f8fafc',
                color: isTransfer ? '#0369a1' : '#475569',
              }}>
                {contract.billing_method ?? '—'}
              </span>
            </div>
            <div style={{ fontSize: 38, fontWeight: 800, color: '#0f172a', letterSpacing: '-1px', lineHeight: 1 }}>
              {total > 0 ? fmtYen(total) : '—'}
            </div>
          </div>

          {/* スケジュール + 明細 + ボタン */}
          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* ── 口座振替の場合 ── */}
            {isTransfer ? (
              <div>
                {/* 振替基本情報 */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>口座振替</div>
                  <span style={{ fontSize: 12, color: '#0ea5e9', fontWeight: 600 }}>
                    毎年 {contract.billing_due_day ?? '—'}
                  </span>
                </div>

                {/* 正常時: 入金日 */}
                {!transferFailed && (
                  <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '14px 16px', borderLeft: '3px solid #10b981', marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#059669', marginBottom: 8 }}>
                      正常振替
                    </div>
                    <label className="form-label">
                      <span style={{ color: '#64748b', fontSize: 11 }}>入金日（振替確認日）</span>
                      <input type="date" className="form-input" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} />
                    </label>
                  </div>
                )}

                {/* 振替不能トグル */}
                <div
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', borderRadius: 8,
                    background: transferFailed ? '#fef2f2' : '#f8fafc',
                    border: transferFailed ? '1px solid #fecaca' : '1px solid #e2e8f0',
                    cursor: 'pointer',
                  }}
                  onClick={() => setTransferFailed(prev => !prev)}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: transferFailed ? '#dc2626' : '#64748b' }}>
                      振替不能
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                      振替できなかった場合、請求書対応に切り替えます
                    </div>
                  </div>
                  {/* トグルスイッチ */}
                  <div style={{
                    width: 40, height: 22, borderRadius: 11, padding: 2,
                    background: transferFailed ? '#dc2626' : '#d1d5db',
                    transition: 'background 0.2s',
                    flexShrink: 0,
                  }}>
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', background: '#fff',
                      transform: transferFailed ? 'translateX(18px)' : 'translateX(0)',
                      transition: 'transform 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,.15)',
                    }} />
                  </div>
                </div>

                {/* 振替不能時: 請求書と同じフロー */}
                {transferFailed && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: '#fef2f2', borderRadius: 8, padding: '10px 14px', borderLeft: '3px solid #ef4444' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#dc2626', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>請求書対応</span>
                        <label className="form-label">
                          <span style={{ color: billingDate ? '#374151' : '#ef4444', fontSize: 11 }}>請求日</span>
                          <input type="date" className="form-input" value={billingDate} onChange={e => setBillingDate(e.target.value)} />
                        </label>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: '#f8fafc', borderRadius: 8, padding: '10px 14px', borderLeft: '3px solid #10b981' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>入金</span>
                        <label className="form-label" style={{ marginBottom: 6 }}>
                          <span style={{ color: '#64748b', fontSize: 11 }}>入金予定日</span>
                          <input type="date" className="form-input" value={paymentDueDate} onChange={e => setPaymentDueDate(e.target.value)} />
                        </label>
                        <label className="form-label">
                          <span style={{ color: '#64748b', fontSize: 11 }}>入金日</span>
                          <input type="date" className="form-input" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} />
                        </label>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* ── 請求書の場合 ── */
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>スケジュール</div>
                  {billingCount > 1 && (
                    <span style={{ fontSize: 11, color: '#0ea5e9', fontWeight: 600 }}>
                      年{billingCount}回（{fmtYen(contract.billing_amount_inc ?? 0)}/回）
                    </span>
                  )}
                </div>
                {billingCount <= 1 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
                    {/* 請求グループ */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: '#f8fafc', borderRadius: 8, padding: '10px 14px', borderLeft: '3px solid #0ea5e9' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#0ea5e9', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>請求</span>
                      <label className="form-label" style={{ marginBottom: 6 }}>
                        <span style={{ color: '#64748b', fontSize: 11 }}>請求予定日</span>
                        <input type="date" className="form-input" value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} />
                      </label>
                      <label className="form-label">
                        <span style={{ color: billingDate ? '#374151' : '#ef4444', fontSize: 11 }}>請求日</span>
                        <input type="date" className="form-input" value={billingDate} onChange={e => setBillingDate(e.target.value)} />
                      </label>
                    </div>
                    {/* 入金グループ */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, background: '#f8fafc', borderRadius: 8, padding: '10px 14px', borderLeft: '3px solid #10b981' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#10b981', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>入金</span>
                      <label className="form-label" style={{ marginBottom: 6 }}>
                        <span style={{ color: '#64748b', fontSize: 11 }}>入金予定日</span>
                        <input type="date" className="form-input" value={paymentDueDate} onChange={e => setPaymentDueDate(e.target.value)} />
                      </label>
                      <label className="form-label">
                        <span style={{ color: '#64748b', fontSize: 11 }}>入金日</span>
                        <input type="date" className="form-input" value={receivedDate} onChange={e => setReceivedDate(e.target.value)} />
                      </label>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {payments.map((p, i) => (
                      <div key={i} style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px', borderLeft: `3px solid ${p.received_date ? '#10b981' : p.billing_date ? '#f59e0b' : '#0ea5e9'}` }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>第{p.seq}回</span>
                          <span style={{ fontSize: 10, fontWeight: 600, borderRadius: 4, padding: '1px 6px',
                            background: p.received_date ? '#dcfce7' : p.billing_date ? '#fef3c7' : '#f0f9ff',
                            color: p.received_date ? '#059669' : p.billing_date ? '#d97706' : '#0369a1',
                          }}>
                            {p.received_date ? '入金済' : p.billing_date ? '請求済' : p.scheduled_date ? '請求予定' : '未設定'}
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                          <label className="form-label">
                            <span style={{ color: '#64748b', fontSize: 10 }}>請求予定日</span>
                            <input type="date" className="form-input" style={{ padding: '4px 6px', fontSize: 11 }}
                              value={p.scheduled_date ?? ''}
                              onChange={e => setPayments(prev => prev.map((pp, j) => j === i ? { ...pp, scheduled_date: e.target.value || null } : pp))}
                            />
                          </label>
                          <label className="form-label">
                            <span style={{ color: '#64748b', fontSize: 10 }}>請求日</span>
                            <input type="date" className="form-input" style={{ padding: '4px 6px', fontSize: 11 }}
                              value={p.billing_date ?? ''}
                              onChange={e => setPayments(prev => prev.map((pp, j) => j === i ? { ...pp, billing_date: e.target.value || null } : pp))}
                            />
                          </label>
                          <label className="form-label">
                            <span style={{ color: '#64748b', fontSize: 10 }}>入金日</span>
                            <input type="date" className="form-input" style={{ padding: '4px 6px', fontSize: 11 }}
                              value={p.received_date ?? ''}
                              onChange={e => setPayments(prev => prev.map((pp, j) => j === i ? { ...pp, received_date: e.target.value || null } : pp))}
                            />
                          </label>
                        </div>
                      </div>
                    ))}
                    <div style={{ fontSize: 10, color: '#64748b' }}>
                      {payments.filter(p => p.received_date).length}/{billingCount}回 入金済
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 請求明細 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>請求明細</span>
                <button
                  className="btn btn-sub btn-sm"
                  onClick={() => setLineItems(prev => [...prev, { name: '', amount: '' }])}
                >
                  ＋ 項目を追加
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {lineItems.map((item, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8, alignItems: 'center' }}>
                    <input
                      className="form-input"
                      placeholder="項目名"
                      value={item.name}
                      onChange={e => updateItem(i, 'name', e.target.value)}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>¥</span>
                      <input
                        className="form-input"
                        type="number"
                        placeholder="0"
                        value={item.amount}
                        onChange={e => updateItem(i, 'amount', e.target.value)}
                        style={{ width: 130, textAlign: 'right' }}
                      />
                    </div>
                    <button
                      style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, padding: '4px 6px', lineHeight: 1 }}
                      onClick={() => setLineItems(prev => prev.filter((_, idx) => idx !== i))}
                    >✕</button>
                  </div>
                ))}
                {lineItems.length === 0 && (
                  <p style={{ fontSize: 13, color: '#94a3b8' }}>「＋ 項目を追加」から明細を追加してください</p>
                )}
              </div>
            </div>

            {/* Action button */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-main"
                style={{ flex: 1, padding: '13px', fontSize: 14, background: 'linear-gradient(135deg, #38bdf8 0%, #0ea5e9 100%)' }}
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? '保存中...' : currentRecord ? '保存' : `${currentYear}年度の記録を作成して保存`}
              </button>
              {currentRecord && (
                <button
                  className="btn"
                  style={{ padding: '13px 16px', fontSize: 13, background: '#fee2e2', color: '#dc2626', fontWeight: 700, borderRadius: 8 }}
                  onClick={() => handleDeleteRecord(currentRecord.id, currentYear)}
                >
                  削除
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Right sidebar ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* 保守情報 */}
          <div className="card" style={{ padding: '20px 22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', letterSpacing: '.01em' }}>保守情報・金額（税込）</span>
              {!editingContract ? (
                <button
                  style={{ fontSize: 10.5, padding: '2px 8px', background: '#f1f5f9', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#475569', fontWeight: 600 }}
                  onClick={() => setEditingContract(true)}
                >編集</button>
              ) : (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    style={{ fontSize: 10.5, padding: '2px 8px', background: '#0ea5e9', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#fff', fontWeight: 700 }}
                    onClick={saveContractEdit}
                    disabled={saving}
                  >保存</button>
                  <button
                    style={{ fontSize: 10.5, padding: '2px 8px', background: '#e2e8f0', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#64748b' }}
                    onClick={() => setEditingContract(false)}
                  >取消</button>
                </div>
              )}
            </div>

            {!editingContract ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: -4 }}>
                {/* ── 請求情報 ── */}
                <SectionLabel>請求</SectionLabel>
                {([
                  { label: '保守契約者', value: contract.contractor_name ?? contract.subcontractor },
                  { label: '請求方法', value: contract.billing_method },
                  { label: '請求基準日', value: contract.billing_due_day },
                  { label: '請求金額（税込）', value: contract.billing_amount_inc != null ? fmtYen(contract.billing_amount_inc) : null },
                  { label: '年間保守料', value: contract.annual_maintenance_inc != null ? fmtYen(contract.annual_maintenance_inc) : null },
                  { label: '年間請求回数', value: billingCount > 1 ? `${billingCount}回` : null },
                  { label: '土地代（非課税）', value: contract.land_cost_monthly != null ? fmtYen(contract.land_cost_monthly) : null },
                  { label: '保険料', value: contract.insurance_fee != null ? fmtYen(contract.insurance_fee) : null },
                  { label: 'その他', value: contract.other_fee != null ? fmtYen(contract.other_fee) : null },
                ] as { label: string; value: string | null }[]).filter(r => r.value != null).map(r => (
                  <InfoRow key={r.label} label={r.label} value={r.value!} />
                ))}
                {/* ── 契約情報 ── */}
                <SectionLabel>契約</SectionLabel>
                {([
                  { label: '保守契約日', value: contract.maintenance_contract_date },
                  { label: '保守開始日', value: contract.maintenance_start_date },
                ] as { label: string; value: string | null }[]).filter(r => r.value != null).map(r => (
                  <InfoRow key={r.label} label={r.label} value={r.value!} />
                ))}
                {/* ── 保守プラン ── */}
                {(contract.plan_inspection || contract.plan_weeding || contract.plan_emergency) && (
                  <>
                    <SectionLabel>保守プラン</SectionLabel>
                    {([
                      { label: '点検', value: contract.plan_inspection },
                      { label: '除草', value: contract.plan_weeding },
                      { label: '駆けつけ', value: contract.plan_emergency },
                    ] as { label: string; value: string | null }[]).filter(r => r.value != null).map(r => (
                      <InfoRow key={r.label} label={r.label} value={r.value!} />
                    ))}
                  </>
                )}
                {/* ── 委託情報 ── */}
                {(contract.subcontractor || contract.subcontract_fee_inc || contract.subcontract_billing_day) && (
                  <>
                    <SectionLabel>委託</SectionLabel>
                    {([
                      { label: '委託先', value: contract.subcontractor },
                      { label: '委託費（税込）', value: contract.subcontract_fee_inc != null ? fmtYen(contract.subcontract_fee_inc) : null },
                      { label: '委託請求日', value: contract.subcontract_billing_day },
                    ] as { label: string; value: string | null }[]).filter(r => r.value != null).map(r => (
                      <InfoRow key={r.label} label={r.label} value={r.value!} />
                    ))}
                  </>
                )}
                {contract.notes && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#64748b', lineHeight: 1.65, background: '#f8fafc', borderRadius: 6, padding: '8px 10px' }}>
                    {contract.notes}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', margin: '0 0 2px' }}>請求</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <ContractField key="contractor_name" label="保守契約者" type="text" value={contractEdit.contractor_name} onChange={v => setContractEdit(prev => ({ ...prev, contractor_name: v }))} />
                  <label style={{ fontSize: 11, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    請求方法
                    <select
                      className="form-select"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                      value={contractEdit.billing_method}
                      onChange={e => setContractEdit(prev => ({ ...prev, billing_method: e.target.value }))}
                    >
                      <option value="">-</option>
                      <option value="請求書">請求書</option>
                      <option value="口座振替">口座振替</option>
                    </select>
                  </label>
                  <label style={{ fontSize: 11, color: '#475569' }}>
                    請求基準日
                    <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                      <select className="form-select" style={{ fontSize: 12, padding: '4px 6px' }} value={contractEdit.billing_due_day.match(/(\d{1,2})月/)?.[1] ?? ''} onChange={e => {
                        const day = contractEdit.billing_due_day.match(/(\d{1,2})日/)?.[1] ?? '1'
                        setContractEdit(prev => ({ ...prev, billing_due_day: e.target.value ? `${e.target.value}月${day}日` : '' }))
                      }}>
                        <option value="">月</option>
                        {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}月</option>)}
                      </select>
                      <select className="form-select" style={{ fontSize: 12, padding: '4px 6px' }} value={contractEdit.billing_due_day.match(/(\d{1,2})日/)?.[1] ?? ''} onChange={e => {
                        const month = contractEdit.billing_due_day.match(/(\d{1,2})月/)?.[1] ?? '1'
                        setContractEdit(prev => ({ ...prev, billing_due_day: e.target.value ? `${month}月${e.target.value}日` : '' }))
                      }}>
                        <option value="">日</option>
                        {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}日</option>)}
                      </select>
                    </div>
                  </label>
                  <ContractField label="年間保守料（税抜）" type="number" value={contractEdit.annual_maintenance_ex ?? ''} onChange={v => {
                    const incVal = v ? String(Math.round(Number(v) * 1.1)) : ''
                    setContractEdit(prev => {
                      const count = Number(prev.billing_count) || 1
                      const billingInc = incVal ? String(Math.round(Number(incVal) / count)) : ''
                      const billingEx = billingInc ? String(Math.round(Number(billingInc) / 1.1)) : ''
                      return { ...prev, annual_maintenance_ex: v, annual_maintenance_inc: incVal, billing_amount_inc: billingInc, billing_amount_ex: billingEx }
                    })
                  }} />
                  <ContractField label="年間保守料（税込）" type="number" value={contractEdit.annual_maintenance_inc} onChange={v => {
                    const exVal = v ? String(Math.round(Number(v) / 1.1)) : ''
                    setContractEdit(prev => {
                      const count = Number(prev.billing_count) || 1
                      const billingInc = v ? String(Math.round(Number(v) / count)) : ''
                      const billingEx = billingInc ? String(Math.round(Number(billingInc) / 1.1)) : ''
                      return { ...prev, annual_maintenance_inc: v, annual_maintenance_ex: exVal, billing_amount_inc: billingInc, billing_amount_ex: billingEx }
                    })
                  }} />
                  <ContractField label="請求回数（年間）" type="number" value={contractEdit.billing_count} onChange={v => {
                    setContractEdit(prev => {
                      const count = Number(v) || 1
                      const annualInc = Number(prev.annual_maintenance_inc) || 0
                      const billingInc = annualInc ? String(Math.round(annualInc / count)) : ''
                      const billingEx = billingInc ? String(Math.round(Number(billingInc) / 1.1)) : ''
                      return { ...prev, billing_count: v, billing_amount_inc: billingInc, billing_amount_ex: billingEx }
                    })
                  }} />
                  <ContractField label="請求金額（税込/回）※自動計算" type="number" value={contractEdit.billing_amount_inc} onChange={v => {
                    setContractEdit(prev => ({ ...prev, billing_amount_inc: v, billing_amount_ex: v ? String(Math.round(Number(v) / 1.1)) : '' }))
                  }} />
                  <ContractField label="請求金額（税抜/回）※自動計算" type="number" value={contractEdit.billing_amount_ex ?? ''} onChange={v => {
                    setContractEdit(prev => ({ ...prev, billing_amount_ex: v, billing_amount_inc: v ? String(Math.round(Number(v) * 1.1)) : '' }))
                  }} />
                  {([
                    { key: 'land_cost_monthly', label: '土地代（非課税）', type: 'number' },
                    { key: 'insurance_fee', label: '保険料', type: 'number' },
                    { key: 'other_fee', label: 'その他', type: 'number' },
                  ] as { key: keyof typeof contractEdit; label: string; type: string }[]).map(f => (
                    <ContractField key={f.key} label={f.label} type={f.type} value={contractEdit[f.key]} onChange={v => setContractEdit(prev => ({ ...prev, [f.key]: v }))} />
                  ))}
                </div>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', margin: '4px 0 2px' }}>契約</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {([
                    { key: 'maintenance_contract_date', label: '保守契約日', type: 'date' },
                    { key: 'maintenance_start_date', label: '保守開始日', type: 'date' },
                  ] as { key: keyof typeof contractEdit; label: string; type: string }[]).map(f => (
                    <ContractField key={f.key} label={f.label} type={f.type} value={contractEdit[f.key]} onChange={v => setContractEdit(prev => ({ ...prev, [f.key]: v }))} />
                  ))}
                </div>
                <p style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', margin: '4px 0 2px' }}>委託</p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <ContractField label="委託先" type="text" value={contractEdit.subcontractor} onChange={v => setContractEdit(prev => ({ ...prev, subcontractor: v }))} />
                  <ContractField label="委託費（税抜）" type="number" value={contractEdit.subcontract_fee_ex} onChange={v => {
                    setContractEdit(prev => ({ ...prev, subcontract_fee_ex: v, subcontract_fee_inc: v ? String(Math.round(Number(v) * 1.1)) : '' }))
                  }} />
                  <ContractField label="委託費（税込）" type="number" value={contractEdit.subcontract_fee_inc} onChange={v => {
                    setContractEdit(prev => ({ ...prev, subcontract_fee_inc: v, subcontract_fee_ex: v ? String(Math.round(Number(v) / 1.1)) : '' }))
                  }} />
                  <ContractField label="委託請求日（例: 7月25日）" type="text" value={contractEdit.subcontract_billing_day} onChange={v => setContractEdit(prev => ({ ...prev, subcontract_billing_day: v }))} />
                </div>
                <label style={{ fontSize: 11, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
                  備考
                  <textarea
                    className="form-input"
                    style={{ padding: '4px 8px', fontSize: 12, resize: 'vertical', minHeight: 60 }}
                    value={contractEdit.notes}
                    onChange={e => setContractEdit(prev => ({ ...prev, notes: e.target.value }))}
                  />
                </label>
              </div>
            )}
          </div>

          {/* 保守記録（請求前後） */}
          <MaintenanceAroundBilling
            billingDate={billingDate || scheduledDate}
            maintenanceResponses={maintenanceResponses}
            periodicMaintenance={periodicMaintenance}
          />

          {/* 過去の請求・入金履歴 */}
          <div className="card" style={{ padding: '20px 22px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 14, letterSpacing: '.01em' }}>過去の請求・入金履歴</div>
            {historyRecords.length === 0 ? (
              <p style={{ fontSize: 12.5, color: '#94a3b8' }}>履歴はありません</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                {historyRecords.map(r => {
                  const amount = r.line_items?.reduce((s, i) => s + i.amount, 0) ?? null
                  const isEditing = editingHistoryId === r.id
                  return (
                    <div key={r.id} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 10, marginBottom: 10 }}>
                      {/* 年度ヘッダー */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', background: '#f1f5f9', borderRadius: 4, padding: '2px 8px' }}>{r.year}年度</span>
                        {!isEditing ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              style={{ fontSize: 10.5, padding: '2px 8px', background: '#f1f5f9', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#475569', fontWeight: 600 }}
                              onClick={() => startHistoryEdit(r)}
                            >編集</button>
                            <button
                              style={{ fontSize: 10.5, padding: '2px 8px', background: '#fee2e2', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#dc2626', fontWeight: 600 }}
                              onClick={() => handleDeleteRecord(r.id, r.year)}
                            >削除</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              style={{ fontSize: 10.5, padding: '2px 8px', background: '#0ea5e9', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#fff', fontWeight: 700 }}
                              onClick={() => saveHistoryEdit(r.id)}
                              disabled={saving}
                            >保存</button>
                            <button
                              style={{ fontSize: 10.5, padding: '2px 8px', background: '#e2e8f0', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#64748b' }}
                              onClick={() => setEditingHistoryId(null)}
                            >取消</button>
                          </div>
                        )}
                      </div>
                      {/* データ行 */}
                      {!isEditing ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 8px', fontSize: 12.5 }}>
                          <div style={{ color: '#64748b', fontSize: 11 }}>請求日</div>
                          <div style={{ color: '#64748b', fontSize: 11 }}>入金日</div>
                          <div style={{ color: '#64748b', fontSize: 11, textAlign: 'right' }}>金額</div>
                          <div style={{ fontWeight: 500 }}>{fmtDate(r.billing_date)}</div>
                          <div style={{ fontWeight: 700, color: r.received_date ? '#059669' : '#ef4444' }}>
                            {r.received_date ? fmtDate(r.received_date) : '—'}
                          </div>
                          <div style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700, textAlign: 'right', color: '#0f172a' }}>
                            {fmtYen(amount)}
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <label style={{ fontSize: 11, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 3 }}>
                            請求日
                            <input
                              type="date" className="form-input"
                              style={{ padding: '4px 8px', fontSize: 12 }}
                              value={historyEdit.billing_date}
                              onChange={e => setHistoryEdit(prev => ({ ...prev, billing_date: e.target.value }))}
                            />
                          </label>
                          <label style={{ fontSize: 11, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 3 }}>
                            入金日
                            <input
                              type="date" className="form-input"
                              style={{ padding: '4px 8px', fontSize: 12 }}
                              value={historyEdit.received_date}
                              onChange={e => setHistoryEdit(prev => ({ ...prev, received_date: e.target.value }))}
                            />
                          </label>
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            請求明細
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                              {historyEdit.line_items.map((item, i) => (
                                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 4, alignItems: 'center' }}>
                                  <input
                                    className="form-input"
                                    placeholder="項目名"
                                    style={{ padding: '3px 6px', fontSize: 11 }}
                                    value={item.name}
                                    onChange={e => updateHistoryItem(i, 'name', e.target.value)}
                                  />
                                  <input
                                    className="form-input"
                                    type="number"
                                    placeholder="0"
                                    style={{ padding: '3px 6px', fontSize: 11, width: 90, textAlign: 'right' }}
                                    value={item.amount}
                                    onChange={e => updateHistoryItem(i, 'amount', e.target.value)}
                                  />
                                  <button
                                    style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 13, padding: '2px 4px', lineHeight: 1 }}
                                    onClick={() => setHistoryEdit(prev => ({ ...prev, line_items: prev.line_items.filter((_, idx) => idx !== i) }))}
                                  >✕</button>
                                </div>
                              ))}
                              <button
                                style={{ fontSize: 10.5, padding: '2px 6px', background: '#f1f5f9', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#475569', alignSelf: 'flex-start', marginTop: 2 }}
                                onClick={() => setHistoryEdit(prev => ({ ...prev, line_items: [...prev.line_items, { name: '', amount: '' }] }))}
                              >＋ 追加</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', margin: '12px 0 6px', textTransform: 'uppercase', letterSpacing: '.07em', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ flex: 1, height: 1, background: '#e2e8f0', display: 'inline-block' }} />
      {children}
      <span style={{ flex: 1, height: 1, background: '#e2e8f0', display: 'inline-block' }} />
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '5px 0', borderBottom: '1px solid #f8fafc' }}>
      <span style={{ color: '#64748b', flexShrink: 0 }}>{label}</span>
      <span style={{ fontWeight: 600, color: '#1e293b', textAlign: 'right' }}>{value}</span>
    </div>
  )
}

function MaintenanceAroundBilling({
  billingDate,
  maintenanceResponses,
  periodicMaintenance,
}: {
  billingDate: string
  maintenanceResponses: MaintenanceResponse[]
  periodicMaintenance: PeriodicMaintenance[]
}) {
  // 請求日（or予定日）の前後2ヶ月の記録を表示
  const refDate = billingDate || new Date().toISOString().slice(0, 10)
  const ref = new Date(refDate + 'T00:00:00')
  const from = new Date(ref)
  from.setMonth(from.getMonth() - 2)
  const to = new Date(ref)
  to.setMonth(to.getMonth() + 2)
  const inRange = (d: string | null) => {
    if (!d) return false
    const dt = new Date(d + 'T00:00:00')
    return dt >= from && dt <= to
  }

  const filteredResponses = maintenanceResponses
    .filter(m => inRange(m.inquiry_date) || inRange(m.occurrence_date))
    .sort((a, b) => (a.inquiry_date ?? '').localeCompare(b.inquiry_date ?? ''))

  const filteredPeriodic = periodicMaintenance
    .filter(m => inRange(m.record_date))
    .sort((a, b) => a.record_date.localeCompare(b.record_date))

  const hasAny = filteredResponses.length > 0 || filteredPeriodic.length > 0
  const fromStr = `${from.getFullYear()}/${from.getMonth() + 1}`
  const toStr = `${to.getFullYear()}/${to.getMonth() + 1}`

  return (
    <div className="card" style={{ padding: '20px 22px' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>
        保守記録（請求前後）
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>
        {fromStr} 〜 {toStr}
      </div>

      {!hasAny ? (
        <p style={{ fontSize: 13, color: '#94a3b8' }}>該当期間の保守記録はありません</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 保守対応 */}
          {filteredResponses.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginBottom: 8 }}>
                保守対応（{filteredResponses.length}件）
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 600, padding: '6px 8px', borderBottom: '1px solid #e2e8f0' }}>日付</th>
                    <th style={{ textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 600, padding: '6px 8px', borderBottom: '1px solid #e2e8f0' }}>対象箇所</th>
                    <th style={{ textAlign: 'center', fontSize: 12, color: '#64748b', fontWeight: 600, padding: '6px 8px', borderBottom: '1px solid #e2e8f0' }}>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResponses.map(m => (
                    <tr key={m.id}>
                      <td style={{ fontSize: 13, padding: '7px 8px', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{m.inquiry_date ?? '—'}</td>
                      <td style={{ fontSize: 13, padding: '7px 8px', borderBottom: '1px solid #f1f5f9', color: '#334155', fontWeight: 500 }}>{m.target_area ?? '—'}</td>
                      <td style={{ textAlign: 'center', padding: '7px 8px', borderBottom: '1px solid #f1f5f9' }}>
                        <span style={{
                          fontSize: 11, fontWeight: 600, borderRadius: 4, padding: '2px 8px',
                          background: m.status === '完了' ? '#ecfdf5' : '#fef2f2',
                          color: m.status === '完了' ? '#059669' : '#dc2626',
                        }}>{m.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 定期保守 */}
          {filteredPeriodic.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#0ea5e9', marginBottom: 8 }}>
                定期保守（{filteredPeriodic.length}件）
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 600, padding: '6px 8px', borderBottom: '1px solid #e2e8f0' }}>日付</th>
                    <th style={{ textAlign: 'left', fontSize: 12, color: '#64748b', fontWeight: 600, padding: '6px 8px', borderBottom: '1px solid #e2e8f0' }}>作業種別</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPeriodic.map(m => (
                    <tr key={m.id}>
                      <td style={{ fontSize: 13, padding: '7px 8px', borderBottom: '1px solid #f1f5f9', color: '#334155' }}>{m.record_date}</td>
                      <td style={{ fontSize: 13, padding: '7px 8px', borderBottom: '1px solid #f1f5f9' }}>
                        <span style={{
                          fontSize: 12, fontWeight: 600, borderRadius: 4, padding: '2px 8px',
                          background: m.work_type === '点検' ? '#f0f9ff' : m.work_type === '除草' ? '#ecfdf5' : '#f8fafc',
                          color: m.work_type === '点検' ? '#0369a1' : m.work_type === '除草' ? '#059669' : '#475569',
                        }}>{m.work_type ?? '—'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ContractField({ label, type, value, onChange }: { label: string; type: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ fontSize: 11, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 3 }}>
      {label}
      <input
        className="form-input"
        type={type}
        style={{ padding: '4px 8px', fontSize: 12 }}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  )
}

