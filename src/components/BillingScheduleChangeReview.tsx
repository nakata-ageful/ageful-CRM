import {useState} from 'react'
import {isBillingDate} from '../lib/billing-unit'
import {scheduleDateRequest,type ScheduleDateReview} from '../lib/billing-schedule-change'
import type {InvoiceWriteRequest} from '../lib/invoice-write-session'
import {fmtYen} from '../lib/utils'
import {HelpNote} from './HelpNote'
import './BillingScheduleChangeReview.css'

export function BillingScheduleChangeReview({review,name,recipientName,busy,onSave,onBack}:{review:ScheduleDateReview;name:string;recipientName:(id:number)=>string;busy:boolean;onSave:(requests:InvoiceWriteRequest[])=>void;onBack:()=>void}){
  const [selected,setSelected]=useState<string[]>([])
  const [dates,setDates]=useState<Record<string,string>>({}),[error,setError]=useState('')
  const editable=review.editable??[]
  const choices=[...review.changes,...editable.map(c=>({...c,date:dates[c.unit.id]??''}))].filter(c=>selected.includes(c.unit.id))
  const invalid=choices.some(c=>!isBillingDate(c.date)||c.date===c.unit.scheduledDate||!!c.unit.paymentDueOn&&c.unit.paymentDueOn<c.date)
  function saveSelected(){try{setError('');onSave(choices.map(scheduleDateRequest))}catch(e){setError(e instanceof Error?e.message:String(e))}}
  return <section className="schedule-change-review" aria-label="保存済み請求予定の変更確認">
    <h3>請求詳細の予定日も変更しますか？</h3><p>{name}の変更したい回にチェックしてください。</p>
    <p className="notice">変更するのは、選んだ回の請求予定日だけです。</p>
    <HelpNote title="変わらない情報は？"><p>金額・請求先・保守期間・入金予定日は変更しません。発行済み・入金済みの記録もそのままです。</p><p>チェックしなかった回も変更しません。</p></HelpNote>
    <fieldset disabled={busy}>
      {error&&<p role="alert" className="form-error">{error}</p>}
      {review.changes.map(c=><label className="schedule-change-row" key={c.unit.id}><input type="checkbox" checked={selected.includes(c.unit.id)} onChange={e=>setSelected(s=>e.target.checked?[...s,c.unit.id]:s.filter(id=>id!==c.unit.id))}/><span><strong>{c.unit.serviceYear}年・{c.unit.roundLabel}</strong><span>{c.period}</span><span className="schedule-change-dates">{c.unit.scheduledDate} → <b>{c.date}</b></span><span>{c.unit.plannedAmount==null?'金額要確認':fmtYen(c.unit.plannedAmount)} ／ {c.unit.recipientId==null?'請求先要確認':recipientName(c.unit.recipientId)}</span></span></label>)}
      {!!editable.length&&<div className="schedule-change-manual"><h4>変更後の日付を入力（{editable.length}件）</h4><p>チェックを入れると日付を入力できます。</p>{editable.map(c=>{const checked=selected.includes(c.unit.id),date=dates[c.unit.id]??'';return <section className="schedule-change-editable" key={c.unit.id}>
        <label className="schedule-change-row"><input type="checkbox" checked={checked} onChange={e=>setSelected(s=>e.target.checked?[...s,c.unit.id]:s.filter(id=>id!==c.unit.id))}/><span><strong>{c.unit.serviceYear}年・{c.unit.roundLabel}</strong><span>{c.period}</span><span>現在の請求予定日：{c.unit.scheduledDate||'未登録'}</span><span>{c.unit.plannedAmount==null?'金額要確認':fmtYen(c.unit.plannedAmount)} ／ {c.unit.recipientId==null?'請求先要確認':recipientName(c.unit.recipientId)}</span></span></label>
        <HelpNote title="日付の入力が必要な理由"><p>{c.reason}</p><p>意図して別の日にした予定かもしれないため、自動では変更しません。</p></HelpNote>
        <label className="schedule-change-date-label">変更後の請求予定日<input className="form-input" type="date" aria-label={`${c.unit.serviceYear}年・${c.unit.roundLabel}（記録${c.unit.id}）の変更後の請求予定日`} disabled={!checked} value={date} onChange={e=>setDates(d=>({...d,[c.unit.id]:e.target.value}))}/></label>
        {checked&&<p className="schedule-change-dates">{c.unit.scheduledDate||'未登録'} → <b>{date||'日付を入力してください'}</b></p>}
        {checked&&date===c.unit.scheduledDate&&<p role="alert">現在と同じ日付です。変更しない回はチェックを外してください。</p>}
        {checked&&date&&c.unit.paymentDueOn&&date>c.unit.paymentDueOn&&<p role="alert">入金予定日（{c.unit.paymentDueOn}）より後の日付です。「請求詳細」で入金予定日も確認してください。</p>}
        {checked&&isBillingDate(date)&&date<new Date().toLocaleDateString('sv-SE')&&<p>過去の日付の未発行予定として保存します。発行済みにはならず、期限を過ぎた予定として確認対象になります。</p>}
      </section>})}</div>}
      {!review.changes.length&&!editable.length&&<p>この画面で変更する未発行の請求予定はありません。</p>}
      {!!review.manual.length&&<div className="schedule-change-manual"><h4>「請求詳細」で変更する予定（{review.manual.length}件）</h4><p>以下の予定は、この画面では変更できません。</p><HelpNote title="どこで変更する？"><p>この画面を閉じ、「請求詳細」で対象の回を選んでください。口座振替などは、日付以外の情報も確認して変更します。</p></HelpNote>{review.manual.map(u=><p key={u.id}>{u.serviceYear}年・{u.roundLabel} ／ {u.scheduledDate??'予定日未登録'}</p>)}</div>}
      {review.notice&&<p role="status">{review.notice}</p>}
      <HelpNote title="来年以降の請求予定日は？"><p>今後新しく作る予定には「請求情報」の予定日を使います。この画面で入力する日付は、選んだ回だけに適用します。</p><p>「前年12月1日請求」の繰り返し設定がある場合は、そちらを優先します。</p></HelpNote>
      <div className="schedule-change-buttons"><button type="button" className="btn btn-sub" onClick={onBack}>編集に戻る</button><button type="button" className="btn btn-sub" onClick={()=>onSave([])}>請求情報だけ保存</button><button type="button" className="btn btn-main" disabled={!selected.length||invalid} onClick={saveSelected}>{busy?'保存中…':`選択した${selected.length}件も変更して保存`}</button></div>
    </fieldset>
  </section>
}
