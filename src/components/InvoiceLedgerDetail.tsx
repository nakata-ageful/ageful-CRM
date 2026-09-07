import { useState } from 'react'
import { BillingHistorySection,type BillingHistoryData } from './BillingHistorySection'
import { InvoiceUnitEditor } from './InvoiceUnitEditor'
import { isEditableInvoicePlan } from '../lib/billing-unit'
import type { InvoiceWriteRequest } from '../lib/invoice-write-session'

export function InvoiceLedgerDetail({data,projectId,onSave}:{data:BillingHistoryData;projectId:number;onSave?:(request:InvoiceWriteRequest)=>Promise<unknown>}) {
  const [selected,setSelected]=useState<string|null>(null)
  const units=data.units.filter(u=>u.projectId===projectId)
  const unit=units.find(u=>u.id===selected)
  return <><BillingHistorySection data={data} projectId={projectId}/>
    {onSave&&units.filter(u=>isEditableInvoicePlan(u)||(u.method==='請求書'&&u.lifecycle==='issued'&&!u.receivedOn)).map(u=>
      <button key={u.id} type="button" className="btn" disabled={selected!==null} onClick={()=>setSelected(u.id)}>
        {u.serviceYear}年 {u.roundLabel}：{u.lifecycle==='planned'?'発行':'入金確認'}
      </button>)}
    {unit&&onSave&&<InvoiceUnitEditor key={unit.id} unit={unit} recipientName={data.recipientName} onSave={onSave} onClose={()=>setSelected(null)}/>}
  </>
}
