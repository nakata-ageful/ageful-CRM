import {useState} from 'react'
import type {BillingRow,Customer} from '../types'
import {managementActiveOn,type ManagementEvent,type ManagementRequest} from '../lib/management-lifecycle'
import type {TransferBillingUnit} from '../lib/ownership-billing-plan'
import {ManagementLifecycleEditor} from './ManagementLifecycleEditor'
import {FutureScheduleEditor} from './FutureScheduleEditor'
import {Modal} from './Modal'
import type {BillingCycleRule} from '../lib/billing-cycle'

export function ProjectManagementActions({projectId,row,customers,units,events,onManagementSave,onScheduleSave,onPeriodSave,cycleRules=[]}:{
  projectId:number;row?:BillingRow;customers:Customer[];units:TransferBillingUnit[];events:ManagementEvent[];
  onManagementSave:(request:ManagementRequest)=>Promise<void>;onScheduleSave:(value:Record<string,unknown>)=>Promise<unknown>;
  onPeriodSave?:(value:Record<string,unknown>)=>Promise<unknown>
  cycleRules?:readonly BillingCycleRule[]
}){
  const [editing,setEditing]=useState<'management'|'schedule'|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
  const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  const allActive=managementActiveOn(events,projectId,'all',today),maintenanceActive=managementActiveOn(events,projectId,'maintenance',today)
  const close=()=>{if(!busy)setEditing(null)}
  return <>
    <section className="card management-status"><h3 className="section-title">現在の管理状況</h3>
      {notice&&<p role="status" className="notice">{notice}</p>}
      <div className="management-status-grid"><div><span>すべての取引</span><strong className={allActive?'is-active':'is-ended'}>{allActive?'継続中':'終了'}</strong></div>
        <div><span>保守</span><strong className={allActive&&maintenanceActive?'is-active':'is-ended'}>{!allActive?'全取引終了により停止':maintenanceActive?'継続中':'終了'}</strong></div></div>
      <p>今日時点の状態です。終了・再開の記録は「変更履歴」で確認できます。</p>
    </section>
    <div className="management-action-grid">
      <section className="card management-action"><h3>管理の終了・再開</h3><p>保守だけ、またはすべての取引を終了・再開します。過去の請求や未入金は残ります。</p><button type="button" className="btn btn-sub" onClick={()=>setEditing('management')}>終了・再開を記録する</button></section>
      {row&&<section className="card management-action"><h3>今後の請求予定を追加</h3><p>保守期間と第何回かを確認して、まだ保存していない予定だけを追加します。</p><button type="button" className="btn btn-sub" onClick={()=>setEditing('schedule')}>請求予定を追加する</button></section>}
    </div>
    {editing&&<Modal title={editing==='management'?'管理の終了・再開':'今後の請求予定を追加'} width={820} onClose={close}><div className="standard-editor">
      {editing==='management'?<ManagementLifecycleEditor expanded key={`${projectId}:${JSON.stringify(events)}:${units.map(u=>`${u.id}:${u.revision}`).join(',')}`} projectId={projectId} events={events.filter(e=>e.project_id===projectId)} units={units}
        onSave={async request=>{setBusy(true);try{await onManagementSave(request);setNotice('管理の終了・再開を保存しました。');setEditing(null)}finally{setBusy(false)}}}/>
        :row&&<FutureScheduleEditor expanded key={`${row.project_id}:${JSON.stringify(units)}:${JSON.stringify(events)}:${JSON.stringify(row.contract)}:${JSON.stringify(cycleRules)}`} row={row} customers={customers} units={units} events={events} cycleRules={cycleRules}
          onSave={async value=>{setBusy(true);try{const result=await onScheduleSave(value);setNotice('確認した請求予定を追加しました。');setEditing(null);return result}finally{setBusy(false)}}}
          onPeriodSave={onPeriodSave?async value=>{setBusy(true);try{const result=await onPeriodSave(value);setNotice('保存済み記録の保守期間だけを保存しました。');setEditing(null);return result}finally{setBusy(false)}}:undefined}/>}
    </div></Modal>}
  </>
}
