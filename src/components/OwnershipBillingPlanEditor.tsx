import { useEffect, useRef, useState, type ReactNode } from 'react'
import './OwnershipBillingPlanEditor.css'
import { prepareOwnershipBillingPlan, type TransferBillingChoice, type TransferBillingUnit } from '../lib/ownership-billing-plan'

type Owner = { id: number; name: string }
export function OwnershipBillingPlanEditor({projectId,oldOwner,newOwner,units:initialUnits,onSave,saveScope='plan',reviewContext,onReview,reviewSummary,testOnly=true,recipientOptions}:{
  projectId:number;oldOwner:Owner;newOwner:Owner;units:readonly TransferBillingUnit[];
  onSave?:(choices:TransferBillingChoice[],reason:string)=>Promise<void>
  saveScope?:'plan'|'ownership'
  reviewContext?:string;onReview?:()=>void;reviewSummary?:ReactNode;testOnly?:boolean
  recipientOptions?:readonly Owner[]
}) {
  // Keep the reviewed revision fixed for this editor session.
  const [units]=useState(()=>structuredClone(initialUnits))
  const [drafts,setDrafts]=useState(()=>units.filter(u=>u.lifecycle==='planned').map(u=>({
    unitId:u.id,expectedRevision:u.revision,recipientId:u.recipientId?.toString()??'',method:u.collectionState==='failed'?'請求書' as const:u.method,
    scheduledDate:u.scheduledDate??'',amount:u.plannedAmount?.toString()??'',periodStart:u.periodStart??'',periodEnd:u.periodEnd??'',note:u.planNote??'',
  })))
  const [result,setResult]=useState<ReturnType<typeof prepareOwnershipBillingPlan>|null>(null)
  const [error,setError]=useState('')
  const [reason,setReason]=useState(''),[busy,setBusy]=useState(false);const saving=useRef(false)
  useEffect(()=>{setResult(null)},[reviewContext])
  async function save(){
    if(!onSave||!result||saving.current)return
    if(!reason.trim()){setError('確認内容・理由を入力してください');return}
    saving.current=true;setBusy(true);setError('')
    try{await onSave(result.changes.map(c=>({...c})),reason.trim())}
    catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{saving.current=false;setBusy(false)}
  }
  const options=recipientOptions??[oldOwner,newOwner]
  const ownerName=(id:number)=>options.find(o=>o.id===id)?.name??`請求先ID ${id}`
  function patch(index:number,key:string,value:string){
    setDrafts(drafts.map((d,i)=>i===index?{...d,[key]:value}:d));setResult(null);setError('')
  }
  function review(event:React.FormEvent){
    event.preventDefault();setResult(null);setError('')
    try{
      onReview?.()
      const choices:TransferBillingChoice[]=drafts.map(d=>{
        if(d.amount!==''&&(!/^\d+$/.test(d.amount)||!Number.isSafeInteger(Number(d.amount))))throw Error('予定額は0円以上の整数で入力してください')
        return {unitId:d.unitId,expectedRevision:d.expectedRevision,recipientId:Number(d.recipientId),method:d.method,
          scheduledDate:d.scheduledDate,plannedAmount:d.amount===''?null:Number(d.amount),
          periodStart:d.periodStart||null,periodEnd:d.periodEnd||null,note:d.note}
      })
      setResult(prepareOwnershipBillingPlan({projectId,oldOwnerId:oldOwner.id,newOwnerId:newOwner.id,units,choices,
        allowedRecipientIds:saveScope==='plan'&&recipientOptions?recipientOptions.map(o=>o.id):undefined}))
    }catch(e){setError(e instanceof Error?e.message:String(e))}
  }
  return <section className="card ownership-billing-editor">
    <h2>{saveScope==='ownership'?'所有者変更後の請求予定':'今後の請求予定を確認・変更'}</h2>
    {saveScope==='ownership'&&<div className="ownership-billing-owners"><span>現在の所有者<br/><strong>{oldOwner.name}</strong></span><span aria-hidden="true">→</span><span>変更後の所有者<br/><strong>{newOwner.name}</strong></span></div>}
    <p>今の予定を表示しています。変更する回だけ、請求先や方法を選び直してください。</p>
    <div className="ownership-billing-notice">発行済み・入金済みなど {units.filter(u=>u.lifecycle!=='planned').length} 件は変更対象外です。自動の日割り計算・請求追加・銀行への振替手配は行いません。</div>
    {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
    <form onSubmit={review}><fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}>
      {drafts.map((d,i)=>{const unit=units.find(u=>u.id===d.unitId)!;const failed=unit.collectionState==='failed'
        return <fieldset key={d.unitId} className="ownership-billing-row">
          <legend>{unit.serviceYear}年 {unit.roundLabel}</legend>
          {failed&&<p>振替不能の回です。元の請求先を維持し、請求書として残します。</p>}
          <div className="ownership-billing-fields">
            <label>請求先<select className="form-input" value={d.recipientId} disabled={failed} onChange={e=>patch(i,'recipientId',e.target.value)}>
              <option value="">選択してください</option>{options.filter(o=>saveScope==='plan'||o.id===oldOwner.id||o.id===newOwner.id||o.id===unit.recipientId).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
            </select></label>
            <label>請求方法<select className="form-input" value={d.method} onChange={e=>patch(i,'method',e.target.value)}>
              <option>請求書</option>{!failed&&<option>口座振替</option>}
            </select></label>
            <label>請求・振替予定日<input className="form-input" type="date" required value={d.scheduledDate} onChange={e=>patch(i,'scheduledDate',e.target.value)}/></label>
            <label>予定額（税込）<input className="form-input" inputMode="numeric" value={d.amount} onChange={e=>patch(i,'amount',e.target.value)}/></label>
          </div>
          <details className="ownership-billing-extra"><summary>詳細設定：対象期間・備考{(d.periodStart||d.periodEnd||d.note)?'（入力あり）':''}</summary>
          <div className="ownership-billing-fields">
            <label>対象期間の開始（任意）<input className="form-input" type="date" value={d.periodStart} onChange={e=>patch(i,'periodStart',e.target.value)}/></label>
            <label>対象期間の終了（任意）<input className="form-input" type="date" value={d.periodEnd} onChange={e=>patch(i,'periodEnd',e.target.value)}/></label>
          </div>
          <label>備考<textarea className="form-input" value={d.note} onChange={e=>patch(i,'note',e.target.value)}/></label>
          </details>
        </fieldset>})}
      {!drafts.length&&<p>変更する予定はありません。新しい請求は自動作成しません。</p>}
      <div className="ownership-billing-footer"><span>予定額の空欄は「金額要確認」です。0円とは区別します。</span><button className="btn btn-main" type="submit">変更内容を確認（保存はしません）</button></div>
    </fieldset></form>
    {result&&<section aria-label="請求予定の確認結果" style={{marginTop:20}}>
      <h3>変更内容の確認</h3><p role="status">入力チェック完了。DBには保存していません。</p>
      {reviewSummary}
      {result.changes.map(c=>{const u=units.find(u=>u.id===c.unitId)!;return <div key={c.unitId} style={{padding:'12px 0',borderBottom:'1px solid #e2e8f0'}}>
        <strong>{u.serviceYear}年 {u.roundLabel}</strong>
        <p>請求先：{ownerName(u.recipientId??0)} → {ownerName(c.recipientId)} ／ 方法：{u.method} → {c.method}</p>
        <p>予定日：{u.scheduledDate??'未設定'} → {c.scheduledDate} ／ 予定額：{u.plannedAmount==null?'金額要確認':`${u.plannedAmount.toLocaleString()}円`} → {c.plannedAmount===null?'金額要確認':`${c.plannedAmount.toLocaleString()}円`}</p>
        <p>対象期間：{c.periodStart?`${c.periodStart} ～ ${c.periodEnd}`:'未指定'} ／ 備考：{c.note||'なし'}</p>
      </div>})}
      <p>変更しない記録：{result.preservedUnitIds.length}件</p>
      {onSave&&<div><label>確認内容・理由<textarea className="form-input" disabled={busy} value={reason} onChange={e=>setReason(e.target.value)}/></label>
        <p>{saveScope==='ownership'?'所有者・選択した契約情報・請求予定・履歴をまとめて保存します。':'請求予定だけを保存します。所有者・契約情報は変更しません。'}</p>
        <button className="btn btn-main" type="button" disabled={busy} onClick={()=>void save()}>{busy?'保存中…':`${testOnly?'検証用DBで':''}${saveScope==='ownership'?'所有者変更を確定':'予定と履歴を保存'}`}</button></div>}
    </section>}
  </section>
}
