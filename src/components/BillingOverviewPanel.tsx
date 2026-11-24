import { useState, type ReactNode } from 'react'
import type { BillingHistoryData } from './BillingHistorySection'
import { BillingOverviewTable, type OverviewEditor } from './BillingOverviewTable'
import { buildBillingOverview } from '../lib/billing-overview'
import { fmtYen } from '../lib/utils'
import { buildBillingUnitCsv, downloadBillingUnitCsv } from '../lib/billing-unit-csv'
import type { ScheduleSetupIssue, ScheduleSetupItem } from '../lib/billing-cutover-coverage'
import type { InvoiceWriteRequest } from '../lib/invoice-write-session'
import { InvoiceUnitEditor } from './InvoiceUnitEditor'
import { InvoicePlanEditor } from './InvoicePlanEditor'
import { ManualDebitEditor } from './ManualDebitEditor'
import { Modal } from './Modal'
import {RoutineInvoiceEditor} from './RoutineInvoiceEditor'

import {routineInvoiceKey,type AddRoutineInvoice,type RoutineInvoiceContext} from '../lib/routine-invoice'

function OverviewSection({ title, count, color, collapsed = false, children }: {
  title: string; count: number; color: string; collapsed?: boolean; children: ReactNode
}) {
  const heading = <><span>{title}（{count}件）</span>{collapsed && <span className="billing-overview-disclosure" aria-hidden="true" />}</>
  return collapsed ? <details className={`card billing-overview-section ${color}`}><summary>{heading}</summary>{children}</details>
    : <section className={`card billing-overview-section ${color}`}><h3>{heading}</h3>{children}</section>
}

/** Cross-project work list. Classification, saved payer and amount rules are unchanged. */
export function BillingOverviewPanel({ data, today, onViewDetail, setupItems = [], setupIssues = [], onSave, routineInvoices=[],automaticDebits=[],onAddRoutine }: {
  data: BillingHistoryData; today: string; onViewDetail?: (projectId: number) => void
  setupItems?: readonly ScheduleSetupItem[]; setupIssues?: readonly ScheduleSetupIssue[]
  onSave?: (request: InvoiceWriteRequest) => Promise<unknown>
  routineInvoices?:readonly RoutineInvoiceContext[];automaticDebits?:readonly RoutineInvoiceContext[];onAddRoutine?:AddRoutineInvoice
}) {
  const overview = buildBillingOverview(data.units, today)
  const [editor, setEditor] = useState<OverviewEditor | null>(null)
  const [routine,setRoutine]=useState<RoutineInvoiceContext|null>(null)
  const [recordingDebit,setRecordingDebit]=useState<RoutineInvoiceContext|null>(null)
  const debitMap=new Map(automaticDebits.map(context=>[`${context.contract.project_id}:${context.item.date}`,context]))
  const [routineBusy,setRoutineBusy]=useState(false)
  const routineMap=new Map(routineInvoices.map(c=>[routineInvoiceKey(c.contract.project_id,c.item),c]))
  const editingUnit = data.units.find(unit => !unit.removedAt&&unit.id === editor?.unitId)
  const noBillingCandidates = setupIssues.filter(issue => issue.category === 'no_billing_candidate')
  const actionRequired = setupIssues.filter(issue => issue.category === 'action_required')
  const unpaidDisplay = [...overview.debitSwitchAwaitingIssue, ...overview.unpaid]
  const scheduledInvoices = [...overview.upcoming, ...overview.debitSwitchAwaitingIssue]
  const nearTermCandidates = setupItems.filter(item => item.method === 'invoice' && overview.months.includes(item.date.slice(0, 7))
    && (item.status === 'missing' || item.status === 'overdue')
    && !scheduledInvoices.some(unit => unit.projectId === item.projectId && unit.scheduledDate === item.date))
  const debitChecks = setupItems.filter(item => item.method === 'direct_debit')
  const movedItems = new Set<ScheduleSetupItem>([...nearTermCandidates, ...debitChecks])
  const remainingItems = setupItems.filter(item => !movedItems.has(item))
  const tableProps = { data, today, onViewDetail, onEdit: onSave ? setEditor : undefined,
    canRecordCandidate:(item:ScheduleSetupItem)=>item.method==='direct_debit'
      ?debitMap.has(`${item.projectId}:${item.date}`):!!onAddRoutine&&routineMap.has(routineInvoiceKey(item.projectId,item)),
    onRecordCandidate:onSave&&data.recipients?(item:ScheduleSetupItem)=>{
      if(item.method==='direct_debit')setRecordingDebit(debitMap.get(`${item.projectId}:${item.date}`)??null)
      else setRoutine(routineMap.get(routineInvoiceKey(item.projectId,item))??null)
    }:undefined }
  const closeEditor = () => setEditor(null)
  const issueList = (issues: readonly ScheduleSetupIssue[]) => <ul className="billing-overview-issues">{issues.map(issue => <li key={`${issue.projectId}:${issue.code}`}>
    <span><strong>{issue.projectName}</strong><small>{issue.reason}</small></span>
    {onViewDetail && <button type="button" className="btn btn-sub btn-sm" onClick={() => onViewDetail(issue.projectId)}>詳細で確認</button>}
  </li>)}</ul>
  return <section className="billing-overview">
    <header className="billing-overview-toolbar"><h2>請求</h2><div>
      <span>未入金 <strong>{fmtYen(overview.totals.unpaidAmount)}</strong> ／ 入金済 <strong>{fmtYen(overview.totals.receivedAmount)}</strong><small>昨年以降に始まる保守期間の請求分（前払いを含む）</small></span>
      <button type="button" className="btn btn-sub btn-sm" onClick={() => downloadBillingUnitCsv(buildBillingUnitCsv(data.units, data.recipientName, data.projectName))}>請求CSV</button>
    </div></header>
    {!!overview.totals.unknownActualCount && <p className="billing-overview-notice" role="status">金額要確認：{overview.totals.unknownActualCount}件。金額不明分は合計に含みません。</p>}
    {!!overview.olderUnpaid.length && <OverviewSection title="古い未入金" count={overview.olderUnpaid.length} color="amber">
      <p className="billing-overview-notice" role="status">一昨年以前に始まった保守期間の未入金です。入金を記録するまで警告に残します。確認できている金額：{fmtYen(overview.olderUnpaidTotals.unpaidAmount)}（上の合計には含みません）。
        {!!overview.olderUnpaidTotals.unknownActualCount && ` 金額要確認：${overview.olderUnpaidTotals.unknownActualCount}件。金額不明分は合計に含みません。`}</p>
      <BillingOverviewTable {...tableProps} units={overview.olderUnpaid} mode="unpaid" />
    </OverviewSection>}
    <OverviewSection title="未入金" count={unpaidDisplay.length} color="red"><BillingOverviewTable {...tableProps} units={unpaidDisplay} mode="unpaid" /></OverviewSection>
    <OverviewSection title="今月・来月・再来月の請求予定" count={overview.upcoming.length + nearTermCandidates.length} color="blue">
      <BillingOverviewTable {...tableProps} units={overview.upcoming} candidates={nearTermCandidates} mode="upcoming" />

    </OverviewSection>
    <OverviewSection title="口座振替" count={debitChecks.length + overview.debitPlans.length} color="purple" collapsed>
      <p className="billing-overview-help">銀行の振替結果を確認して記録します。</p>
      {!!debitChecks.length && <><h4 className="billing-overview-subtitle">口座振替の結果を確認（{debitChecks.length}件）</h4><BillingOverviewTable {...tableProps} candidates={debitChecks} mode="review" /></>}
      {!!overview.debitPlans.length && <><h4 className="billing-overview-subtitle">保存済みの振替予定（{overview.debitPlans.length}件）</h4><BillingOverviewTable {...tableProps} units={overview.debitPlans} mode="review" /></>}
      {!debitChecks.length && !overview.debitPlans.length && <p className="billing-overview-empty">確認する振替結果や保存済みの振替予定はありません。</p>}
    </OverviewSection>
    <OverviewSection title="入金済" count={overview.received.length} color="green" collapsed><BillingOverviewTable {...tableProps} units={overview.received} mode="received" /></OverviewSection>
    {([['表示期間より前の予定', overview.overduePlans], ['日付要確認', overview.undatedPlans], ['それ以降の予定', overview.laterPlans], ['記録要確認', overview.review]] as const)
      .filter(([, units]) => units.length).map(([label, units]) => <OverviewSection key={label} title={label} count={units.length} color="amber" collapsed={label==='それ以降の予定'}><BillingOverviewTable {...tableProps} units={units} mode="review" /></OverviewSection>)}
    {!!remainingItems.length && <OverviewSection title="請求内容の確認が必要" count={remainingItems.length} color="amber">
      <p className="billing-overview-help">「予定を確認」から、請求済みか・予定日の変更が必要か確認してください。</p>
      <BillingOverviewTable {...tableProps} candidates={remainingItems} mode="review" />

    </OverviewSection>}
    {!!setupIssues.length && <OverviewSection title="請求設定要確認" count={setupIssues.length} color="amber" collapsed>
      <p className="billing-overview-help">「詳細で確認」から、不足している請求設定を入力してください。</p>
      {!!actionRequired.length && <><h4 className="billing-overview-subtitle">請求設定が必要（{actionRequired.length}件）</h4>{issueList(actionRequired)}</>}
      {!!noBillingCandidates.length && <details className="billing-overview-secondary"><summary>自社で請求するか確認（{noBillingCandidates.length}件・未確定）</summary><p className="billing-overview-help">他社保守などの可能性があります。発電所ごとに確認します。</p>{issueList(noBillingCandidates)}</details>}
    </OverviewSection>}

    {routine&&onAddRoutine&&onSave&&data.recipients&&<Modal title={`${data.projectName(routine.contract.project_id)}：発行内容を記録`} width={720} closeDisabled={routineBusy} onClose={()=>setRoutine(null)}><div className="standard-editor">
      <RoutineInvoiceEditor context={routine} recipients={data.recipients} onAdd={onAddRoutine} onSave={onSave} onBusyChange={setRoutineBusy} onClose={()=>setRoutine(null)}/>
    </div></Modal>}
    {recordingDebit&&onSave&&<Modal title="請求書に切替" width={720} onClose={()=>setRecordingDebit(null)}>
      <div className="standard-editor"><ManualDebitEditor automaticDebit={recordingDebit} recipientName={data.recipientName} onSave={onSave} onClose={()=>setRecordingDebit(null)} /></div>
    </Modal>}
    {editingUnit && onSave && <Modal title={`${data.projectName(editingUnit.projectId)}：${editor?.mode === 'plan' ? '請求先・予定を設定' : editor?.mode === 'debit' ? '請求書に切替' : editingUnit.lifecycle === 'issued' ? '入金日を記録' : '発行内容を記録'}`} width={720} onClose={closeEditor}>
      <div className="standard-editor">{editor?.mode === 'plan' && data.recipients ? <InvoicePlanEditor key={editingUnit.id} unit={editingUnit} recipients={data.recipients} onSave={onSave} onClose={closeEditor} />
        : editor?.mode === 'debit' ? <ManualDebitEditor key={editingUnit.id} unit={editingUnit} recipientName={data.recipientName} onSave={onSave} onClose={closeEditor} />
        : <InvoiceUnitEditor key={editingUnit.id} unit={editingUnit} recipientName={data.recipientName} onSave={onSave} onClose={closeEditor} />}</div>
    </Modal>}
  </section>
}
