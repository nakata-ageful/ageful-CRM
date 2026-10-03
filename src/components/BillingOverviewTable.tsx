import type { BillingHistoryData } from './BillingHistorySection'
import { billingUnitStatusLabel, isEditableInvoicePlan, resolveUnitAmount, type BillingUnit } from '../lib/billing-unit'
import type { ScheduleSetupItem } from '../lib/billing-cutover-coverage'
import { fmtYen } from '../lib/utils'

export type OverviewMode = 'upcoming' | 'unpaid' | 'received' | 'review'
export type OverviewEditor = { unitId: string; mode: 'invoice' | 'plan' | 'debit' }

/** Presentation only: one occurrence per row; saved and reference amounts remain distinct. */
export function BillingOverviewTable({ data, units = [], candidates = [], mode, today, onViewDetail, onEdit }: {
  data: BillingHistoryData; units?: readonly BillingUnit[]; candidates?: readonly ScheduleSetupItem[]
  mode: OverviewMode; today: string; onViewDetail?: (id: number) => void; onEdit?: (editor: OverviewEditor) => void
}) {
  const rows = [
    ...units.map(unit => ({ key: `unit:${unit.id}`, unit, candidate: undefined, projectId: unit.projectId,
      date: (mode === 'received' ? unit.receivedOn : mode === 'unpaid' ? unit.issuedOn : unit.scheduledDate) ?? '' })),
    ...candidates.map(candidate => ({ key: `candidate:${candidate.projectId}:${candidate.date}:${candidate.round}:${candidate.method}`,
      unit: undefined, candidate, projectId: candidate.projectId, date: candidate.date })),
  ].sort((a, b) => {
    const dateOrder = (a.date || '9999').localeCompare(b.date || '9999')
    return (mode === 'received' ? -dateOrder : dateOrder) || a.projectId - b.projectId || a.key.localeCompare(b.key)
  })
  if (!rows.length) return <p className="billing-overview-empty">{mode === 'upcoming' ? 'この期間の請求書予定はありません。' : mode === 'unpaid' ? '未入金の請求はありません。' : mode === 'received' ? '入金済の記録はありません。' : '対象の記録はありません。'}</p>
  const dateTitle = mode === 'received' ? '請求・振替日' : mode === 'unpaid' ? '請求日' : '予定日'
  return <div className="billing-overview-scroll"><table className="billing-overview-table">
    <thead><tr><th>発電所</th><th>請求先</th><th className="billing-overview-round">回数</th><th className="billing-overview-date">{dateTitle}</th>
      <th className="billing-overview-date">{mode === 'received' ? '入金日' : mode === 'unpaid' ? '入金予定日' : '状態'}</th>
      <th className="billing-overview-money">金額（税込）</th><th className="billing-overview-operation">操作</th></tr></thead>
    <tbody>{rows.map(({ key, unit, candidate, projectId }) => {
      const name = candidate?.projectName ?? data.projectName(projectId)
      const amount = unit ? resolveUnitAmount(unit) : { amount: candidate!.amount, basis: '参考額' }
      const status = candidate ? candidate.status === 'review' ? '保存内容を確認' : candidate.status === 'overdue' ? '期限超過・要確認'
        : candidate.date < today ? '予定日経過・要確認' : '未保存・要確認' : billingUnitStatusLabel(unit!)
      const period = unit?.periodStart && unit.periodEnd ? `${unit.periodStart} ～ ${unit.periodEnd}` : unit ? `${unit.serviceYear}年（保守期間未確認）` : candidate?.periodStart&&candidate.periodEnd?`${candidate.periodStart} ～ ${candidate.periodEnd}（参考）`:'対象の保守期間は登録前に確認してください'
      const canIssue = unit && isEditableInvoicePlan(unit) && unit.recipientId != null
      const canCollect = unit?.method === '請求書' && unit.lifecycle === 'issued' && !unit.receivedOn
      const canDebit = unit?.method === '口座振替' && unit.lifecycle === 'planned' && !unit.receivedOn && unit.frozenAmount === null && unit.recipientId != null
      return <tr key={key} data-unit-id={unit?.id} data-candidate-key={candidate ? key : undefined}>
        <td>{onViewDetail ? <button type="button" className="link-btn" onClick={() => onViewDetail(projectId)}>{name}</button> : name}
          {unit?.method === '口座振替' && <small>口座振替</small>}</td>
        <td>{candidate ? <>{candidate.customerName}<small className="billing-overview-warning">現在の顧客・請求先未確定</small></>
          : unit!.recipientId == null ? <span className="billing-overview-warning">請求先要確認</span> : data.recipientName(unit!.recipientId)}</td>
        <td title={`保守期間：${period}`}>{candidate ? `第${candidate.round}回` : unit!.roundLabel === '保存済み単回記録' ? '回数未確認' : unit!.roundLabel}
          {unit && <small>{unit.serviceYear}年</small>}{candidate?.serviceYear&&<small>{candidate.serviceYear}年分（参考）</small>}</td>
        <td className="billing-overview-date-value">{mode === 'unpaid' || mode === 'received' ? unit?.issuedOn ?? '—' : unit?.scheduledDate ?? candidate?.date ?? '日付要確認'}</td>
        <td className={mode === 'unpaid' || mode === 'received' ? 'billing-overview-date-value' : undefined}>{mode === 'unpaid' ? unit?.paymentDueOn ?? '—' : mode === 'received' ? unit?.receivedOn ?? '—'
          : <span className={candidate ? 'billing-overview-warning' : ''} title={candidate?.reason}>{status}</span>}</td>
        <td className="billing-overview-money"><strong>{amount.amount == null ? '金額要確認' : fmtYen(amount.amount)}</strong>
          {amount.amount != null && amount.basis !== '確定額' && <small className={candidate ? 'billing-overview-warning' : ''}>{amount.basis}</small>}</td>
        <td><div className="billing-overview-actions">
          {onEdit && unit && (canIssue || canCollect) && <button type="button" className="btn btn-main btn-sm" onClick={() => onEdit({ unitId: unit.id, mode: 'invoice' })}>{canCollect ? '入金日を記録' : '発行'}</button>}
          {onEdit && canDebit && <button type="button" className="btn btn-main btn-sm" onClick={() => onEdit({ unitId: unit.id, mode: 'debit' })}>振替結果を記録</button>}
          {onEdit && unit && !canIssue && isEditableInvoicePlan(unit) && data.recipients && <button type="button" className="btn btn-sm" onClick={() => onEdit({ unitId: unit.id, mode: 'plan' })}>請求先を設定</button>}
          {onViewDetail && !(onEdit && unit && (canIssue || canCollect || canDebit || (isEditableInvoicePlan(unit) && data.recipients))) && <button type="button" className="btn btn-sub btn-sm" aria-label={`${name}の請求詳細を開く`} onClick={() => onViewDetail(projectId)}>{candidate ? '予定を確認' : '詳細'}</button>}
        </div></td>
      </tr>
    })}</tbody>
  </table></div>
}
