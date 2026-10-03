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

export type DebitOverviewProject = { projectId: number; projectName: string; customerName: string; days: string; amount: number }
function OverviewSection({ title, count, color, collapsed = false, children }: {
  title: string; count: number; color: string; collapsed?: boolean; children: ReactNode
}) {
  const heading = <><span>{title}（{count}件）</span>{collapsed && <span className="billing-overview-disclosure" aria-hidden="true" />}</>
  return collapsed ? <details className={`card billing-overview-section ${color}`}><summary>{heading}</summary>{children}</details>
    : <section className={`card billing-overview-section ${color}`}><h3>{heading}</h3>{children}</section>
}

/** Cross-project work list. Classification, saved payer and amount rules are unchanged. */
export function BillingOverviewPanel({ data, today, onViewDetail, setupItems = [], setupIssues = [], onSave, debitProjects = [] }: {
  data: BillingHistoryData; today: string; onViewDetail?: (projectId: number) => void
  setupItems?: readonly ScheduleSetupItem[]; setupIssues?: readonly ScheduleSetupIssue[]
  onSave?: (request: InvoiceWriteRequest) => Promise<unknown>; debitProjects?: readonly DebitOverviewProject[]
}) {
  const overview = buildBillingOverview(data.units, today)
  const [editor, setEditor] = useState<OverviewEditor | null>(null)
  const editingUnit = data.units.find(unit => unit.id === editor?.unitId)
  const noBillingCandidates = setupIssues.filter(issue => issue.category === 'no_billing_candidate')
  const actionRequired = setupIssues.filter(issue => issue.category === 'action_required')
  const nearTermCandidates = setupItems.filter(item => item.method === 'invoice' && overview.months.includes(item.date.slice(0, 7))
    && (item.status === 'missing' || item.status === 'overdue')
    && !overview.upcoming.some(unit => unit.projectId === item.projectId && unit.scheduledDate === item.date))
  const debitChecks = setupItems.filter(item => item.method === 'direct_debit')
  const movedItems = new Set<ScheduleSetupItem>([...nearTermCandidates, ...debitChecks])
  const remainingItems = setupItems.filter(item => !movedItems.has(item))
  const tableProps = { data, today, onViewDetail, onEdit: onSave ? setEditor : undefined }
  const closeEditor = () => setEditor(null)
  const issueList = (issues: readonly ScheduleSetupIssue[]) => <ul className="billing-overview-issues">{issues.map(issue => <li key={`${issue.projectId}:${issue.code}`}>
    <span><strong>{issue.projectName}</strong><small>{issue.reason}</small></span>
    {onViewDetail && <button type="button" className="btn btn-sub btn-sm" onClick={() => onViewDetail(issue.projectId)}>詳細で確認</button>}
  </li>)}</ul>
  return <section className="billing-overview">
    <header className="billing-overview-toolbar"><h2>請求</h2><div>
      <span>未入金 <strong>{fmtYen(overview.totals.unpaidAmount)}</strong> ／ 入金済 <strong>{fmtYen(overview.totals.receivedAmount)}</strong><small>今年度・昨年度・前払い分</small></span>
      <button type="button" className="btn btn-sub btn-sm" onClick={() => downloadBillingUnitCsv(buildBillingUnitCsv(data.units, data.recipientName, data.projectName))}>請求CSV</button>
    </div></header>
    {!!overview.totals.unknownActualCount && <p className="billing-overview-notice" role="status">金額要確認：{overview.totals.unknownActualCount}件。金額不明分は合計に含みません。</p>}
    {!!overview.olderUnpaid.length && <OverviewSection title="古い未入金" count={overview.olderUnpaid.length} color="amber">
      <p className="billing-overview-notice" role="status">今年度・昨年度より前の未入金です。入金を記録するまで警告に残します。確認できている金額：{fmtYen(overview.olderUnpaidTotals.unpaidAmount)}（上の合計には含みません）。
        {!!overview.olderUnpaidTotals.unknownActualCount && ` 金額要確認：${overview.olderUnpaidTotals.unknownActualCount}件。金額不明分は合計に含みません。`}</p>
      <BillingOverviewTable {...tableProps} units={overview.olderUnpaid} mode="unpaid" />
    </OverviewSection>}
    <OverviewSection title="未入金" count={overview.unpaid.length} color="red"><BillingOverviewTable {...tableProps} units={overview.unpaid} mode="unpaid" /></OverviewSection>
    <OverviewSection title="今月・来月・再来月の請求予定" count={overview.upcoming.length + nearTermCandidates.length} color="blue">
      <BillingOverviewTable {...tableProps} units={overview.upcoming} candidates={nearTermCandidates} mode="upcoming" />
      {!!nearTermCandidates.length && <p className="billing-overview-help">まだ保存していない予定候補です。「参考額」の行は請求先・保守期間・日付・金額を確認して登録してください。自動発行しません。</p>}
    </OverviewSection>
    <OverviewSection title="口座振替" count={new Set([...debitProjects.map(p => p.projectId), ...debitChecks.map(p => p.projectId), ...overview.debitPlans.map(p => p.projectId)]).size} color="purple" collapsed>
      <p className="billing-overview-help">銀行が振替を実行します。ここでは結果を確認するだけで、未保存は未払い・振替失敗を意味しません。</p>
      {!!debitChecks.length && <><h4 className="billing-overview-subtitle">口座振替の結果を確認（{debitChecks.length}件）</h4><BillingOverviewTable {...tableProps} candidates={debitChecks} mode="review" /></>}
      {!!overview.debitPlans.length && <><h4 className="billing-overview-subtitle">保存済みの振替予定（{overview.debitPlans.length}件）</h4><BillingOverviewTable {...tableProps} units={overview.debitPlans} mode="review" /></>}
      {!!debitProjects.length && <><h4 className="billing-overview-subtitle">口座振替の発電所（常時）</h4><div className="billing-overview-scroll"><table className="billing-overview-table"><thead><tr><th>発電所</th><th>現在の顧客</th><th>振替日</th><th className="billing-overview-money">今月の参考額（税込）</th><th className="billing-overview-operation">操作</th></tr></thead>
        <tbody>{debitProjects.map(project => <tr key={project.projectId}><td>{onViewDetail ? <button type="button" className="link-btn" onClick={() => onViewDetail(project.projectId)}>{project.projectName}</button> : project.projectName}</td><td>{project.customerName}<small>各回の請求先は詳細で確認</small></td><td>{project.days || '日付要確認'}</td><td className="billing-overview-money"><strong>{fmtYen(project.amount)}</strong><small>契約からの参考額</small></td><td>{onViewDetail && <button type="button" className="btn btn-sub btn-sm" onClick={() => onViewDetail(project.projectId)}>詳細</button>}</td></tr>)}</tbody></table></div></>}
      {!debitChecks.length && !overview.debitPlans.length && !debitProjects.length && <p className="billing-overview-empty">口座振替の対象はありません。</p>}
    </OverviewSection>
    <OverviewSection title="入金済" count={overview.received.length} color="green" collapsed><BillingOverviewTable {...tableProps} units={overview.received} mode="received" /></OverviewSection>
    {([['表示期間より前の予定', overview.overduePlans], ['日付要確認', overview.undatedPlans], ['それ以降の予定', overview.laterPlans], ['記録要確認', overview.review]] as const)
      .filter(([, units]) => units.length).map(([label, units]) => <OverviewSection key={label} title={label} count={units.length} color="amber" collapsed={label==='それ以降の予定'}><BillingOverviewTable {...tableProps} units={units} mode="review" /></OverviewSection>)}
    {!!remainingItems.length && <OverviewSection title="未保存・要確認の請求予定" count={remainingItems.length} color="amber">
      <p className="billing-overview-help">予定日を過ぎた候補・保存記録と一致しない候補です。発行済みか、別日に変更した同じ回がないか確認してください。自動発行しません。</p>
      <BillingOverviewTable {...tableProps} candidates={remainingItems} mode="review" />
      {remainingItems.filter(item => item.reason).map(item => <p className="billing-overview-help" key={`${item.projectId}:${item.date}:${item.round}:${item.method}`}>{item.projectName}（{item.date}）：{item.reason}</p>)}
    </OverviewSection>}
    {!!setupIssues.length && <OverviewSection title="請求設定要確認" count={setupIssues.length} color="amber" collapsed={!actionRequired.length}>
      <p className="billing-overview-help">請求方法・日付・金額を未設定のまま表示しています。自動で「請求なし」と確定しません。</p>
      {!!actionRequired.length && <><h4 className="billing-overview-subtitle">請求設定が必要（{actionRequired.length}件）</h4>{issueList(actionRequired)}</>}
      {!!noBillingCandidates.length && <details className="billing-overview-secondary"><summary>自社請求なし候補（{noBillingCandidates.length}件・未確定）</summary><p className="billing-overview-help">他社保守などの可能性があります。発電所ごとに確認します。</p>{issueList(noBillingCandidates)}</details>}
    </OverviewSection>}
    <p className="billing-overview-footer">金額・スケジュール・請求方法は「発電所 ＞ 請求情報」、各回の明細・保守期間・訂正は「請求詳細」で確認できます。請求CSVは全期間の各回を出力します。</p>
    {editingUnit && onSave && <Modal title={`${data.projectName(editingUnit.projectId)}：${editor?.mode === 'plan' ? '請求先・予定を設定' : editor?.mode === 'debit' ? '振替結果を記録' : editingUnit.lifecycle === 'issued' ? '入金日を記録' : '請求内容を入力して発行'}`} width={720} onClose={closeEditor}>
      <div className="standard-editor">{editor?.mode === 'plan' && data.recipients ? <InvoicePlanEditor key={editingUnit.id} unit={editingUnit} recipients={data.recipients} onSave={onSave} onClose={closeEditor} />
        : editor?.mode === 'debit' ? <ManualDebitEditor key={editingUnit.id} unit={editingUnit} recipientName={data.recipientName} onSave={onSave} onClose={closeEditor} />
        : <InvoiceUnitEditor key={editingUnit.id} unit={editingUnit} recipientName={data.recipientName} onSave={onSave} onClose={closeEditor} />}</div>
    </Modal>}
  </section>
}
