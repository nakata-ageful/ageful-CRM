import {useState} from 'react'
import type {Contract,Project} from '../types'
import {ContractTransferFields} from './ContractTransferFields'
import {OwnershipBillingPlanEditor} from './OwnershipBillingPlanEditor'
import {prepareOwnershipFields} from '../lib/ownership-field-selection'
import {contractTransferLabels,validateContractBillingSettings,type ContractChoices} from '../lib/contract-transfer-form'
import type {TransferBillingChoice,TransferBillingUnit} from '../lib/ownership-billing-plan'
import './OwnershipTransferEditor.css'

export type OwnershipTransferInput={project:Project;contract:Contract;newOwner:number;futureRecipient:number;date:string;fields:{contract:ContractChoices};choices:TransferBillingChoice[];reason:string}
export function OwnershipTransferEditor({project:initialProject,contract:initialContract,customers,units,onSave,testOnly=false}:{
  project:Project;contract:Contract;customers:readonly {id:number;name:string}[];units:readonly TransferBillingUnit[];
  onSave:(input:OwnershipTransferInput)=>Promise<void>;testOnly?:boolean
}){
  const [project]=useState(()=>structuredClone(initialProject)),[contract]=useState(()=>structuredClone(initialContract))
  const [target,setTarget]=useState(''),[date,setDate]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`})
  const [fields,setFields]=useState<ContractChoices>({}),[busy,setBusy]=useState(false)
  const [future,setFuture]=useState<'old'|'new'>('new')
  const oldOwner=customers.find(c=>c.id===project.customer_id),newOwner=customers.find(c=>c.id===Number(target))
  function validate(){
    const prepared=prepareOwnershipFields(project,contract,{contract:fields})
    validateContractBillingSettings(prepared.after.contract,fields)
    if(!date)throw Error('移転日を入力してください')
    return prepared
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
      <ContractTransferFields contract={contract} choices={fields} onChange={setFields} disabled={busy}/>
    </fieldset>
    {newOwner&&<OwnershipBillingPlanEditor key={newOwner.id} projectId={project.id} oldOwner={oldOwner} newOwner={newOwner} units={units} saveScope="ownership" testOnly={testOnly} recipientOptions={customers}
      reviewContext={JSON.stringify({date,fields,future})} onReview={validate}
      reviewSummary={<div className="ownership-final-summary"><h4>所有者・契約情報</h4><p>変更日：{date}</p><p>今後の基本請求先：{future==='old'?oldOwner.name:newOwner.name}</p>{Object.entries(fields).filter(([,c])=>c.mode!=='keep').map(([key,c])=><p key={key}>{contractTransferLabels[key as keyof Contract]}：{c.mode==='clear'?'引き継がない（旧値は履歴に保存）':c.mode==='change'?`変更 → ${JSON.stringify(c.value)}`:'そのまま'}</p>)}<p>上記以外の契約情報はそのまま引き継ぎます。</p></div>}
      onSave={async(choices,reason)=>{validate();setBusy(true);try{await onSave({project,contract,newOwner:newOwner.id,futureRecipient:future==='old'?oldOwner.id:newOwner.id,date,fields:{contract:fields},choices,reason})}finally{setBusy(false)}}}/ >}
  </section>
}
