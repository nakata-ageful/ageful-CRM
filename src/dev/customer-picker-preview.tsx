import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {CustomerPicker} from '../components/CustomerPicker'
import {InvoicePlanEditor} from '../components/InvoicePlanEditor'
import type {BillingUnit} from '../lib/billing-unit'
import '../styles.css'

// Synthetic customers only; no Supabase or production writers.
const customers=[{id:1,name:'検証 太郎',name_kana:'ケンショウ タロウ',company_name:'株式会社検証エネルギー'},
  {id:2,name:'検証 太郎',name_kana:'ケンショウ タロウ',company_name:'株式会社テスト保守'},
  ...Array.from({length:30},(_,i)=>({id:i+3,name:`検索候補${i+1}`,company_name:'候補テスト株式会社'}))]
const unit:BillingUnit={id:'1',projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',scheduledDate:'2026-12-01',issuedOn:null,receivedOn:null,recipientId:1,lifecycle:'planned',frozenAmount:null,frozenAt:null,frozenLineItems:null,revision:4,plannedAmount:82500}
function Preview(){const [value,setValue]=useState(''),[notice,setNotice]=useState('')
  return <main style={{maxWidth:760,margin:'32px auto',padding:20}}><h1>顧客検索・隔離検証</h1><p>合成データのみ。本番DBに保存しません。</p>
    <CustomerPicker label="新しい所有者" value={value} customers={customers.filter(c=>c.id!==1)} onChange={setValue}/>
    <InvoicePlanEditor unit={unit} recipients={customers} onClose={()=>setNotice(previous=>previous||'編集を終了しました')} onSave={async request=>setNotice(JSON.stringify(request))}/>
    <p role="status">{notice}</p>
  </main>
}
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<Preview/>)
else document.getElementById('root')!.textContent='隔離検証モード専用です。'
