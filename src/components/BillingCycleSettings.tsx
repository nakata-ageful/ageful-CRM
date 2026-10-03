import {useRef,useState} from 'react'
import type {Contract} from '../types'
import type {BillingUnit} from '../lib/billing-unit'
import {cycleCompatibility,validateCycleRule,type BillingCycleRule} from '../lib/billing-cycle'
import {maintenancePeriod} from '../lib/maintenance-period-label'
import {Modal} from './Modal'

export type CycleSettingInput={year:number;mode:BillingCycleRule['mode'];reason:string}
export function BillingCycleSettings({contract,units,rules,onSave}:{contract:Contract;units:readonly BillingUnit[];rules:readonly BillingCycleRule[];onSave?:(value:CycleSettingInput)=>Promise<unknown>}){
  const own=rules.filter(r=>r.project_id===contract.project_id).sort((a,b)=>a.effective_year-b.effective_year||a.id-b.id)
  const [open,setOpen]=useState(false),[year,setYear]=useState(new Date().getFullYear()+1)
  const [mode,setMode]=useState<BillingCycleRule['mode']>('calendar_prepaid'),[reason,setReason]=useState(''),[review,setReview]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
  const saving=useRef(false)
  const latest=own.at(-1),compatible=cycleCompatibility(contract)
  const change=()=>{setReview(false);setNotice('')}
  function confirm(){try{validateCycleRule(contract,units,year,mode,reason);setReview(true);setNotice('')}catch(e){setReview(false);setNotice(e instanceof Error?e.message:String(e))}}
  async function save(){if(!onSave||!review||saving.current)return;saving.current=true;setBusy(true);try{validateCycleRule(contract,units,year,mode,reason);await onSave({year,mode,reason:reason.trim()});setOpen(false);setReview(false);setNotice('今後の保守期間・請求の繰り返し設定を保存しました。過去の記録は変更していません。')}catch(e){setNotice(e instanceof Error?e.message:String(e))}finally{saving.current=false;setBusy(false)}}
  const examples=Number.isInteger(year)&&year>=2001&&year<=2199?Array.from({length:Math.min(3,2200-year)},(_,i)=>year+i).map(y=>{
    let period={periodStart:'当初の保守開始日を確認してください',periodEnd:'未設定'}
    try{period=mode==='calendar_prepaid'?{periodStart:`${y}-01-01`,periodEnd:`${y}-12-31`}:maintenancePeriod(contract.maintenance_start_date,y)}catch{/* Input guidance remains available with a missing anchor. */}
    return {year:y,...period,date:mode==='calendar_prepaid'?`${y-1}-12-01`:'「請求予定日」の標準設定'}
  }):[]
  return <section className="card billing-cycle-settings">
    <div className="card-header-row"><h3 className="section-title">今後の保守期間・請求の繰り返し</h3>{onSave&&<button type="button" className="btn btn-sub btn-sm" onClick={()=>{setOpen(true);change();setReason('');setYear(Math.max(new Date().getFullYear()+1,latest?.effective_year??0));setMode(latest?.mode??'calendar_prepaid')}}>繰り返し設定を変更</button>}</div>
    <p>{latest?`${latest.effective_year}年の保守期間から：${latest.mode==='calendar_prepaid'?'毎年1月1日〜12月31日／前年12月1日に翌年分を請求':'当初の保守開始日を基準に1年間'}`:'未設定：保守開始日を基準に1年間の候補を表示します。'}</p>
    <p>切替後の未登録の候補では、この設定を標準の「請求予定日」より優先します。過去の記録・当初の保守開始日・保存済みの予定は変わりません。請求書の自動発行・送信は行いません。</p>
    {!compatible&&latest?.mode==='calendar_prepaid'&&<p role="alert" className="notice notice-error">繰り返し設定と請求方法・回数が一致していません。「請求書・年1回」にするか、繰り返し設定を変更してください。</p>}
    {!!own.length&&<p>設定の変更内容は「変更履歴」の「請求の変更」から確認できます。</p>}
    {!onSave&&<p role="status">繰り返し設定の保存機能は、この環境ではまだ利用できません。</p>}
    {!open&&notice&&<p role="status" className="notice">{notice}</p>}
    {open&&<Modal title="今後の保守期間・請求の繰り返し" width={760} onClose={()=>{if(!saving.current)setOpen(false)}}><div className="standard-editor"><fieldset disabled={busy} style={{border:0,padding:0}}>
      <label>繰り返し方法<select className="form-input" value={mode} onChange={e=>{setMode(e.target.value as BillingCycleRule['mode']);change()}}>
        <option value="calendar_prepaid" disabled={!compatible}>1月〜12月の保守／前年12月1日に翌年分を請求</option><option value="anniversary">当初の保守開始日を基準に1年間</option>
      </select></label>
      {!compatible&&<p>1月〜12月・前年12月1日請求は「請求情報」が「請求書・年1回」の発電所で利用できます。</p>}
      <label>何年分の保守期間から適用するか<input className="form-input" type="number" min={2001} max={2199} value={year} onChange={e=>{setYear(Number(e.target.value));change()}}/></label>
      <p>例：2027年を選ぶと、2027年1月〜12月分を2026年12月1日に請求する候補になります。</p>
      <div className="billing-overview-scroll"><table className="billing-overview-table"><thead><tr><th>対象の保守期間</th><th>請求予定日</th></tr></thead><tbody>{examples.map(e=><tr key={e.year}><td>{e.periodStart} ～ {e.periodEnd}</td><td>{e.date}</td></tr>)}</tbody></table></div>
      <p>8月〜年末などの移行期間は、先に「請求詳細」→「保守期間の確認・修正」で保存してください。期間の重複や、切替後の保存済み記録との不一致がある場合は保存を止めます。短い移行期間の金額は自動計算しません。</p>
      <label>確認内容・備考<textarea className="form-input" value={reason} onChange={e=>{setReason(e.target.value);change()}} placeholder="例：8月〜年末の移行期間を確認済み。2027年分から1月〜12月、前年12月1日請求に統一"/></label>
      {notice&&<p role="alert" className="notice notice-error">{notice}</p>}
      {review&&<p role="status" className="notice">上の繰り返し設定だけを保存します。保存済みの請求・入金・金額・期間・請求先は変更しません。今後も請求先と金額を確認して「予定を登録」し、発行日・入金日を記録してください。</p>}
      <div className="editor-footer"><button type="button" className="btn btn-sub" disabled={busy} onClick={()=>setOpen(false)}>キャンセル</button>{review?<button type="button" className="btn btn-main" onClick={()=>void save()}>{busy?'保存中…':'確認した繰り返し設定を保存'}</button>:<button type="button" className="btn btn-main" onClick={confirm}>設定内容を確認</button>}</div>
    </fieldset></div></Modal>}
  </section>
}
