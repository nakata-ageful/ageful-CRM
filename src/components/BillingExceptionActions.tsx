import {useState} from 'react'
import type {CustomerChoice} from '../lib/customer-search'
import type {TransferBillingChoice,TransferBillingUnit} from '../lib/ownership-billing-plan'
import {ManualDebitPlanCreator,type NewDebitPlan} from './ManualDebitPlanCreator'
import {OwnershipBillingPlanEditor} from './OwnershipBillingPlanEditor'
import {Modal} from './Modal'

export function BillingExceptionActions({projectId,owner,recipients,units,onAddDebit,onSavePlan}:{projectId:number;
  owner:CustomerChoice;recipients?:readonly CustomerChoice[];units?:readonly TransferBillingUnit[];
  onAddDebit?:(value:NewDebitPlan)=>Promise<void>;onSavePlan?:(choices:TransferBillingChoice[],reason:string)=>Promise<void>
}){
  const [editing,setEditing]=useState<'debit'|'plan'|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
  const close=()=>{if(!busy)setEditing(null)}
  return <>{notice&&<p role="status" className="notice">{notice}</p>}<div className="management-action-grid">
    {onAddDebit&&<section className="card management-action"><h3>振替予定を1件追加</h3><p>対象の月・振替日・請求先を指定します。銀行への振替手配は行いません。</p><button type="button" className="btn btn-sub" onClick={()=>setEditing('debit')}>振替予定を追加する</button></section>}
    {units&&onSavePlan&&<section className="card management-action"><h3>保存済みの請求予定を変更</h3><p>今後の請求先・方法・予定額をまとめて変更します。発行済み・入金済みは変更対象外です。</p><button type="button" className="btn btn-sub" onClick={()=>setEditing('plan')}>請求先・方法・予定額を変更する</button></section>}
  </div>
  {editing&&<Modal title={editing==='debit'?'振替予定を1件追加':'保存済みの請求予定を変更'} width={860} onClose={close}><div className="standard-editor">
    {editing==='debit'&&onAddDebit&&<ManualDebitPlanCreator expanded recipients={recipients} testOnly={false} onSave={async value=>{setBusy(true);try{await onAddDebit(value);setNotice('振替予定を1件追加しました。');setEditing(null)}finally{setBusy(false)}}}/>}
    {editing==='plan'&&units&&onSavePlan&&<OwnershipBillingPlanEditor key={units.map(u=>`${u.id}:${u.revision}`).join(',')} projectId={projectId} oldOwner={owner} newOwner={owner} recipientOptions={recipients} units={units} testOnly={false}
      onSave={async(choices,reason)=>{setBusy(true);try{await onSavePlan(choices,reason);setNotice('保存済みの請求予定を変更しました。');setEditing(null)}finally{setBusy(false)}}}/>}
  </div></Modal>}
  </>
}
