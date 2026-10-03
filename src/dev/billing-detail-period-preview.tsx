import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {InvoiceLedgerDetail} from '../components/InvoiceLedgerDetail'
import type {Contract} from '../types'
import type {BillingUnit} from '../lib/billing-unit'
import {contractFieldKinds} from '../lib/ownership-field-selection'
import '../styles.css'

// Synthetic fixtures only. No Supabase, real actions, auth, backup data or external persistence.
const blank=Object.fromEntries(Object.keys(contractFieldKinds).map(key=>[key,null])) as unknown as Contract
const bank:Contract={...blank,id:1,project_id:1,billing_method:'口座振替',billing_count:null,billing_schedule_days:['25日'],maintenance_start_date:'2025-01-01',
 annual_maintenance_inc:237600,land_cost_monthly:120000,billing_item_flags:{annual_maintenance:false},has_transfer_fee:true,transfer_fee_inc:110,notes:'検証用の備考'}
const paper={...bank,billing_method:'請求書',billing_count:2,billing_schedule_days:['7月14日','1月14日'],maintenance_start_date:'2022-07-14'}
const first:BillingUnit={id:'1',projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',scheduledDate:'2025-12-01',issuedOn:'2025-12-02',receivedOn:'2025-12-20',paymentDueOn:'2025-12-31',recipientId:1,lifecycle:'received',frozenAmount:82500,frozenLineItems:[{name:'保守料',amount:82500}],frozenAt:'2025-12-02T00:00:00Z',plannedAmount:null,revision:1,periodStart:'2026-07-14',periodEnd:'2027-07-13'}
const second:BillingUnit={...first,id:'2',roundLabel:'第2回',scheduledDate:'2027-01-14',issuedOn:null,receivedOn:null,paymentDueOn:null,lifecycle:'planned',frozenAmount:null,frozenLineItems:null,frozenAt:null,plannedAmount:82500,recipientId:2}
function Preview(){
 const [mode,setMode]=useState('bank'),[units,setUnits]=useState<BillingUnit[]>([])
 const [notice,setNotice]=useState(''),contract=mode==='bank'?bank:paper
 return <main style={{padding:24,maxWidth:1260,margin:'auto'}}><div className="notice">隔離検証：合成データのみ。保存操作はこのページのメモリーだけに反映します。本番DBへの接続はありません。</div>
   <div style={{display:'flex',gap:12,marginBottom:20}}><button className="btn" onClick={()=>{setMode('bank');setUnits([]);setNotice('')}}>口座振替・未登録</button><button className="btn" onClick={()=>{setMode('paper');setUnits([first,second]);setNotice('')}}>請求書・期間内2回</button></div>
   <h2 style={{marginBottom:20}}>検証発電所 ／ 請求詳細</h2>
   <InvoiceLedgerDetail key={mode} projectId={1} contract={contract} currentRecipientId={1} maintenanceStartDate={contract.maintenance_start_date} today="2026-10-03"
     data={{units,recipientName:id=>id===1?'検証顧客A':'検証顧客B',projectName:()=> '検証発電所',plannedAmount:()=>null,recipients:[{id:1,name:'検証顧客A'},{id:2,name:'検証顧客B'}]}}
     onAddSchedule={async(item,reason)=>{const id=String(Math.max(0,...units.map(u=>Number(u.id)))+1);setUnits([...units,{id,projectId:1,serviceYear:item.year,roundLabel:`第${item.round}回`,method:item.method==='invoice'?'請求書':'口座振替',scheduledDate:item.date,recipientId:item.recipientId,lifecycle:'planned',issuedOn:null,receivedOn:null,frozenAmount:null,frozenLineItems:null,frozenAt:null,plannedAmount:item.amount,periodStart:item.periodStart,periodEnd:item.periodEnd,revision:0,planNote:reason}]);setNotice('1回分の予定を隔離データに追加しました。')}}
     onSave={async request=>{setUnits(units.map(u=>{if(u.id!==String(request.unitId))return u;const v=request.value as Record<string,unknown>;setNotice('隔離データに保存しました。');
       if(request.mode==='collection')return {...u,lifecycle:'received',receivedOn:String(v.received_on),revision:u.revision+1}
       if(request.mode==='debit_received')return {...u,lifecycle:'received',receivedOn:String(v.received_on),frozenAmount:Number(v.amount),frozenLineItems:v.line_items as BillingUnit['frozenLineItems'],frozenAt:new Date().toISOString(),revision:u.revision+1}
       if(request.mode==='issue')return {...u,lifecycle:'issued',issuedOn:String(v.issued_on),paymentDueOn:v.payment_due_on as string|null,frozenAmount:Number(v.frozen_amount),frozenLineItems:v.frozen_line_items as BillingUnit['frozenLineItems'],frozenAt:new Date().toISOString(),revision:u.revision+1}
       throw Error('この隔離プレビューの未対応操作です')
     }))}}
   />
   {notice&&<p role="status" className="notice" style={{marginTop:16}}>{notice}</p>}
 </main>
}
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<Preview/>)
else document.getElementById('root')!.textContent='隔離検証モード専用です。'
