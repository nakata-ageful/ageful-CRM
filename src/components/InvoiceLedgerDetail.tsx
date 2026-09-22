import { useState } from 'react'
import { InvoiceUnitEditor } from './InvoiceUnitEditor'
import { isEditableInvoicePlan, billingUnitStatusLabel, resolveUnitAmount, type BillingUnit } from '../lib/billing-unit'
import type { InvoiceWriteRequest } from '../lib/invoice-write-session'
import { InvoicePlanEditor } from './InvoicePlanEditor'
import { ManualDebitEditor } from './ManualDebitEditor'
import { InvoiceCorrectionEditor } from './InvoiceCorrectionEditor'
import type { BillingHistoryData } from './BillingHistorySection'
import { fmtYen } from '../lib/utils'

type EditorMode = 'invoice' | 'plan' | 'debit' | 'correction'

function unitDate(unit: BillingUnit): string {
  return unit.scheduledDate ?? unit.issuedOn ?? unit.receivedOn ?? `${unit.serviceYear}-12-31`
}

function initialUnit(units: readonly BillingUnit[]): BillingUnit | undefined {
  const priority = (unit: BillingUnit) => {
    if (unit.method === '請求書' && unit.lifecycle === 'issued' && !unit.receivedOn) return 0
    if (unit.lifecycle === 'fixed') return 1
    if (unit.lifecycle === 'planned') return 2
    if (unit.lifecycle === 'review_required') return 3
    return 9
  }
  return [...units].sort((a, b) => {
    const rank = priority(a) - priority(b)
    if (rank) return rank
    if (priority(a) < 9) return unitDate(a).localeCompare(unitDate(b))
    return unitDate(b).localeCompare(unitDate(a))
  })[0]
}

function periodLabel(unit: BillingUnit): string {
  return unit.periodStart && unit.periodEnd
    ? `${unit.periodStart} ～ ${unit.periodEnd}`
    : `${unit.serviceYear}年（保守期間未確認）`
}

export function InvoiceLedgerDetail({ data, projectId, onSave }: {
  data: BillingHistoryData
  projectId: number
  onSave?: (request: InvoiceWriteRequest) => Promise<unknown>
}) {
  const units = data.units.filter(unit => unit.projectId === projectId)
  const first = initialUnit(units)
  const [focusedId, setFocusedId] = useState<string | null>(first?.id ?? null)
  const [editor, setEditor] = useState<{ unitId: string; mode: EditorMode } | null>(null)
  const focused = units.find(unit => unit.id === focusedId) ?? initialUnit(units)
  const editingUnit = units.find(unit => unit.id === editor?.unitId)
  const history = [...units].sort((a, b) => unitDate(b).localeCompare(unitDate(a)) || b.id.localeCompare(a.id))

  const openEditor = (unit: BillingUnit, mode: EditorMode) => {
    setFocusedId(unit.id)
    setEditor({ unitId: unit.id, mode })
  }
  const closeEditor = () => setEditor(null)

  return <section className="invoice-detail-classic">
    {!focused ? <div className="card invoice-detail-empty"><h3>請求詳細</h3><p>この発電所の請求記録はまだありません。</p></div> : (() => {
      const amount = resolveUnitAmount(focused, () => data.plannedAmount(focused))
      const status = billingUnitStatusLabel(focused)
      const recipient = focused.recipientId == null ? '請求先要確認' : data.recipientName(focused.recipientId)
      const canEditPlan = !!onSave && !!data.recipients && isEditableInvoicePlan(focused)
      const canIssue = !!onSave && isEditableInvoicePlan(focused) && focused.recipientId != null
      const canCollect = !!onSave && focused.method === '請求書' && focused.lifecycle === 'issued' && !focused.receivedOn
      const canCorrectInvoice = !!onSave && !!data.recipients && focused.method === '請求書' && ['issued', 'received'].includes(focused.lifecycle)
      const canRecordDebit = !!onSave && focused.method === '口座振替' && focused.lifecycle === 'planned' && !focused.receivedOn && focused.frozenAmount === null
      const canCorrectDebit = !!onSave && focused.method === '口座振替' && focused.lifecycle === 'received'

      return <>
        <div className="invoice-detail-columns">
          <div className="invoice-detail-main">
            <div className="card invoice-current-card">
              <div className="invoice-current-heading">
                <div><span>今回・次回の請求</span><h2>{focused.roundLabel}</h2></div>
                <span className={`billing-unit-status billing-unit-status-${focused.lifecycle}`}>{status}</span>
              </div>
              <div className="invoice-current-amount">{amount.amount == null ? '金額要確認' : fmtYen(amount.amount)}</div>
              <div className="invoice-current-basis">{amount.basis} ／ {focused.method}</div>

              <dl className="invoice-current-facts">
                <div><dt>請求先</dt><dd className={focused.recipientId == null ? 'invoice-attention' : ''}>{recipient}</dd></div>
                <div><dt>保守期間</dt><dd>{periodLabel(focused)}</dd></div>
                <div><dt>請求予定日</dt><dd>{focused.scheduledDate ?? '未登録'}</dd></div>
                <div><dt>{focused.method === '口座振替' ? '振替日' : '請求日'}</dt><dd>{focused.issuedOn ?? '未登録'}</dd></div>
                <div><dt>入金予定日</dt><dd>{focused.paymentDueOn ?? '未登録'}</dd></div>
                <div><dt>入金日</dt><dd>{focused.receivedOn ?? '未登録'}</dd></div>
              </dl>

              <div className="invoice-current-lines">
                <h3>請求明細</h3>
                {focused.frozenLineItems?.length ? focused.frozenLineItems.map((item, index) =>
                  <div key={`${item.name}-${index}`}><span>{item.name}</span><strong>{fmtYen(item.amount)}</strong></div>)
                  : <p>{focused.lifecycle === 'planned' ? '明細は請求・振替結果を記録するときに入力します。' : '明細が保存されていません。'}</p>}
              </div>

              {onSave && <div className="invoice-current-actions">
                {canIssue && <button className="btn btn-main" type="button" onClick={() => openEditor(focused, 'invoice')}>請求内容を入力して発行</button>}
                {canCollect && <button className="btn btn-main" type="button" onClick={() => openEditor(focused, 'invoice')}>入金日を記録</button>}
                {canRecordDebit && <button className="btn btn-main" type="button" onClick={() => openEditor(focused, 'debit')}>振替結果を記録</button>}
                {canEditPlan && <button className="btn" type="button" onClick={() => openEditor(focused, 'plan')}>{focused.recipientId == null ? '請求先・予定を設定' : '予定を変更'}</button>}
                {canCorrectInvoice && <button className="btn" type="button" onClick={() => openEditor(focused, 'correction')}>この記録を訂正</button>}
                {canCorrectDebit && <button className="btn" type="button" onClick={() => openEditor(focused, 'debit')}>この記録を訂正</button>}
              </div>}
            </div>
          </div>

          <aside className="card invoice-history-panel">
            <div className="invoice-history-heading"><div><span>この発電所の</span><h3>過去の請求・入金記録</h3></div><b>{units.length}件</b></div>
            <div className="invoice-history-list">
              {history.map(unit => {
                const itemAmount = resolveUnitAmount(unit, () => data.plannedAmount(unit))
                return <button key={unit.id} type="button" className={`invoice-history-item ${unit.id === focused.id ? 'is-selected' : ''}`}
                  onClick={() => { setFocusedId(unit.id); setEditor(null) }}>
                  <span className="invoice-history-period">{periodLabel(unit)}　{unit.roundLabel}</span>
                  <span className="invoice-history-row"><strong>{itemAmount.amount == null ? '金額要確認' : fmtYen(itemAmount.amount)}</strong><em>{billingUnitStatusLabel(unit)}</em></span>
                  <span className="invoice-history-meta">請求先：{unit.recipientId == null ? '要確認' : data.recipientName(unit.recipientId)} ／ {unit.method}</span>
                </button>
              })}
            </div>
            <p className="invoice-history-help">記録を選ぶと、左側に日付・明細・請求先を表示します。</p>
          </aside>
        </div>

        {editingUnit && onSave && <div className="invoice-editor-area">
          {editor?.mode === 'correction' && data.recipients
            ? <InvoiceCorrectionEditor key={`correction-${editingUnit.id}`} unit={editingUnit} recipients={data.recipients} onSave={onSave} onClose={closeEditor} />
            : editor?.mode === 'debit'
              ? <ManualDebitEditor key={`debit-${editingUnit.id}`} unit={editingUnit} recipientName={data.recipientName} onSave={onSave} onClose={closeEditor} />
              : editor?.mode === 'plan' && data.recipients
                ? <InvoicePlanEditor key={`plan-${editingUnit.id}`} unit={editingUnit} recipients={data.recipients} onSave={onSave} onClose={closeEditor} />
                : <InvoiceUnitEditor key={editingUnit.id} unit={editingUnit} recipientName={data.recipientName} onSave={onSave} onClose={closeEditor} />}
        </div>}
      </>
    })()}
  </section>
}
