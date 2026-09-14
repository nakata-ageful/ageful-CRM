import {useState} from 'react'
import type {TransferBillingUnit} from '../lib/ownership-billing-plan'
import {managementActiveOn,validateManagementRequest,type ManagementEvent,type ManagementChoice,type ManagementRequest} from '../lib/management-lifecycle'
import {fmtYen} from '../lib/utils'
export function ManagementLifecycleEditor({projectId,events,units,onSave}:{projectId:number;events:readonly ManagementEvent[];units:readonly TransferBillingUnit[];onSave:(r:ManagementRequest)=>Promise<void>}){
 const [scope,setScope]=useState<ManagementRequest['scope']>('maintenance'),[action,setAction]=useState<ManagementRequest['action']>('end')
 const [date,setDate]=useState(''),[reason,setReason]=useState(''),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [plans]=useState(()=>units.filter(u=>u.projectId===projectId&&u.lifecycle==='planned').map(u=>({...u})))
 const [choices,setChoices]=useState<ManagementChoice[]>(()=>plans.map(u=>({unitId:u.id,expectedRevision:u.revision,action:'keep',amount:null})))
 const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
 const allActive=managementActiveOn(events,projectId,'all',today),maintenanceActive=managementActiveOn(events,projectId,'maintenance',today)
 const request:ManagementRequest={projectId,expectedLast:Math.max(0,...events.filter(e=>e.project_id===projectId).map(e=>e.id)),scope,action,date,choices,reason}
 function patch(i:number,c:Partial<ManagementChoice>){setChoices(rows=>rows.map((r,index)=>index===i?{...r,...c}:r));setReviewed(false)}
 return <section className="card"><h3 className="section-title">管理の終了・再開</h3>
   <p>現在：{!allActive?'全取引終了':!maintenanceActive?'保守終了（その他の費用は継続可）':'継続中'}</p>
   <details><summary>終了・再開を記録する</summary>
   <p>発電所・保守記録・過去の請求・未入金は削除しません。返金・残期間の精算や残作業は備考に記録してください。</p>
   <fieldset disabled={busy} onChange={()=>setReviewed(false)} style={{border:0,padding:0}}>
    <label>対象<select className="form-input" value={scope} onChange={e=>setScope(e.target.value as ManagementRequest['scope'])}><option value="maintenance">保守だけ</option><option value="all">すべての取引</option></select></label>
    <label>操作<select className="form-input" value={action} onChange={e=>setAction(e.target.value as ManagementRequest['action'])}><option value="end">終了する</option><option value="resume">再開する</option></select></label>
    <label>{action==='end'?'終了日（この日まで管理）':'再開日（この日から管理）'}<input className="form-input" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
    <p>終了の翌日から新しい予定の候補を停止します。保守だけの終了では土地代などは対象外にしません。全取引を再開しても、別に終了した保守は自動再開しません。</p>
    {action==='resume'&&<p>当初の保守開始日は書き換えず、再開日を履歴に残します。取りやめた予定の復活、空白期間の請求、日割り計算は行いません。前払いがあるため、初回請求日・金額は別途確認します。</p>}
    <h4>保存済みの予定をどうするか</h4><p>日付だけで判断せず、前払いの対象期間と土地代などの混在を確認してください。変更前の金額・請求先は履歴に残ります。</p>
    {plans.length===0&&<p>保存済みの未発行予定はありません。</p>}
    {plans.map((u,i)=><div key={u.id} style={{padding:10,borderBottom:'1px solid #ddd'}}>
      <p>{u.scheduledDate??'予定日未設定'} ／ {u.method} ／ 請求回ID {u.id} ／ {fmtYen(u.plannedAmount)}<br/>対象期間：{u.periodStart??'未設定'} ～ {u.periodEnd??'未設定'}</p>
      <label>この回の扱い<select className="form-input" value={choices[i].action} onChange={e=>patch(i,{action:e.target.value as ManagementChoice['action'],amount:null})}>
        <option value="keep">そのまま残す</option>{u.collectionState==='pending'&&<><option value="amount">予定額を変更して残す</option><option value="cancel">取りやめる（履歴は残す）</option></>}
      </select></label>
      {choices[i].action==='amount'&&<label>変更後の予定額（円）<input className="form-input" type="number" min="0" step="1" value={choices[i].amount??''} onChange={e=>patch(i,{amount:e.target.value===''?null:Number(e.target.value)})}/></label>}
    </div>)}
    <label>備考・確認内容（必須）<textarea className="form-input" value={reason} onChange={e=>setReason(e.target.value)}/></label>
    <button type="button" className="btn" onClick={()=>{try{validateManagementRequest(request,events,units);setError('');setReviewed(true)}catch(e){setError(e instanceof Error?e.message:String(e))}}}>内容を確認</button>
    {reviewed&&<div><p>{scope==='all'?'すべての取引':'保守だけ'}を{date}に{action==='end'?'終了':'再開'}します。</p>
      <p>そのまま：{choices.filter(c=>c.action==='keep').length}回 ／ 予定額変更：{choices.filter(c=>c.action==='amount').length}回 ／ 取りやめ：{choices.filter(c=>c.action==='cancel').length}回</p>
      {choices.filter(c=>c.action==='amount').map(c=><p key={c.unitId}>請求回ID {c.unitId}：{fmtYen(plans.find(u=>u.id===c.unitId)?.plannedAmount)} → {fmtYen(c.amount)}</p>)}
      <button type="button" className="btn btn-main" onClick={async()=>{if(busy)return;setBusy(true);try{validateManagementRequest(request,events,units);await onSave(request)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}}>確認した内容を一括保存</button>
    </div>}
   </fieldset></details>
   {error&&<p role="alert">{error}</p>}
   <details><summary>終了・再開の履歴（{events.length}件）</summary>{[...events].reverse().map(e=><p key={e.id}>{e.effective_date}：{e.scope==='all'?'全取引':'保守'}{e.action==='end'?'終了':'再開'} ／ {e.reason}</p>)}</details>
 </section>
}
