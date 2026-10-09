import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import type {Contract} from '../types'
import type {BillingUnit} from '../lib/billing-unit'
import {routineInvoiceContext,type AddRoutineInvoice} from '../lib/routine-invoice'
import {BillingOverviewPanel} from '../components/BillingOverviewPanel'
import {InvoiceLedgerDetail} from '../components/InvoiceLedgerDetail'
import type {InvoiceWriteRequest} from '../lib/invoice-write-session'
import '../styles.css'

// Synthetic data and memory only. No Supabase, auth, business readers or writers.
const contract={id:1,project_id:1,maintenance_start_date:'2020-01-14',billing_method:'請求書',billing_count:2,billing_schedule_days:['6月1日','12月1日'],annual_maintenance_inc:165000} as Contract
const candidates=[{projectId:1,projectName:'通常発電所',customerName:'検証顧客A',recipientId:1,method:'invoice' as const,date:'2026-12-01',round:2,serviceYear:2026,periodStart:'2026-01-14',periodEnd:'2027-01-13',amount:82500,status:'missing' as const},
 {projectId:2,projectName:'期間要確認発電所',customerName:'検証顧客B',recipientId:2,method:'invoice' as const,date:'2026-12-01',round:1,amount:165000,status:'review' as const,reason:'保存済み記録との保守期間・回の対応を確認してください'}]
const first:BillingUnit={id:'1',projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',recipientId:1,lifecycle:'received',scheduledDate:'2026-06-01',issuedOn:'2026-06-02',receivedOn:'2026-06-20',frozenAmount:82500,frozenLineItems:[{name:'保守料',amount:82500}],frozenAt:'2026-06-02T00:00:00Z',revision:1,periodStart:'2026-01-14',periodEnd:'2027-01-13'}
function Preview(){
 const [units,setUnits]=useState<BillingUnit[]>([first]),[screen,setScreen]=useState('請求'),[fail,setFail]=useState(false),[notice,setNotice]=useState('')
 const data={units,recipients:[{id:1,name:'検証顧客A'},{id:2,name:'検証顧客B'}],recipientName:(id:number)=>id===1?'検証顧客A':'検証顧客B',projectName:(id:number)=>id===1?'通常発電所':'期間要確認発電所',plannedAmount:()=>null,managementEvents:[],ownershipChangedProjects:[]}
 const context=routineInvoiceContext(contract,{year:2026,round:2,date:'2026-12-01',periodStart:'2026-01-14',periodEnd:'2027-01-13',recipientId:1,amount:82500,method:'invoice'},data,'2026-10-09')
 const onAdd:AddRoutineInvoice=async(_context,item,reason)=>{
   const added:BillingUnit={id:String(Math.max(...units.map(u=>Number(u.id)))+1),projectId:1,serviceYear:item.year,roundLabel:`第${item.round}回`,method:'請求書',recipientId:item.recipientId,lifecycle:'planned',scheduledDate:item.date,issuedOn:null,receivedOn:null,frozenAmount:null,frozenLineItems:null,frozenAt:null,plannedAmount:item.amount,revision:0,periodStart:item.periodStart,periodEnd:item.periodEnd,planNote:reason}
   if(units.some(u=>u.serviceYear===item.year&&u.roundLabel===added.roundLabel))throw Error('二重追加はしません')
   setUnits(previous=>[...previous,added]);return added
 }
 const onSave=async(request:InvoiceWriteRequest)=>{
   if(fail)throw Error('隔離検証：発行の記録に失敗しました')
   const v=request.value as Record<string,unknown>
   setUnits(previous=>previous.map(unit=>{
     if(unit.id!==String(request.unitId))return unit
     if(unit.revision!==request.revision)throw Error('記録が更新されています')
     return request.mode==='collection'?{...unit,lifecycle:'received',receivedOn:String(v.received_on),revision:unit.revision+1}
       :{...unit,lifecycle:'issued',issuedOn:String(v.issued_on),paymentDueOn:v.payment_due_on as string|null,frozenAmount:Number(v.frozen_amount),frozenLineItems:v.frozen_line_items as BillingUnit['frozenLineItems'],frozenAt:'2026-12-02T00:00:00Z',revision:unit.revision+1}
   }));setNotice('隔離データに保存しました。本番DBは変更していません。')
 }
 return <div className="app"><aside className="sidebar"><div className="logo-block"><img className="logo-img" src="/logo.png" alt="Ageful"/><span className="logo-sub">隔離検証・合成データ</span></div>{['請求','請求詳細'].map(s=><button className={`nav-btn ${screen===s?'active':''}`} key={s} onClick={()=>setScreen(s)}>{s}</button>)}<button className="btn" onClick={()=>setFail(!fail)}>{fail?'保存失敗を解除':'保存失敗を試す'}</button></aside><main className="main">
 <p className="notice">検証専用：本番への接続なし。再読み込みで初期状態に戻ります。</p>
 {screen==='請求'?<BillingOverviewPanel data={data} today="2026-10-09" setupItems={units.length===1?candidates:candidates.slice(1)} routineInvoices={context?[context]:[]} onAddRoutine={onAdd} onSave={onSave} onViewDetail={()=>setScreen('請求詳細')}/>
  :<InvoiceLedgerDetail data={data} projectId={1} contract={contract} currentRecipientId={1} today="2026-10-09" maintenanceStartDate={contract.maintenance_start_date} onAddSchedule={async()=>{throw Error('検証画面では通常の発行だけをテストします')}} onAddRoutine={onAdd} onSave={onSave}/>}
 {notice&&<p role="status">{notice}</p>}</main></div>
}
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<Preview/> )
else document.getElementById('root')!.textContent='隔離検証モード専用です。'
