import { useState } from 'react'
import { prepareOwnershipBillingPlan, type TransferBillingChoice, type TransferBillingUnit } from '../lib/ownership-billing-plan'

type Owner = { id: number; name: string }
export function OwnershipBillingPlanEditor({projectId,oldOwner,newOwner,units:initialUnits}:{
  projectId:number;oldOwner:Owner;newOwner:Owner;units:readonly TransferBillingUnit[]
}) {
  // Keep the reviewed revision fixed for this editor session.
  const [units]=useState(()=>structuredClone(initialUnits))
  const [drafts,setDrafts]=useState(()=>units.filter(u=>u.lifecycle==='planned').map(u=>({
    unitId:u.id,expectedRevision:u.revision,recipientId:u.recipientId?.toString()??'',method:u.collectionState==='failed'?'請求書' as const:u.method,
    scheduledDate:u.scheduledDate??'',amount:u.plannedAmount?.toString()??'',periodStart:'',periodEnd:'',note:'',
  })))
  const [result,setResult]=useState<ReturnType<typeof prepareOwnershipBillingPlan>|null>(null)
  const [error,setError]=useState('')
  const ownerName=(id:number)=>[oldOwner,newOwner].find(o=>o.id===id)?.name??'請求先要確認'
  function patch(index:number,key:string,value:string){
    setDrafts(drafts.map((d,i)=>i===index?{...d,[key]:value}:d));setResult(null);setError('')
  }
  function review(event:React.FormEvent){
    event.preventDefault();setResult(null);setError('')
    try{
      const choices:TransferBillingChoice[]=drafts.map(d=>{
        if(d.amount!==''&&(!/^\d+$/.test(d.amount)||!Number.isSafeInteger(Number(d.amount))))throw Error('予定額は0円以上の整数で入力してください')
        return {unitId:d.unitId,expectedRevision:d.expectedRevision,recipientId:Number(d.recipientId),method:d.method,
          scheduledDate:d.scheduledDate,plannedAmount:d.amount===''?null:Number(d.amount),
          periodStart:d.periodStart||null,periodEnd:d.periodEnd||null,note:d.note}
      })
      setResult(prepareOwnershipBillingPlan({projectId,oldOwnerId:oldOwner.id,newOwnerId:newOwner.id,units,choices}))
    }catch(e){setError(e instanceof Error?e.message:String(e))}
  }
  return <section className="card" style={{padding:20}}>
    <h2>所有者変更後の請求予定</h2>
    <p>{oldOwner.name} → {newOwner.name}</p>
    <p>各回の請求先・方法・時期を指定してください。初期値は今の予定のままです。日割り計算や請求の追加は自動では行いません。</p>
    <p>発行済み・入金済みなどの記録は変更対象外です。銀行への振替手配は行いません。</p>
    {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
    <form onSubmit={review}>
      {drafts.map((d,i)=>{const unit=units.find(u=>u.id===d.unitId)!;const failed=unit.collectionState==='failed'
        return <fieldset key={d.unitId} style={{marginBottom:16,padding:16,border:'1px solid #cbd5e1',borderRadius:8}}>
          <legend>{unit.serviceYear}年 {unit.roundLabel}</legend>
          {failed&&<p>振替不能の回です。元の請求先を維持し、請求書として残します。</p>}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
            <label>請求先<select className="form-input" value={d.recipientId} disabled={failed} onChange={e=>patch(i,'recipientId',e.target.value)}>
              <option value="">選択してください</option>{[oldOwner,newOwner].map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
            </select></label>
            <label>請求方法<select className="form-input" value={d.method} onChange={e=>patch(i,'method',e.target.value)}>
              <option>請求書</option>{!failed&&<option>口座振替</option>}
            </select></label>
            <label>請求・振替予定日<input className="form-input" type="date" required value={d.scheduledDate} onChange={e=>patch(i,'scheduledDate',e.target.value)}/></label>
            <label>予定額（税込）<input className="form-input" inputMode="numeric" value={d.amount} onChange={e=>patch(i,'amount',e.target.value)}/></label>
            <label>対象期間の開始（任意）<input className="form-input" type="date" value={d.periodStart} onChange={e=>patch(i,'periodStart',e.target.value)}/></label>
            <label>対象期間の終了（任意）<input className="form-input" type="date" value={d.periodEnd} onChange={e=>patch(i,'periodEnd',e.target.value)}/></label>
          </div>
          <label>備考<textarea className="form-input" value={d.note} onChange={e=>patch(i,'note',e.target.value)}/></label>
          <p>予定額の空欄は「金額要確認」です。0円とは区別します。</p>
        </fieldset>})}
      {!drafts.length&&<p>変更する予定はありません。新しい請求は自動作成しません。</p>}
      <button className="btn btn-main" type="submit">変更内容を確認（保存はしません）</button>
    </form>
    {result&&<section aria-label="請求予定の確認結果" style={{marginTop:20}}>
      <h3>変更内容の確認</h3><p role="status">入力チェック完了。DBには保存していません。</p>
      {result.changes.map(c=>{const u=units.find(u=>u.id===c.unitId)!;return <div key={c.unitId} style={{padding:'12px 0',borderBottom:'1px solid #e2e8f0'}}>
        <strong>{u.serviceYear}年 {u.roundLabel}</strong>
        <p>請求先：{ownerName(u.recipientId??0)} → {ownerName(c.recipientId)} ／ 方法：{u.method} → {c.method}</p>
        <p>予定日：{u.scheduledDate??'未設定'} → {c.scheduledDate} ／ 予定額：{u.plannedAmount==null?'金額要確認':`${u.plannedAmount.toLocaleString()}円`} → {c.plannedAmount===null?'金額要確認':`${c.plannedAmount.toLocaleString()}円`}</p>
        <p>対象期間：{c.periodStart?`${c.periodStart} ～ ${c.periodEnd}`:'未指定'} ／ 備考：{c.note||'なし'}</p>
      </div>})}
      <p>変更しない記録：{result.preservedUnitIds.length}件</p>
    </section>}
  </section>
}
