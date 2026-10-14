import {useState} from 'react'
import {scheduleDateRequest,type ScheduleDateReview} from '../lib/billing-schedule-change'
import type {InvoiceWriteRequest} from '../lib/invoice-write-session'
import {fmtYen} from '../lib/utils'
import './BillingScheduleChangeReview.css'

export function BillingScheduleChangeReview({review,name,recipientName,busy,onSave,onBack}:{review:ScheduleDateReview;name:string;recipientName:(id:number)=>string;busy:boolean;onSave:(requests:InvoiceWriteRequest[])=>void;onBack:()=>void}){
  const [selected,setSelected]=useState<string[]>([])
  return <section className="schedule-change-review" aria-label="保存済み請求予定の変更確認">
    <h3>保存済みの未発行予定も変更しますか？</h3><p>{name}の「請求情報」の変更とあわせて、変更する予定にチェックしてください。</p>
    <p className="notice">金額・請求先・保守期間・入金予定日は変更しません。発行済み・入金済みの記録も変更しません。</p>
    <fieldset disabled={busy}>
      {review.changes.map(c=><label className="schedule-change-row" key={c.unit.id}><input type="checkbox" checked={selected.includes(c.unit.id)} onChange={e=>setSelected(s=>e.target.checked?[...s,c.unit.id]:s.filter(id=>id!==c.unit.id))}/><span><strong>{c.unit.serviceYear}年・{c.unit.roundLabel}</strong><span>{c.period}</span><span className="schedule-change-dates">{c.unit.scheduledDate} → <b>{c.date}</b></span><span>{c.unit.plannedAmount==null?'金額要確認':fmtYen(c.unit.plannedAmount)} ／ {c.unit.recipientId==null?'請求先要確認':recipientName(c.unit.recipientId)}</span></span></label>)}
      {!review.changes.length&&<p>基本設定から安全に対応付けられる保存済み予定はありません。</p>}
      {!!review.manual.length&&<div className="schedule-change-manual"><h4>「請求詳細」で個別確認する予定（{review.manual.length}件）</h4><p>個別の日付・期間、期限を過ぎた予定、繰り返し設定などがあるため、自動では変更しません。</p>{review.manual.map(u=><p key={u.id}>{u.serviceYear}年・{u.roundLabel} ／ {u.scheduledDate??'予定日未登録'}</p>)}</div>}
      {review.notice&&<p role="status">{review.notice}</p>}
      <p>チェックしない予定・個別確認の予定・その他の記録はそのまま残します。今後新しく作る予定には基本設定を使います。「前年12月1日請求」の繰り返し設定がある場合は、その設定が優先されます。</p>
      <div className="schedule-change-buttons"><button type="button" className="btn btn-sub" onClick={onBack}>編集に戻る</button><button type="button" className="btn btn-sub" onClick={()=>onSave([])}>請求情報だけ保存</button><button type="button" className="btn btn-main" disabled={!selected.length} onClick={()=>onSave(review.changes.filter(c=>selected.includes(c.unit.id)).map(scheduleDateRequest))}>{busy?'保存中…':`選択した${selected.length}件も変更して保存`}</button></div>
    </fieldset>
  </section>
}
