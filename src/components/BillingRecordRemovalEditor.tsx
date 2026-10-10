import {useRef,useState} from 'react'
import type {BillingUnit} from '../lib/billing-unit'
import {resolveUnitAmount} from '../lib/billing-unit'
import {billingRecordRemovalRequest,type BillingRecordRemovalRequest} from '../lib/billing-record-removal'
import {fmtYen} from '../lib/utils'

export function BillingRecordRemovalEditor({unit:initial,mode,recipientName,periodLabel,onSave,onClose,onBusyChange}:{
  unit:BillingUnit;mode:BillingRecordRemovalRequest['mode'];recipientName:(id:number)=>string;periodLabel:string
  onSave:(request:BillingRecordRemovalRequest)=>Promise<unknown>;onClose:()=>void;onBusyChange:(busy:boolean)=>void
}){
  const [unit]=useState(()=>structuredClone(initial)),[reason,setReason]=useState(''),[confirmed,setConfirmed]=useState(false)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false)
  const restore=mode==='restore',amount=resolveUnitAmount(unit).amount
  return <form className="billing-record-removal" onSubmit={async e=>{
    e.preventDefault();if(lock.current)return
    lock.current=true;setBusy(true);onBusyChange(true);setError('')
    try{await onSave(billingRecordRemovalRequest(unit,mode,reason,confirmed));onClose()}
    catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{lock.current=false;setBusy(false);onBusyChange(false)}
  }}>
    <p>{restore?'削除前と同じ請求先・金額・日付で、一覧と集計に戻します。現在の契約から再計算しません。':'このアプリの一覧・集計・請求CSVから、この1件だけを除外します。削除済み記録から復元できます。'}</p>
    <p className="billing-overview-notice">実際の請求書取消・返金・銀行処理は行いません。他の回の記録や「請求情報」の設定は変わりません。</p>
    <dl className="invoice-current-facts">
      <div><dt>請求先</dt><dd>{unit.recipientId==null?'要確認':recipientName(unit.recipientId)}</dd></div>
      <div><dt>請求金額</dt><dd>{amount==null?'金額要確認':fmtYen(amount)}</dd></div>
      <div className="invoice-period-fact"><dt>保守期間</dt><dd>{periodLabel}</dd></div>
      <div><dt>対象の回・記録ID</dt><dd>{unit.roundLabel} ／ ID {unit.id}</dd></div>
      <div><dt>請求方法</dt><dd>{unit.method}</dd></div>
      <div><dt>請求予定日</dt><dd>{unit.scheduledDate??'未登録'}</dd></div>
      <div><dt>請求日</dt><dd>{unit.issuedOn??'未登録'}</dd></div>
      <div><dt>入金予定日</dt><dd>{unit.paymentDueOn??'未登録'}</dd></div>
      <div><dt>入金日</dt><dd>{unit.receivedOn??'未登録'}</dd></div>
    </dl>
    {unit.frozenLineItems?.length? <div className="invoice-current-lines"><h3>保存されている明細</h3>{unit.frozenLineItems.map((i,n)=><div key={n}><span>{i.name}</span><strong>{fmtYen(i.amount)}</strong></div>)}</div>:null}
    {unit.planNote&&<p style={{whiteSpace:'pre-wrap'}}>この回の備考：{unit.planNote}</p>}
    {restore&&<p style={{whiteSpace:'pre-wrap'}}>削除理由：{unit.removalReason}</p>}
    <fieldset disabled={busy} style={{border:0,padding:0}}>
      <label>{restore?'復元理由':'削除理由'}<textarea autoFocus required maxLength={1000} className="form-input" value={reason} onChange={e=>setReason(e.target.value)} placeholder={restore?'例：削除した記録が正しかったため':'例：同じ請求を重複して登録したため'}/></label>
      <label className="record-removal-confirm"><input type="checkbox" required checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/><span>{restore?'この記録を一覧・集計に戻すことを確認しました':'保守期間・日付・金額を確認し、この1件を削除することを確認しました'}</span></label>
      {error&&<p role="alert">{error}</p>}
      {error&&<p>通信などで保存結果が不明な場合は、キャンセルで閉じ、画面上部の「保存結果を再確認」を押してください。その後、通常の履歴と「削除済みの記録」を確認してください。</p>}
      <div className="editor-footer"><button type="button" className="btn btn-sub" onClick={onClose}>キャンセル</button><button type="submit" className={restore?'btn btn-main':'btn btn-danger'} disabled={busy||!confirmed||!reason.trim()}>{busy?'保存中…':restore?'この記録を復元':'この記録を削除'}</button></div>
    </fieldset>
  </form>
}
