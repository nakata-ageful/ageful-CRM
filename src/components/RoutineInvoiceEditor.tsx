import {useRef,useState} from 'react'
import {CustomerPicker} from './CustomerPicker'
import type {CustomerChoice} from '../lib/customer-search'
import {isBillingDate,type BillingUnit} from '../lib/billing-unit'
import type {InvoiceWriteRequest} from '../lib/invoice-write-session'
import {exactRoutinePlan,type AddRoutineInvoice,type RoutineInvoiceContext} from '../lib/routine-invoice'
import {fmtYen} from '../lib/utils'

/** One operator form, using the existing durable writers. A partial success remains
 * a visible unissued plan; retries use that exact unit instead of creating another.
 */
export function RoutineInvoiceEditor({context,recipients,onAdd,onSave,onClose,onBusyChange}:{
  context:RoutineInvoiceContext;recipients:readonly CustomerChoice[];onAdd:AddRoutineInvoice
  onSave:(request:InvoiceWriteRequest)=>Promise<unknown>;onClose:()=>void
  onBusyChange?:(busy:boolean)=>void
}){
  const [snapshot]=useState(()=>structuredClone(context)),item=snapshot.item
  const [payer,setPayer]=useState(String(item.recipientId)),[date,setDate]=useState(''),[due,setDue]=useState('')
  const [items,setItems]=useState([{name:'保守料',amount:''}]),[note,setNote]=useState('')
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[prepared,setPrepared]=useState<BillingUnit|null>(null)
  const [blocked,setBlocked]=useState(false)
  const lock=useRef(false),created=useRef<BillingUnit|null>(null)
  async function save(e:React.FormEvent){
    e.preventDefault();if(lock.current||blocked)return;lock.current=true;setBusy(true);onBusyChange?.(true);setError('')
    try{
      const recipientId=Number(payer),lines=items.map(i=>({name:i.name.trim(),amount:Number(i.amount)}))
      if(!payer||!recipients.some(r=>r.id===recipientId)||!isBillingDate(date)||(due&&!isBillingDate(due)))throw Error('請求先・請求日・入金予定日を確認してください')
      if(items.some(i=>!/^\d+$/.test(i.amount))||lines.some(i=>!i.name||!Number.isSafeInteger(i.amount)))throw Error('明細名と0円以上の整数を入力してください')
      const amount=lines.reduce((sum,i)=>sum+i.amount,0)
      if(!Number.isSafeInteger(amount))throw Error('請求金額を確認してください')
      const selected={...item,recipientId}
      if(!created.current){
        const unit=await onAdd(snapshot,selected,`通常請求の発行内容を確認して記録${note.trim()?'：'+note.trim():''}`)
        if(!exactRoutinePlan(unit,snapshot,selected))throw Object.assign(new Error('保存した予定の対応を確認できません。「保存結果を再確認」または請求詳細で確認してください。新しい予定は追加しないでください'),{code:'PLAN_CORRESPONDENCE'})
        created.current=unit;setPrepared(unit)
      }
      const unit=created.current
      await onSave({unitId:Number(unit.id),revision:unit.revision,mode:'issue',value:{recipient_customer_id:unit.recipientId,
        scheduled_date:unit.scheduledDate,issued_on:date,received_on:null,payment_due_on:due||null,
        frozen_amount:amount,frozen_line_items:lines},reason:null})
      onClose()
    }catch(e){if(e&&typeof e==='object'&&'code'in e&&e.code==='PLAN_CORRESPONDENCE')setBlocked(true);setError(e instanceof Error?e.message:String(e))}finally{lock.current=false;setBusy(false);onBusyChange?.(false)}
  }
  return <section>
    <p>別途発行した請求書の内容を記録します。このアプリから請求書の作成・送信は行いません。</p>
    <dl className="invoice-current-facts"><div><dt>保守期間</dt><dd>{item.periodStart} ～ {item.periodEnd}</dd></div>
      <div><dt>対象の回</dt><dd>第{item.round}回</dd></div><div><dt>請求予定日</dt><dd>{item.date}</dd></div></dl>
    <p>契約からの参考額：{fmtYen(item.amount!)}。実際の請求明細を入力してください。</p>
    <p>期間・予定日を変更する場合は、キャンセルして「請求詳細」で予定を調整してください。</p>
    {prepared&&<p role="status">請求予定は保存済みです。発行の記録が未完了の場合は、この画面で再試行してください。閉じても未発行の予定は残ります。</p>}
    {error&&<><p role="alert">{error}</p><p>「保存結果が未確認」と表示された場合は、入力を変えず、いったんキャンセルで閉じて画面上部の「保存結果を再確認」を押してください。確認後は一覧に戻り、その記録の状態を確認してください。</p></>}
    <form onSubmit={save}><fieldset disabled={busy} style={{border:0,padding:0}}>
      <CustomerPicker label="請求先" value={payer} customers={recipients} onChange={setPayer} disabled={!!prepared}/>
      <label>請求日<input type="date" required value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label>入金予定日<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>
      {items.map((line,index)=><div className="editor-line-item" key={index}>
        <label>明細名<input required value={line.name} onChange={e=>setItems(items.map((v,i)=>i===index?{...v,name:e.target.value}:v))}/></label>
        <label>金額（税込）<input required inputMode="numeric" value={line.amount} onChange={e=>setItems(items.map((v,i)=>i===index?{...v,amount:e.target.value}:v))}/></label>
        {items.length>1&&<button type="button" onClick={()=>setItems(items.filter((_,i)=>i!==index))}>削除</button>}
      </div>)}
      <button type="button" onClick={()=>setItems([...items,{name:'',amount:''}])}>明細を追加</button>
      <label>備考（任意）<textarea value={note} disabled={!!prepared} onChange={e=>setNote(e.target.value)}/></label>
      <div className="editor-footer"><button type="button" className="btn btn-sub" onClick={onClose}>キャンセル</button>
        <button type="submit" className="btn btn-main" disabled={blocked}>{busy?'保存中…':prepared?'発行内容の保存を再試行':'発行内容を保存'}</button></div>
    </fieldset></form>
  </section>
}
