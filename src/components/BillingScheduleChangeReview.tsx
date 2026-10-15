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
  const hasChoices=review.changes.length+editable.length>0,impact=review.impact
  const choices=[...review.changes,...editable.map(c=>({...c,date:dates[c.unit.id]??''}))].filter(c=>selected.includes(c.unit.id))
  const invalid=choices.some(c=>!isBillingDate(c.date)||c.date===c.unit.scheduledDate||!!c.unit.paymentDueOn&&c.unit.paymentDueOn<c.date)
  function saveSelected(){try{setError('');onSave(choices.map(scheduleDateRequest))}catch(e){setError(e instanceof Error?e.message:String(e))}}
  return <section className="schedule-change-review" aria-label="保存済み請求予定の変更確認">
    <h3>{hasChoices?'請求詳細の予定日も変更しますか？':'今後の請求設定を確認'}</h3><p>{hasChoices?`${name}の変更したい回にチェックしてください。`:name}</p>
    {hasChoices&&<p className="notice">変更するのは、選んだ回の請求予定日だけです。</p>}

    <fieldset disabled={busy}>
      {error&&<p role="alert" className="form-error">{error}</p>}
      {impact&&<section className="schedule-setting-impact" aria-label="これから登録する予定への反映"><h4>これから登録する予定</h4>
        {impact.after?<><p><strong>{impact.after.year}年・第{impact.after.round}回</strong><br/>保守期間：{impact.after.period}</p>{impact.before&&(impact.before.year!==impact.after.year||impact.before.round!==impact.after.round||impact.before.period!==impact.after.period)?<p>変更前の候補：{impact.before.year}年・第{impact.before.round}回 ／ {impact.before.period} ／ {impact.before.date||'未登録'}</p>:null}<p className="schedule-change-dates">{impact.after.method==='direct_debit'?'振替予定日':'請求予定日'}：{impact.before?.date||'未登録'} → <b>{impact.after.date||'未登録'}</b></p></>:<p>次の予定日は、下の確認事項を確認してください。</p>}
        <p>保存後の参考予定は上のとおりです。予定の新規登録や、請求書の発行は行いません。</p>
        {impact.warnings.map(w=><p role="status" className="notice" key={w}>{w}</p>)}
      </section>}
      {review.changes.map(c=><label className="schedule-change-row" key={c.unit.id}><input type="checkbox" checked={selected.includes(c.unit.id)} onChange={e=>setSelected(s=>e.target.checked?[...s,c.unit.id]:s.filter(id=>id!==c.unit.id))}/><span><strong>{c.unit.serviceYear}年・{c.unit.roundLabel}</strong><span>{c.period}</span><span className="schedule-change-dates">{c.unit.scheduledDate} → <b>{c.date}</b></span><span>{c.unit.plannedAmount==null?'金額要確認':fmtYen(c.unit.plannedAmount)} ／ {c.unit.recipientId==null?'請求先要確認':recipientName(c.unit.recipientId)}</span></span></label>)}
      {!!editable.length&&<div className="schedule-change-manual"><h4>変更後の日付を入力（{editable.length}件）</h4><p>チェックを入れると日付を入力できます。</p>{editable.map(c=>{const checked=selected.includes(c.unit.id),date=dates[c.unit.id]??'';return <section className="schedule-change-editable" key={c.unit.id}>
        <label className="schedule-change-row"><input type="checkbox" checked={checked} onChange={e=>setSelected(s=>e.target.checked?[...s,c.unit.id]:s.filter(id=>id!==c.unit.id))}/><span><strong>{c.unit.serviceYear}年・{c.unit.roundLabel}</strong><span>{c.period}</span><span>現在の請求予定日：{c.unit.scheduledDate||'未登録'}</span><span>{c.unit.plannedAmount==null?'金額要確認':fmtYen(c.unit.plannedAmount)} ／ {c.unit.recipientId==null?'請求先要確認':recipientName(c.unit.recipientId)}</span></span></label>

        <label className="schedule-change-date-label">変更後の請求予定日<input className="form-input" type="date" aria-label={`${c.unit.serviceYear}年・${c.unit.roundLabel}（記録${c.unit.id}）の変更後の請求予定日`} disabled={!checked} value={date} onChange={e=>setDates(d=>({...d,[c.unit.id]:e.target.value}))}/></label>
        {checked&&<p className="schedule-change-dates">{c.unit.scheduledDate||'未登録'} → <b>{date||'日付を入力してください'}</b></p>}
        {checked&&date===c.unit.scheduledDate&&<p role="alert">現在と同じ日付です。変更しない回はチェックを外してください。</p>}
        {checked&&date&&c.unit.paymentDueOn&&date>c.unit.paymentDueOn&&<p role="alert">入金予定日（{c.unit.paymentDueOn}）より後の日付です。「請求詳細」で入金予定日も確認してください。</p>}
        {checked&&isBillingDate(date)&&date<new Date().toLocaleDateString('sv-SE')&&<p>過去の日付の未発行予定として保存します。発行済みにはならず、期限を過ぎた予定として確認対象になります。</p>}
      </section>})}</div>}
      {!hasChoices&&<p>{!impact?'この画面で変更する未発行の請求予定はありません。':impact.savedCount===0?'登録済みの請求予定はありません。内容を確認して「請求情報を保存」を押してください。':impact.alignedCount>0?'登録済みの予定日は、変更後の設定と一致しています。':impact.plannedCount===0?'日付を変更する登録済みの予定はありません。過去の記録はそのまま残します。':'登録済みの予定は、下の案内に沿って確認してください。'}</p>}
      {!!impact?.protectedCount&&<p>発行済み・入金済みの{impact.protectedCount}件は変更しません。</p>}
      {!!review.manual.length&&<div className="schedule-change-manual"><h4>別の画面で確認する予定（{review.manual.length}件）</h4><p>以下の予定は、この画面では変更しません。</p>{review.manual.map(u=><div key={u.id}><p>{u.serviceYear}年・{u.roundLabel} ／ {u.scheduledDate??'予定日未登録'} ／ {u.method}</p><p>{u.method==='口座振替'?'「管理設定」→「請求先・方法・予定額を変更する」で確認してください。':'「請求詳細」でこの回の記録の状態を確認してください。'}</p></div>)}</div>}
      {review.notice&&!!(editable.length+review.manual.length)&&<p role="status">{review.notice}</p>}


      <div className="schedule-change-buttons"><button type="button" className="btn btn-sub" onClick={onBack}>編集に戻る</button><button type="button" className={`btn ${hasChoices?'btn-sub':'btn-main'}`} onClick={()=>onSave([])}>{busy&&!hasChoices?'保存中…':hasChoices?'請求情報だけ保存':'請求情報を保存'}</button>{hasChoices&&<button type="button" className="btn btn-main" disabled={!selected.length||invalid} onClick={saveSelected}>{busy?'保存中…':`選択した${selected.length}件も変更して保存`}</button>}</div>
    </fieldset>
  </section>
}
