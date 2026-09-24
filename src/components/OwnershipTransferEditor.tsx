import {useState} from 'react'
import type {Contract,Project} from '../types'
import {ContractTransferFields} from './ContractTransferFields'
import {OwnershipBillingPlanEditor} from './OwnershipBillingPlanEditor'
import {prepareOwnershipFields} from '../lib/ownership-field-selection'
import {contractTransferLabels,validateContractBillingSettings,type ContractChoices} from '../lib/contract-transfer-form'
import type {TransferBillingChoice,TransferBillingUnit} from '../lib/ownership-billing-plan'
import {maintenanceSchedule,type MaintenanceScheduleItem} from '../lib/maintenance-schedule'
import {isBillingDate} from '../lib/billing-unit'
import {maintenancePeriodLabel} from '../lib/maintenance-period-label'
import type {ManagementEvent} from '../lib/management-lifecycle'
import './OwnershipTransferEditor.css'

export type OwnershipTransferInput={project:Project;contract:Contract;newOwner:number;futureRecipient:number;date:string;fields:{contract:ContractChoices};choices:(TransferBillingChoice|{newOccurrence:MaintenanceScheduleItem})[];reason:string}
export function OwnershipTransferEditor({project:initialProject,contract:initialContract,customers,units,managementEvents=[],onSave,testOnly=false}:{
  project:Project;contract:Contract;customers:readonly {id:number;name:string}[];units:readonly TransferBillingUnit[];managementEvents?:readonly ManagementEvent[];
  onSave:(input:OwnershipTransferInput)=>Promise<void>;testOnly?:boolean
}){
  const [project]=useState(()=>structuredClone(initialProject)),[contract]=useState(()=>structuredClone(initialContract))
  const [target,setTarget]=useState(''),[date,setDate]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`})
  const [fields,setFields]=useState<ContractChoices>({}),[busy,setBusy]=useState(false)
  const [future,setFuture]=useState<'old'|'new'>('new')
  const [addNext,setAddNext]=useState(false),[nextYear,setNextYear]=useState(new Date().getFullYear())
  const [nextRound,setNextRound]=useState(1),[nextDate,setNextDate]=useState(''),[nextAmount,setNextAmount]=useState('')
  const [individualPeriod,setIndividualPeriod]=useState(false),[periodStart,setPeriodStart]=useState(''),[periodEnd,setPeriodEnd]=useState('')
  const [nextMethod,setNextMethod]=useState<'invoice'|'direct_debit'>(contract.billing_method==='口座振替'?'direct_debit':'invoice')
  const [nextRecipient,setNextRecipient]=useState<'old'|'new'>('old')
  const oldOwner=customers.find(c=>c.id===project.customer_id),newOwner=customers.find(c=>c.id===Number(target))
  function validate(){
    const prepared=prepareOwnershipFields(project,contract,{contract:fields})
    validateContractBillingSettings(prepared.after.contract,fields)
    if(!date)throw Error('移転日を入力してください')
    let nextOccurrence:MaintenanceScheduleItem|undefined
    if(addNext){
      if(!newOwner||!oldOwner)throw Error('変更前後の所有者を選択してください')
      if(!isBillingDate(nextDate)||!/^\d+$/.test(nextAmount)||!Number.isSafeInteger(Number(nextAmount)))throw Error('未保存回の予定日・予定額を確認してください')
      const recipientId=nextRecipient==='old'?oldOwner.id:newOwner.id
      const candidate=maintenanceSchedule(prepared.after.contract as Contract,nextYear,recipientId,units,managementEvents,
        individualPeriod?{periodStart,periodEnd}:undefined).find(item=>item.round===nextRound)
      if(!candidate||candidate.exclusion)throw Error(candidate?.exclusion??'未保存回の保守期間・回数を確認してください')
      nextOccurrence={...candidate,method:nextMethod,date:nextDate,amount:Number(nextAmount)}
    }
    return {prepared,nextOccurrence}
  }
  if(!oldOwner)return <p role="alert">現在の所有者を確認できません。保存はできません。</p>
  return <section className="ownership-transfer-shell">
    <header className="ownership-transfer-heading"><div><span className="ownership-transfer-kicker">発電所の所有者変更</span><h2>{project.plant_name||project.project_name}</h2><p>所有者・契約・今後の請求を一度に確認して保存します。</p></div><span className="ownership-transfer-safe">変更前の情報は履歴に保存</span></header>
    <ol className="ownership-transfer-steps" aria-label="所有者変更の手順"><li className="active"><b>1</b>変更内容を入力</li><li><b>2</b>請求予定を確認</li><li><b>3</b>最終確認・保存</li></ol>
    <div className="ownership-transfer-notice">旧所有者の見込み情報を守るため、変更前後の顧客に紐づく見込みとの自動同期は停止します。見込み情報の変更は「見込み管理」で行ってください。</div>
    <fieldset disabled={busy} className="ownership-transfer-fieldset">
      <section className="ownership-transfer-card"><h3>所有者と変更日</h3><div className="ownership-transfer-grid">
        <div className="ownership-transfer-current"><span>現在の所有者</span><strong>{oldOwner.name}</strong><small>顧客ID {oldOwner.id}</small></div>
        <span className="ownership-transfer-arrow" aria-hidden="true">→</span>
        <label>新しい所有者<select className="form-input" value={target} onChange={e=>setTarget(e.target.value)}><option value="">顧客を選択してください</option>{customers.filter(c=>c.id!==project.customer_id).map(c=><option key={c.id} value={c.id}>{c.name}（顧客ID {c.id}）</option>)}</select></label>
        <label>変更日<input className="form-input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
      </div></section>
      {newOwner&&<section className="ownership-transfer-card"><h3>変更後に追加する請求</h3><label>基本の請求先<select className="form-input" value={future} onChange={e=>setFuture(e.target.value as 'old'|'new')}><option value="new">{newOwner.name}</option><option value="old">{oldOwner.name}</option></select></label><p>下の各回の指定を優先します。請求の自動追加や銀行への振替手配は行いません。</p></section>}
      {newOwner&&<section className="ownership-transfer-card"><h3>まだ保存していない1回を指定</h3>
        <label><input type="checkbox" checked={addNext} onChange={e=>setAddNext(e.target.checked)}/> 今回の所有者変更と同時に、確認した1回を保存する</label>
        <p>選ばなければ予定を追加しません。選ぶ場合も発行・入金・銀行への振替手配は行いません。既に保存済みの回は下の一覧で変更してください。</p>
        {addNext&&<div className="ownership-transfer-grid">
          <label>保守期間の開始年<input className="form-input" type="number" min="2000" max="2199" value={nextYear} onChange={e=>setNextYear(Number(e.target.value))}/></label>
          <label>第何回<input className="form-input" type="number" min="1" max="96" value={nextRound} onChange={e=>setNextRound(Number(e.target.value))}/></label>
          <label>請求先<select className="form-input" value={nextRecipient} onChange={e=>setNextRecipient(e.target.value as 'old'|'new')}><option value="old">{oldOwner.name}</option><option value="new">{newOwner.name}</option></select></label>
          <label>方法<select className="form-input" value={nextMethod} onChange={e=>setNextMethod(e.target.value as 'invoice'|'direct_debit')}><option value="invoice">請求書</option><option value="direct_debit">口座振替</option></select></label>
          <label>請求・振替予定日<input className="form-input" type="date" value={nextDate} onChange={e=>setNextDate(e.target.value)}/></label>
          <label>予定額（税込）<input className="form-input" type="number" min="0" step="1" value={nextAmount} onChange={e=>setNextAmount(e.target.value)}/></label>
          <label><input type="checkbox" checked={individualPeriod} onChange={e=>setIndividualPeriod(e.target.checked)}/> この回の保守期間を個別指定する</label>
          {individualPeriod&&<><label>保守期間の開始日<input className="form-input" type="date" value={periodStart} onChange={e=>setPeriodStart(e.target.value)}/></label>
          <label>保守期間の終了日<input className="form-input" type="date" value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)}/></label></>}
        </div>}
      </section>}
      <ContractTransferFields contract={contract} choices={fields} onChange={setFields} disabled={busy}/>
    </fieldset>
    {newOwner&&<OwnershipBillingPlanEditor key={newOwner.id} projectId={project.id} oldOwner={oldOwner} newOwner={newOwner} units={units} saveScope="ownership" testOnly={testOnly} recipientOptions={customers}
      reviewContext={JSON.stringify({date,fields,future,addNext,nextYear,nextRound,nextDate,nextAmount,nextMethod,nextRecipient,individualPeriod,periodStart,periodEnd})} onReview={validate}
      reviewSummary={<div className="ownership-final-summary"><h4>所有者・契約情報</h4><p>変更日：{date}</p><p>今後の基本請求先：{future==='old'?oldOwner.name:newOwner.name}</p>{addNext&&<p>未保存の1回：{nextYear}年・第{nextRound}回 ／ {nextDate} ／ {nextRecipient==='old'?oldOwner.name:newOwner.name} ／ {nextMethod==='invoice'?'請求書':'口座振替'} ／ {Number(nextAmount).toLocaleString()}円 ／ {individualPeriod?`保守期間：${periodStart} ～ ${periodEnd}`:maintenancePeriodLabel((prepareOwnershipFields(project,contract,{contract:fields}).after.contract as Contract).maintenance_start_date,nextYear)}</p>}{Object.entries(fields).filter(([,c])=>c.mode!=='keep').map(([key,c])=><p key={key}>{contractTransferLabels[key as keyof Contract]}：{c.mode==='clear'?'引き継がない（旧値は履歴に保存）':c.mode==='change'?`変更 → ${JSON.stringify(c.value)}`:'そのまま'}</p>)}<p>上記以外の契約情報はそのまま引き継ぎます。</p></div>}
      onSave={async(choices,reason)=>{const {nextOccurrence}=validate();setBusy(true);try{await onSave({project,contract,newOwner:newOwner.id,futureRecipient:future==='old'?oldOwner.id:newOwner.id,date,fields:{contract:fields},choices:nextOccurrence?[...choices,{newOccurrence:nextOccurrence}]:choices,reason})}finally{setBusy(false)}}}/ >}
  </section>
}
