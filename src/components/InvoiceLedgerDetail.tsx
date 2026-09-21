import { useState } from 'react'
import { BillingHistorySection,type BillingHistoryData } from './BillingHistorySection'
import { InvoiceUnitEditor } from './InvoiceUnitEditor'
import { isEditableInvoicePlan } from '../lib/billing-unit'
import type { InvoiceWriteRequest } from '../lib/invoice-write-session'
import { InvoicePlanEditor } from './InvoicePlanEditor'
import { ManualDebitEditor } from './ManualDebitEditor'
import {InvoiceCorrectionEditor} from './InvoiceCorrectionEditor'

export function InvoiceLedgerDetail({data,projectId,onSave}:{data:BillingHistoryData;projectId:number;onSave?:(request:InvoiceWriteRequest)=>Promise<unknown>}) {
  const [selected,setSelected]=useState<string|null>(null)
  const [editingPlan,setEditingPlan]=useState(false)
  const [correcting,setCorrecting]=useState(false)
  const units=data.units.filter(u=>u.projectId===projectId)
  const unit=units.find(u=>u.id===selected)
  return <section className="invoice-ledger-detail"><BillingHistorySection data={data} projectId={projectId}/>
    {onSave&&units.length>0&&<div className="invoice-ledger-actions-title"><div><h3>この発電所の操作</h3><p>変更する回を選んでください。保存済みの別の回は変更しません。</p></div></div>}
    <div className="invoice-ledger-actions">
    {onSave&&data.recipients&&units.filter(u=>u.method==='請求書'&&['issued','received'].includes(u.lifecycle)).map(u=><button className="btn" key={`correct-invoice-${u.id}`} disabled={selected!==null} onClick={()=>{setCorrecting(true);setSelected(u.id)}}>{u.serviceYear}年 {u.roundLabel}：請求・入金記録を訂正</button>)}
    {onSave&&units.filter(u=>u.method==='口座振替'&&u.lifecycle==='received').map(u=><button key={`correct-${u.id}`} type="button" className="btn" disabled={selected!==null} onClick={()=>{setEditingPlan(false);setSelected(u.id)}}>{u.serviceYear}年 {u.roundLabel}：振替記録を訂正</button>)}
    {onSave&&units.filter(u=>u.method==='口座振替'&&u.lifecycle==='planned'&&!u.receivedOn&&u.frozenAmount===null).map(u=>
      <button key={`debit-${u.id}`} type="button" className="btn" disabled={selected!==null} onClick={()=>{setEditingPlan(false);setSelected(u.id)}}>{u.serviceYear}年 {u.roundLabel}：振替結果を記録</button>)}
    {onSave&&data.recipients&&units.filter(isEditableInvoicePlan).map(u=><button type="button" className="btn" key={`plan-${u.id}`} disabled={selected!==null}
      onClick={()=>{setEditingPlan(true);setSelected(u.id)}}>{u.serviceYear}年 {u.roundLabel}：予定を編集</button>)}
    {onSave&&units.filter(u=>isEditableInvoicePlan(u)||(u.method==='請求書'&&u.lifecycle==='issued'&&!u.receivedOn)).map(u=>
      <button key={u.id} type="button" className="btn" disabled={selected!==null} onClick={()=>{setEditingPlan(false);setSelected(u.id)}}>
        {u.serviceYear}年 {u.roundLabel}：{u.lifecycle==='planned'?'発行':'入金確認'}
      </button>)}
    </div>{unit&&onSave&&(correcting&&data.recipients?<InvoiceCorrectionEditor key={`correction-${unit.id}`} unit={unit} recipients={data.recipients} onSave={onSave} onClose={()=>{setSelected(null);setCorrecting(false)}}/>
      :unit.method==='口座振替'?<ManualDebitEditor key={`debit-${unit.id}`} unit={unit} recipientName={data.recipientName} onSave={onSave} onClose={()=>setSelected(null)}/>
      :editingPlan&&data.recipients?<InvoicePlanEditor key={`plan-${unit.id}`} unit={unit} recipients={data.recipients} onSave={onSave} onClose={()=>setSelected(null)}/>
      :<InvoiceUnitEditor key={unit.id} unit={unit} recipientName={data.recipientName} onSave={onSave} onClose={()=>setSelected(null)}/>)}
  </section>
}
