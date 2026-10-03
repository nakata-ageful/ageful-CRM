import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {ProjectManagementActions} from '../components/ProjectManagementActions'
import {BillingExceptionActions} from '../components/BillingExceptionActions'
import {OwnershipTransferHistory} from '../components/OwnershipTransferHistory'
import type {BillingRow,Contract,Customer} from '../types'
import type {TransferBillingUnit} from '../lib/ownership-billing-plan'
import type {ManagementEvent} from '../lib/management-lifecycle'
import {contractFieldKinds} from '../lib/ownership-field-selection'
import '../styles.css'

// Synthetic fixtures, local memory only. No auth, Supabase or production write functions.
const contract={...Object.fromEntries(Object.keys(contractFieldKinds).map(k=>[k,null])),id:1,project_id:1,billing_method:'請求書',billing_count:2,billing_schedule_days:['7月14日','1月14日'],maintenance_start_date:'2022-07-14',annual_maintenance_inc:165000} as unknown as Contract
const row={project_id:1,project_name:'検証発電所',contract,records:[]} as unknown as BillingRow
const customers=[{id:1,name:'検証顧客A',company_name:'検証エネルギー株式会社'},{id:2,name:'検証顧客B',company_name:null}] as Customer[]
const units:TransferBillingUnit[]=[{id:'1',projectId:1,serviceYear:2026,roundLabel:'第2回',method:'請求書',scheduledDate:'2027-01-14',issuedOn:null,receivedOn:null,lifecycle:'planned',recipientId:2,collectionState:'pending',recipientSource:'confirmed',plannedAmount:82500,frozenAmount:null,frozenLineItems:null,frozenAt:null,revision:4,periodStart:'2026-07-14',periodEnd:'2027-07-13'}]
const transfer={id:1,recorded_at:'2026-08-15T02:00:00Z',transfer_date:'2026-08-01',from_customer_id:1,to_customer_id:2,contract_before:contract,contract_after:{...contract,annual_maintenance_inc:180000},field_decisions:{reason:'売買のため所有者を変更。保守条件を確認。'}}
const before={id:1,service_year:2026,round_number:2,recipient_customer_id:1,collection_method:'invoice',planned_amount:82500,frozen_amount:null,scheduled_date:'2027-01-14',period_start:'2026-07-14',period_end:'2027-07-13',plan_note:'次回の請求先を確認'}
const event={id:1,billing_unit_id:1,recorded_at:'2026-09-25T02:00:00Z',event_type:'plan_changed',reason:'次回から新所有者へ請求することを確認',before_value:before,after_value:{...before,recipient_customer_id:2,planned_amount:0}}
function Preview(){
  const [tab,setTab]=useState('管理設定'),[notice,setNotice]=useState(''),[fail,setFail]=useState(false)
  const [events,setEvents]=useState<ManagementEvent[]>([{id:1,project_id:1,scope:'maintenance',action:'end',effective_date:'2025-08-15',reason:'一時休止'},{id:2,project_id:1,scope:'maintenance',action:'resume',effective_date:'2026-03-01',reason:'契約内容を確認し再開'}])
  const saved=async(value:unknown)=>{if(fail)throw Error('隔離検証：保存失敗。入力を保持して再確認してください。');setNotice(JSON.stringify(value))}
  return <div className="app"><aside className="sidebar"><div className="logo-block"><img className="logo-img" src="/logo.png" alt="Ageful"/><span className="logo-sub">隔離検証・合成データ</span></div>{['ダッシュボード','見込み管理','発電所','顧客','保守対応','請求'].map(label=><div key={label} className={`nav-btn ${label==='発電所'?'active':''}`}>{label}</div>)}</aside><main className="main">
    <h2 style={{fontSize:18,marginBottom:20}}>検証顧客B ／ 検証発電所</h2><div className="history-filters">{['管理設定','変更履歴'].map(name=><button key={name} type="button" aria-pressed={tab===name} onClick={()=>setTab(name)}>{name}</button>)}</div>
    {tab==='管理設定'?<div className="project-management-tab"><ProjectManagementActions projectId={1} row={row} customers={customers} units={units} events={events}
      onManagementSave={async request=>{await saved(request);setEvents(previous=>[...previous,{id:previous.length+1,project_id:1,scope:request.scope,action:request.action,effective_date:request.date,reason:request.reason}])}}
      onScheduleSave={saved} onPeriodSave={saved}/><BillingExceptionActions projectId={1} owner={customers[1]} recipients={customers} units={units} onAddDebit={saved} onSavePlan={async(choices,reason)=>saved({choices,reason})}/></div>
      :<div className="project-history-tab"><OwnershipTransferHistory transfers={[transfer]} events={[event]} managementEvents={events} recipientName={id=>customers.find(c=>c.id===id)?.name??`顧客ID ${id}`}/></div>}
    <div className="notice" style={{marginTop:16}}>合成データのみ。本番DBに保存しません。<label><input type="checkbox" checked={fail} onChange={e=>setFail(e.target.checked)}/>保存失敗を検証</label></div>
    {notice&&<p role="status" style={{overflowWrap:'anywhere',marginTop:12}}>{notice}</p>}
  </main></div>
}
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<Preview/>)
else document.getElementById('root')!.textContent='隔離検証モード専用です。'
