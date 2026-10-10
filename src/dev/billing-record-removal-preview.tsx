import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {InvoiceLedgerDetail} from '../components/InvoiceLedgerDetail'
import {BillingOverviewPanel} from '../components/BillingOverviewPanel'
import {billingRecordRemovalRequest,type BillingRecordRemovalRequest} from '../lib/billing-record-removal'
import type {BillingUnit} from '../lib/billing-unit'
import '../styles.css'

// Synthetic in-memory fixture only. No Supabase/Auth/data/actions imports.
const original:BillingUnit={id:'1',projectId:1,recipientId:1,serviceYear:2023,roundLabel:'第1回',method:'請求書',lifecycle:'received',scheduledDate:'2023-09-01',issuedOn:'2023-09-16',paymentDueOn:'2023-09-30',receivedOn:'2023-09-17',frozenAmount:187000,frozenLineItems:[{name:'保守料',amount:187000}],frozenAt:'2023-09-16T00:00:00Z',revision:0,periodStart:'2023-10-27',periodEnd:'2024-10-26',planNote:'検証用：追加した重複記録'}
const other={...original,id:'2',serviceYear:2024,periodStart:'2024-10-27',periodEnd:'2025-10-26',planNote:'検証用：元からあった記録'}
function Preview(){
 const [units,setUnits]=useState<BillingUnit[]>([original,other]),[fail,setFail]=useState(false)
 const save=async(r:BillingRecordRemovalRequest)=>{
  const u=units.find(u=>u.id===String(r.unitId))!
  billingRecordRemovalRequest(u,r.mode,r.reason,true)
  if(u.revision!==r.revision)throw Error('記録が更新されています')
  if(fail)throw Error('隔離検証：保存失敗。元の記録はそのままです。')
  setUnits(before=>before.map(u=>u.id===String(r.unitId)?{...u,removedAt:r.mode==='remove'?'2026-10-10T00:00:00Z':null,removalReason:r.mode==='remove'?r.reason:null,revision:u.revision+1}:u))
 }
 const data={units,recordRemovalReady:true,recipients:[{id:1,name:'検証顧客'}],recipientName:()=> '検証顧客',projectName:()=> '検証発電所',plannedAmount:()=>null}
 return <div className="app"><aside className="sidebar"><div className="logo-block"><img className="logo-img" src="/logo.png" alt="Ageful"/><span className="logo-sub">合成データ・隔離検証</span></div><button className="btn" onClick={()=>setFail(!fail)}>{fail?'保存失敗を解除':'保存失敗を試す'}</button></aside><main className="main"><p className="notice">検証専用。本番データには接続しません。再読み込みで初期状態に戻ります。</p>
  <InvoiceLedgerDetail data={data} projectId={1} maintenanceStartDate="2023-10-27" onSave={async()=>{throw Error('検証画面は削除・復元のみ')}} onRecordRemoval={save}/>
  <BillingOverviewPanel data={data} today="2026-10-10"/>
 </main></div>
}
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<Preview/>)
else document.getElementById('root')!.textContent='隔離検証モード専用です。'
