import {useState} from 'react'
import {isBillingDate} from '../lib/billing-unit'
import {scheduleDateRequest,type ScheduleDateReview} from '../lib/billing-schedule-change'
import type {InvoiceWriteRequest} from '../lib/invoice-write-session'
import {fmtYen} from '../lib/utils'
import './BillingScheduleChangeReview.css'

export function BillingScheduleChangeReview({review,name,recipientName,busy,onSave,onBack}:{review:ScheduleDateReview;name:string;recipientName:(id:number)=>string;busy:boolean;onSave:(requests:InvoiceWriteRequest[])=>void;onBack:()=>void}){
  const [selected,setSelected]=useState<string[]>([])
  const [dates,setDates]=useState<Record<string,string>>({}),[error,setError]=useState('')
  const editable=review.editable??[]
  const choices=[...review.changes,...editable.map(c=>({...c,date:dates[c.unit.id]??''}))].filter(c=>selected.includes(c.unit.id))
  const invalid=choices.some(c=>!isBillingDate(c.date)||c.date===c.unit.scheduledDate||!!c.unit.paymentDueOn&&c.unit.paymentDueOn<c.date)
  function saveSelected(){try{setError('');onSave(choices.map(scheduleDateRequest))}catch(e){setError(e instanceof Error?e.message:String(e))}}
  return <section className="schedule-change-review" aria-label="保存済み請求予定の変更確認">
    <h3>保存済みの未発行予定も変更しますか？</h3><p>{name}の変更する回にチェックしてください。日付が違う・未登録の回も、ここで日付を入力して修正できます。</p>
    <p className="notice">金額・請求先・保守期間・入金予定日は変更しません。発行済み・入金済みの記録も変更しません。ここで個別の日付を入力しても、毎年の基本設定・繰り返し設定は自動では入りません。</p>
    <fieldset disabled={busy}>
      {error&&<p role="alert" className="form-error">{error}</p>}
      {review.changes.map(c=><label className="schedule-change-row" key={c.unit.id}><input type="checkbox" checked={selected.includes(c.unit.id)} onChange={e=>setSelected(s=>e.target.checked?[...s,c.unit.id]:s.filter(id=>id!==c.unit.id))}/><span><strong>{c.unit.serviceYear}年・{c.unit.roundLabel}</strong><span>{c.period}</span><span className="schedule-change-dates">{c.unit.scheduledDate} → <b>{c.date}</b></span><span>{c.unit.plannedAmount==null?'金額要確認':fmtYen(c.unit.plannedAmount)} ／ {c.unit.recipientId==null?'請求先要確認':recipientName(c.unit.recipientId)}</span></span></label>)}
      {!!editable.length&&<div className="schedule-change-manual"><h4>日付を確認して修正する予定（{editable.length}件）</h4><p>変更したい回にチェックして、「変更後の請求予定日」を入力してください。この回だけの変更です。</p>{editable.map(c=>{const checked=selected.includes(c.unit.id),date=dates[c.unit.id]??'';return <section className="schedule-change-editable" key={c.unit.id}>
        <label className="schedule-change-row"><input type="checkbox" checked={checked} onChange={e=>setSelected(s=>e.target.checked?[...s,c.unit.id]:s.filter(id=>id!==c.unit.id))}/><span><strong>{c.unit.serviceYear}年・{c.unit.roundLabel}</strong><span>{c.period}</span><span>現在の請求予定日：{c.unit.scheduledDate||'未登録'}</span><span>{c.unit.plannedAmount==null?'金額要確認':fmtYen(c.unit.plannedAmount)} ／ {c.unit.recipientId==null?'請求先要確認':recipientName(c.unit.recipientId)}</span><span>{c.reason}</span></span></label>
        <label className="schedule-change-date-label">変更後の請求予定日<input className="form-input" type="date" aria-label={`${c.unit.serviceYear}年・${c.unit.roundLabel}（記録${c.unit.id}）の変更後の請求予定日`} disabled={!checked} value={date} onChange={e=>setDates(d=>({...d,[c.unit.id]:e.target.value}))}/></label>
        {checked&&<p className="schedule-change-dates">{c.unit.scheduledDate||'未登録'} → <b>{date||'日付を入力してください'}</b></p>}
        {checked&&date===c.unit.scheduledDate&&<p role="alert">現在と同じ日付です。変更しない回はチェックを外してください。</p>}
        {checked&&date&&c.unit.paymentDueOn&&date>c.unit.paymentDueOn&&<p role="alert">入金予定日（{c.unit.paymentDueOn}）より後の日付です。「請求詳細」で入金予定日も確認してください。</p>}
        {checked&&isBillingDate(date)&&date<new Date().toLocaleDateString('sv-SE')&&<p>過去の日付の未発行予定として保存します。発行済みにはならず、期限を過ぎた予定として確認対象になります。</p>}
      </section>})}</div>}
      {!review.changes.length&&!editable.length&&<p>この画面で変更する未発行の請求予定はありません。</p>}
      {!!review.manual.length&&<div className="schedule-change-manual"><h4>この画面では変更しない予定（{review.manual.length}件）</h4><p>口座振替や状態の確認が必要な記録は「請求詳細」で確認してください。</p>{review.manual.map(u=><p key={u.id}>{u.serviceYear}年・{u.roundLabel} ／ {u.scheduledDate??'予定日未登録'}</p>)}</div>}
      {review.notice&&<p role="status">{review.notice}</p>}
      <p>チェックしない予定・その他の記録はそのまま残します。今後新しく作る予定には基本設定を使います。「前年12月1日請求」の繰り返し設定がある場合は、その設定が優先されます。</p>
      <div className="schedule-change-buttons"><button type="button" className="btn btn-sub" onClick={onBack}>編集に戻る</button><button type="button" className="btn btn-sub" onClick={()=>onSave([])}>請求情報だけ保存</button><button type="button" className="btn btn-main" disabled={!selected.length||invalid} onClick={saveSelected}>{busy?'保存中…':`選択した${selected.length}件も変更して保存`}</button></div>
    </fieldset>
  </section>
}
