import { useEffect, useState } from 'react'
import { InvoiceUnitEditor } from './InvoiceUnitEditor'
import { isEditableInvoicePlan, isBillingDate, billingUnitStatusLabel, resolveUnitAmount, type BillingUnit } from '../lib/billing-unit'
import type { InvoiceWriteRequest } from '../lib/invoice-write-session'
import { InvoicePlanEditor } from './InvoicePlanEditor'
import { ManualDebitEditor } from './ManualDebitEditor'
import { InvoiceCorrectionEditor } from './InvoiceCorrectionEditor'
import type { BillingHistoryData } from './BillingHistorySection'
import { fmtYen } from '../lib/utils'
import {MaintenancePeriodReview} from './MaintenancePeriodReview'
import type {SavedMaintenancePeriodChange} from '../lib/saved-maintenance-period'
import {Modal} from './Modal'
import type {Contract} from '../types'
import {billingDetailPeriods} from '../lib/billing-detail-periods'
import {detailPlanCandidate} from '../lib/billing-detail-plan'
import {BillingOccurrenceCreator,type AddBillingOccurrence} from './BillingOccurrenceCreator'
import type {MaintenanceScheduleItem} from '../lib/maintenance-schedule'
import {annualBillableTotalInc} from '../lib/billing'
import {routineInvoiceContext,type AddRoutineInvoice} from '../lib/routine-invoice'
import {RoutineInvoiceEditor} from './RoutineInvoiceEditor'

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

function periodLabel(unit: BillingUnit,startDate?:string|null): string {
  const group=billingDetailPeriods([unit],startDate)[0]
  return group.label+(group.inferred?'（参考・未確認）':'')
}

function roundLabel(unit:BillingUnit):string {
  if(unit.roundLabel==='保存済み単回記録')return '回数未確認の記録'
  if(unit.method==='口座振替'&&/^第\d+回$/.test(unit.roundLabel)&&unit.scheduledDate&&isBillingDate(unit.scheduledDate))
    return `${Number(unit.scheduledDate.slice(5,7))}月分（${unit.roundLabel}）`
  return unit.roundLabel
}

function BillingDates({method,scheduledDate,issuedOn,paymentDueOn,receivedOn,reference=false}:{
  method:BillingUnit['method'];scheduledDate?:string|null;issuedOn?:string|null;paymentDueOn?:string|null;receivedOn?:string|null;reference?:boolean
}){
  const debit=method==='口座振替'
  return <div className="invoice-date-groups">
    <section className="invoice-date-group invoice-date-group-billing"><h4>{debit?'口座振替':'請求'}</h4><dl>
      <div><dt>{debit?'振替予定日':'請求予定日'}</dt><dd>{scheduledDate||'未登録'}{reference&&scheduledDate?'（参考）':''}</dd></div>
      {!debit&&<div><dt>請求日</dt><dd>{issuedOn||'未登録'}</dd></div>}
    </dl></section>
    <section className="invoice-date-group invoice-date-group-received"><h4>入金</h4><dl>
      <div><dt>入金予定日</dt><dd>{paymentDueOn||'未登録'}</dd></div>
      <div><dt>{debit?'入金日（振替確認日）':'入金日'}</dt><dd>{receivedOn||'未登録'}</dd></div>
    </dl></section>
  </div>
}

export function InvoiceLedgerDetail({ data, projectId, onSave, maintenanceStartDate, onSavePeriod,contract,currentRecipientId,onAddSchedule,today,onAddRoutine }: {
  data: BillingHistoryData
  projectId: number
  onSave?: (request: InvoiceWriteRequest) => Promise<unknown>
  maintenanceStartDate?:string|null
  onSavePeriod?:(change:SavedMaintenancePeriodChange)=>Promise<unknown>
  contract?:Contract
  currentRecipientId?:number
  onAddSchedule?:AddBillingOccurrence
  today?:string
  onAddRoutine?:AddRoutineInvoice
}) {
  const units = data.units.filter(unit => unit.projectId === projectId)
  const first = initialUnit(units)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ unitId: string; mode: EditorMode } | null>(null)
  const candidate=contract&&currentRecipientId?detailPlanCandidate(contract,currentRecipientId,units,today??new Date().toLocaleDateString('sv-SE'),data.managementEvents,data.cycleRules):null
  const canCreate=!!onAddSchedule&&!!data.recipients&&isBillingDate(contract?.maintenance_start_date??'')
  const active=first&&!['received','cancelled'].includes(first.lifecycle)
  const focused = units.find(unit => unit.id === focusedId) ?? (active||!candidate?first:undefined)
  const editingUnit = units.find(unit => unit.id === editor?.unitId)
  const history = billingDetailPeriods(units,maintenanceStartDate)
  const [adding,setAdding]=useState<{after:EditorMode|null}|null>(null)
  const [created,setCreated]=useState<{projectId:number;item:MaintenanceScheduleItem;after:EditorMode|null}|null>(null)
  const [recording,setRecording]=useState<ReturnType<typeof routineInvoiceContext>>(null)
  const [recordingBusy,setRecordingBusy]=useState(false)
  const routine=contract&&candidate?routineInvoiceContext(contract,candidate,data,today??new Date().toLocaleDateString('sv-SE')):null
  const canRecord=!!routine&&!!onAddRoutine&&!!onSave&&!!data.recipients
  useEffect(()=>{setFocusedId(null);setEditor(null);setAdding(null);setCreated(null);setRecording(null)},[projectId])
  useEffect(()=>{
    if(!created)return
    if(created.projectId!==projectId){setCreated(null);return}
    const added=units.find(u=>u.serviceYear===created.item.year&&u.roundLabel===`第${created.item.round}回`&&u.scheduledDate===created.item.date)
    if(added){setFocusedId(added.id);if(created.after)setEditor({unitId:added.id,mode:created.after});setCreated(null)}
  },[created,units,projectId])

  const openEditor = (unit: BillingUnit, mode: EditorMode) => {
    setFocusedId(unit.id)
    setEditor({ unitId: unit.id, mode })
  }
  const closeEditor = () => setEditor(null)

  return <section className="invoice-detail-classic">
    <div className="invoice-detail-toolbar"><h3>請求詳細</h3><div>
      {focusedId&&candidate&&<button type="button" className="btn btn-sub btn-sm" onClick={()=>{setFocusedId(null);setEditor(null)}}>今回・次回の請求に戻る</button>}
      {candidate&&canCreate&&<button type="button" className="btn btn-sub btn-sm" onClick={()=>setAdding({after:null})}>＋ 請求・振替予定を追加</button>}
    </div></div>
    <div className="invoice-detail-columns">
    <div className="invoice-detail-main">
    {!focused ? <div className="card invoice-current-card">
      <div className="invoice-current-heading"><div><span>今回・次回の請求</span><h2>{candidate?.method==='direct_debit'?`${candidate.date?Number(candidate.date.slice(5,7))+'月の':'今回の'}口座振替`:'請求予定'}</h2></div><span className="billing-unit-status billing-unit-status-planned">未登録</span></div>
      {candidate?<>
        <div className="invoice-current-amount">{candidate.amount==null?'金額要確認':fmtYen(candidate.amount)}</div>
        <p className="invoice-current-basis">契約からの参考額 ／ {candidate.method==='direct_debit'?'口座振替':'請求書'}</p>
        <dl className="invoice-current-facts">
          <div><dt>{canRecord?'請求先（発行時に確認）':'請求先の候補'}</dt><dd>{data.recipientName(candidate.recipientId)}</dd></div>
          <div><dt>対象の回</dt><dd>第{candidate.round}回（参考）</dd></div>
          <div className="invoice-period-fact"><dt>保守期間</dt><dd>{candidate.periodStart&&candidate.periodEnd?`${candidate.periodStart} ～ ${candidate.periodEnd}（参考）`:'保守開始日未設定'}</dd></div>
        </dl>
        <BillingDates method={candidate.method==='direct_debit'?'口座振替':'請求書'} scheduledDate={candidate.date} reference/>
        {contract&&<p className="invoice-current-basis">年間総額（税込・請求対象のみ）：{fmtYen(annualBillableTotalInc(contract))}</p>}
        <p className="invoice-reference-help">{canRecord?'請求先は現在の顧客を初期選択しています。「発行内容を記録」で請求日・実際の明細と一緒に保存できます。事前の予定登録は不要です。':'まだ保存していない予定候補です。請求先・対象期間・日付・金額を確認して登録してください。過去の請求・入金実績ではありません。'}</p>
        {candidate.reviewReason&&<p className="billing-overview-notice" role="alert">保守期間要確認：{candidate.reviewReason}</p>}
        {!candidate.periodStart&&<p className="invoice-reference-help">「保守情報」で保守開始日を確認してください。委託契約の開始日とは別の項目です。</p>}
        {canCreate&&<div className="invoice-current-actions">{canRecord&&<button type="button" className="btn btn-main" onClick={()=>setRecording(routine)}>発行内容を記録</button>}<button type="button" className={canRecord?'btn':'btn btn-main'} onClick={()=>setAdding({after:null})}>{candidate.reviewReason?'予定を確認・調整':'予定を登録'}</button>{!canRecord&&!candidate.reviewReason&&<button type="button" className="btn" onClick={()=>setAdding({after:candidate.method==='direct_debit'?'debit':'invoice'})}>{candidate.method==='direct_debit'?'振替結果を記録':'請求内容を入力して発行'}</button>}</div>}
      </>:<p className="invoice-reference-help">{units.length?'追加できる予定候補がありません。「請求情報」の設定と保存済み記録を確認してください。':'この発電所の請求記録はまだありません。「請求情報」で請求方法・予定日を確認してください。'}</p>}
      {!!contract?.notes&&<div className="invoice-current-lines"><h3>備考</h3><p style={{whiteSpace:'pre-wrap'}}>{contract.notes}</p></div>}
    </div> : (() => {
      const amount = resolveUnitAmount(focused, () => data.plannedAmount(focused))
      const status = billingUnitStatusLabel(focused)
      const recipient = focused.recipientId == null ? '請求先要確認' : data.recipientName(focused.recipientId)
      const canEditPlan = !!onSave && !!data.recipients && isEditableInvoicePlan(focused)
      const canIssue = !!onSave && isEditableInvoicePlan(focused) && focused.recipientId != null
      const canCollect = !!onSave && focused.method === '請求書' && focused.lifecycle === 'issued' && !focused.receivedOn
      const canCorrectInvoice = !!onSave && !!data.recipients && focused.method === '請求書' && ['issued', 'received'].includes(focused.lifecycle)
      const canRecordDebit = !!onSave && focused.method === '口座振替' && focused.lifecycle === 'planned' && !focused.receivedOn && focused.frozenAmount === null && focused.recipientId!=null
      const canCorrectDebit = !!onSave && focused.method === '口座振替' && focused.lifecycle === 'received'

      return <>
            <div className="card invoice-current-card">
              <div className="invoice-current-heading">
                <div><span>{focusedId?'選択した請求・入金記録':'今回・次回の請求'}</span><h2>{roundLabel(focused)}</h2></div>
                <span className={`billing-unit-status billing-unit-status-${focused.lifecycle}`}>{status}</span>
              </div>
              <div className="invoice-current-amount">{amount.amount == null ? '金額要確認' : fmtYen(amount.amount)}</div>
              <div className="invoice-current-basis">{amount.basis} ／ {focused.method}</div>

              <dl className="invoice-current-facts">
                <div><dt>請求先</dt><dd className={focused.recipientId == null ? 'invoice-attention' : ''}>{recipient}</dd></div>
                <div><dt>対象の回</dt><dd>{focused.roundLabel==='保存済み単回記録'?'回数未確認':focused.roundLabel}</dd></div>
                <div className="invoice-period-fact"><dt>保守期間</dt><dd>{periodLabel(focused,maintenanceStartDate)}</dd></div>
              </dl>
              <BillingDates method={focused.method} scheduledDate={focused.scheduledDate} issuedOn={focused.issuedOn} paymentDueOn={focused.paymentDueOn} receivedOn={focused.receivedOn}/>

              <div className="invoice-current-lines">
                <h3>請求明細</h3>
                {focused.frozenLineItems?.length ? focused.frozenLineItems.map((item, index) =>
                  <div key={`${item.name}-${index}`}><span>{item.name}</span><strong>{fmtYen(item.amount)}</strong></div>)
                  : <p>{focused.lifecycle === 'planned' ? '明細は請求・振替結果を記録するときに入力します。' : '明細が保存されていません。'}</p>}
              </div>
              {!!focused.planNote&&<div className="invoice-current-lines"><h3>この回の備考</h3><p style={{whiteSpace:'pre-wrap'}}>{focused.planNote}</p></div>}

              {onSave && <div className="invoice-current-actions">
                {canIssue && <button className="btn btn-main" type="button" onClick={() => openEditor(focused, 'invoice')}>請求内容を入力して発行</button>}
                {canCollect && <button className="btn btn-main" type="button" onClick={() => openEditor(focused, 'invoice')}>入金日を記録</button>}
                {canRecordDebit && <button className="btn btn-main" type="button" onClick={() => openEditor(focused, 'debit')}>振替結果を記録</button>}
                {canEditPlan && <button className="btn" type="button" onClick={() => openEditor(focused, 'plan')}>{focused.recipientId == null ? '請求先・予定を設定' : '予定を変更'}</button>}
                {canCorrectInvoice && <button className="btn" type="button" onClick={() => openEditor(focused, 'correction')}>この記録を訂正</button>}
                {canCorrectDebit && <button className="btn" type="button" onClick={() => openEditor(focused, 'debit')}>この記録を訂正</button>}
              </div>}
            </div>

        {editingUnit && onSave && <Modal title={editor?.mode==='correction'?'請求・入金記録を訂正':editor?.mode==='plan'?'請求予定を編集':editor?.mode==='debit'?'振替結果を記録':editingUnit.lifecycle==='issued'?'入金日を記録':'請求内容を入力して発行'} width={720} onClose={closeEditor}><div className="standard-editor">
          {editor?.mode === 'correction' && data.recipients
            ? <InvoiceCorrectionEditor key={`correction-${editingUnit.id}`} unit={editingUnit} recipients={data.recipients} onSave={onSave} onClose={closeEditor} />
            : editor?.mode === 'debit'
              ? <ManualDebitEditor key={`debit-${editingUnit.id}`} unit={editingUnit} recipientName={data.recipientName} onSave={onSave} onClose={closeEditor} />
              : editor?.mode === 'plan' && data.recipients
                ? <InvoicePlanEditor key={`plan-${editingUnit.id}`} unit={editingUnit} recipients={data.recipients} onSave={onSave} onClose={closeEditor} />
                : <InvoiceUnitEditor key={editingUnit.id} unit={editingUnit} recipientName={data.recipientName} onSave={onSave} onClose={closeEditor} />}
        </div></Modal>}
      </>
    })()}
    </div>
    <aside className="card invoice-history-panel">
      <div className="invoice-history-heading"><div><span>保守期間ごとの</span><h3>過去の請求・入金記録</h3></div><b>{history.length}期間・{units.length}件</b></div>
      {!units.length&&<p className="empty-cell">保存済みの請求・入金記録はありません。</p>}
      <div className="invoice-history-list">
        {history.map(group=><section className="invoice-period-group" key={group.key} aria-label={`保守期間：${group.label}`}>
          <div className="invoice-period-heading"><strong>{group.label}</strong><span>{group.units.length}件</span></div>
          {group.inferred&&<p className="invoice-period-unconfirmed">参考・未確認：保守開始日からの表示です。期間はまだ保存されていない記録があります。</p>}
          {group.units.map(unit=>{
            const amount=resolveUnitAmount(unit)
            return <button type="button" key={unit.id} className={`invoice-history-item ${focused?.id===unit.id?'is-selected':''}`} onClick={()=>{setFocusedId(unit.id);setEditor(null)}}>
              <span className="invoice-history-row"><b>{roundLabel(unit)}</b><em>{billingUnitStatusLabel(unit)}</em><strong>{amount.amount==null?'金額要確認':fmtYen(amount.amount)}</strong></span>
              <span className="invoice-history-meta">請求先：{unit.recipientId==null?'要確認':data.recipientName(unit.recipientId)} ／ {unit.method} ／ {amount.basis}</span>
              <span className="invoice-history-dates"><span>{unit.method==='口座振替'?'振替予定日':'請求予定日'}：{unit.scheduledDate??'未登録'}</span>{unit.method==='請求書'&&<span>請求日：{unit.issuedOn??'未登録'}</span>}<span>入金予定日：{unit.paymentDueOn??'未登録'}</span><span>{unit.method==='口座振替'?'入金日（振替確認日）':'入金日'}：{unit.receivedOn??'未登録'}</span></span>
            </button>
          })}
        </section>)}
      </div><p className="invoice-history-help">各回を選ぶと、左側で明細の確認・記録の訂正ができます。請求日が期間外でも、対象の保守期間にまとめます。</p>
    </aside>
    </div>
    {recording&&onAddRoutine&&onSave&&data.recipients&&<Modal title="発行内容を記録" width={720} closeDisabled={recordingBusy} onClose={()=>setRecording(null)}><div className="standard-editor"><RoutineInvoiceEditor context={recording} recipients={data.recipients} onAdd={onAddRoutine} onSave={onSave} onBusyChange={setRecordingBusy} onClose={()=>setRecording(null)}/></div></Modal>}
    {adding&&candidate&&contract&&onAddSchedule&&data.recipients&&<Modal title="請求・振替予定を追加" width={720} onClose={()=>setAdding(null)}><div className="standard-editor"><BillingOccurrenceCreator key={`${projectId}:${JSON.stringify(candidate)}:${units.map(u=>u.id+':'+u.revision).join(',')}`} candidate={candidate} contract={contract} units={units} recipients={data.recipients} cycleRules={data.cycleRules}
      onSave={async(item,reason)=>{await onAddSchedule(item,reason);setCreated({projectId,item,after:adding.after})}} onClose={()=>setAdding(null)}/></div></Modal>}
    {!!units.length&&maintenanceStartDate!==undefined&&<div className="card" style={{padding:20,marginTop:16}}>
      <h3>保守期間の確認・修正</h3>
      <MaintenancePeriodReview startDate={maintenanceStartDate} units={units} onSave={onSavePeriod}/>
    </div>}
  </section>
}
