import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BillingOverviewPanel } from '../components/BillingOverviewPanel'
import type { BillingUnit } from '../lib/billing-unit'
import '../styles.css'

// Synthetic fixtures, local memory only. No Supabase, auth, runtime writer or business data imports.
const first: BillingUnit = {id:'1',projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',scheduledDate:'2026-07-01',issuedOn:'2026-07-15',paymentDueOn:'2026-08-01',receivedOn:null,recipientId:1,lifecycle:'issued',frozenAmount:82500,frozenLineItems:[{name:'保守料',amount:82500}],frozenAt:'2026-07-15T00:00:00Z',revision:1,periodStart:'2026-07-14',periodEnd:'2027-07-13'}
const second: BillingUnit = {...first,id:'2',roundLabel:'第2回',scheduledDate:'2026-12-01',issuedOn:null,paymentDueOn:null,recipientId:2,lifecycle:'planned',frozenAmount:null,frozenLineItems:null,frozenAt:null,plannedAmount:82500}
function Preview(){
 const [units,setUnits]=useState<BillingUnit[]>([first,second,{...first,id:'3',projectId:3,lifecycle:'received',receivedOn:'2026-09-20'},{...first,id:'4',projectId:4,frozenAmount:null,frozenLineItems:null}])
 const [notice,setNotice]=useState('')
 return <div className="app"><aside className="sidebar"><div className="logo-block"><img className="logo-img" src="/logo.png" alt="Ageful"/><span className="logo-sub">隔離検証・合成データ</span></div>{['ダッシュボード','見込み管理','発電所','顧客','保守対応','請求'].map(label=><div key={label} className={`nav-btn ${label==='請求'?'active':''}`}>{label}</div>)}</aside><main className="main">
   <BillingOverviewPanel today="2026-10-03" data={{units,recipientName:id=>id===1?'検証顧客A':'検証顧客B',projectName:id=>`検証発電所${id}`,plannedAmount:()=>null,recipients:[{id:1,name:'検証顧客A'},{id:2,name:'検証顧客B'}]}}
    setupItems={Array.from({length:12},(_,i)=>({projectId:10+i,projectName:`未保存発電所${i+1}`,customerName:'検証顧客C',recipientId:3,method:'invoice',date:'2026-12-01',round:1,amount:165000,status:'missing'}))}
    debitProjects={[{projectId:30,projectName:'検証振替発電所',customerName:'検証顧客D',days:'25日',amount:10110}]}
    setupIssues={[{projectId:40,projectName:'要設定発電所',category:'action_required',code:'other',reason:'予定日未設定'}]}
    onViewDetail={id=>setNotice(`詳細の遷移先：検証発電所${id}。本番データは使用していません。`)}
    onSave={async request=>{setUnits(previous=>previous.map(unit=>{
      if(unit.id!==String(request.unitId))return unit
      if(unit.revision!==request.revision)throw Error('情報が更新されています')
      const value=request.value as Record<string,unknown>
      if(request.mode==='collection')return {...unit,lifecycle:'received',receivedOn:String(value.received_on),revision:unit.revision+1}
      if(request.mode==='issue')return {...unit,lifecycle:'issued',issuedOn:String(value.issued_on),paymentDueOn:value.payment_due_on as string|null,frozenAmount:Number(value.frozen_amount),frozenLineItems:value.frozen_line_items as BillingUnit['frozenLineItems'],frozenAt:new Date().toISOString(),revision:unit.revision+1}
      throw Error('隔離プレビューの未対応操作です')
    }));setNotice('隔離データのみ更新しました。本番DBには保存していません。')}}/>
   {notice&&<p className="notice" role="status" style={{marginTop:16}}>{notice}</p>}
 </main></div>
}
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<Preview/>)
else document.getElementById('root')!.textContent='隔離検証モード専用です。'
