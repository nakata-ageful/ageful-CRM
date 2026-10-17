import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Modal} from '../components/Modal'
import {BillingScheduleChangeReview} from '../components/BillingScheduleChangeReview'
import {reviewScheduleDateChanges,saveScheduleDateChanges} from '../lib/billing-schedule-change'
import type {Contract} from '../types'
import type {BillingUnit} from '../lib/billing-unit'
import type {InvoiceWriteRequest} from '../lib/invoice-write-session'
import type {BillingCycleRule} from '../lib/billing-cycle'
import '../styles.css'
const before={id:1,project_id:1,billing_method:'請求書',billing_count:2,maintenance_start_date:'2020-06-27',billing_schedule_days:['5月1日','11月1日']} as Contract
const after={...before,billing_schedule_days:['5月1日','11月1日']}
const unit:BillingUnit={id:'1',projectId:1,serviceYear:2026,roundLabel:'第2回',method:'請求書',scheduledDate:'2026-12-01',recipientId:1,lifecycle:'planned',issuedOn:null,receivedOn:null,frozenAt:null,frozenAmount:null,frozenLineItems:null,plannedAmount:165000,revision:1,periodStart:'2026-06-27',periodEnd:'2027-06-26'}
const annual={...before,billing_count:1,maintenance_start_date:'2020-01-01',billing_schedule_days:['12月1日']},november={...annual,billing_schedule_days:['11月1日']}
const paid={...unit,roundLabel:'第1回',lifecycle:'received' as const,issuedOn:'2026-01-05',receivedOn:'2026-01-15',frozenAt:'2026-01-05T00:00:00Z',frozenAmount:165000,periodStart:'2026-01-01',periodEnd:'2026-12-31'}
type Sample={label:string;before:Contract;after:Contract;units:BillingUnit[];rules?:BillingCycleRule[]}
const samples:Sample[]=[
  {label:'今回分と来年の自動予定',before:{...annual,maintenance_start_date:'2020-12-23',billing_schedule_days:['11月1日']},after:{...annual,maintenance_start_date:'2020-12-23'},units:[{...unit,roundLabel:'第1回',scheduledDate:'2026-11-01',periodStart:'2026-12-23',periodEnd:'2027-12-22'},{...paid,id:'2',serviceYear:2025,periodStart:'2025-12-23',periodEnd:'2026-12-22'}]},
  {label:'保存済み記録なし',before:annual,after:november,units:[]},
  {label:'今年は入金済み',before:annual,after:november,units:[paid]},
  {label:'前年12月請求が優先',before:annual,after:november,units:[paid],rules:[{id:1,project_id:1,effective_year:2027,mode:'calendar_prepaid',recorded_at:'2026-10-15',reason:'合成設定'}]},
  {label:'保存済みの日付を修正',before,after,units:[unit,{...unit,id:'2',serviceYear:2027,scheduledDate:null,periodStart:'2027-06-27',periodEnd:'2028-06-26'}]},
  {label:'すでに11月へ変更済み',before:annual,after:november,units:[{...unit,roundLabel:'第1回',scheduledDate:'2026-11-01',periodStart:'2026-01-01',periodEnd:'2026-12-31'}]},
]
function Preview({sample}:{sample:Sample}){const [open,setOpen]=useState(true),[busy,setBusy]=useState(false),[fail,setFail]=useState(false),[notice,setNotice]=useState(''),[dates,setDates]=useState<(string|null)[]>(sample.units.map(u=>u.scheduledDate)),[days,setDays]=useState(sample.before.billing_schedule_days)
  const review=reviewScheduleDateChanges(sample.before,sample.after,sample.units,'2026-10-15',sample.rules)!
  async function save(requests:InvoiceWriteRequest[]){setBusy(true);try{await saveScheduleDateChanges(async()=>{setDays(sample.after.billing_schedule_days)},async q=>{if(fail)throw Error('合成データの通信失敗（結果要確認）');setDates(d=>d.map((date,i)=>Number(sample.units[i].id)===q.unitId?String((q.value as {scheduled_date:string}).scheduled_date):date))},requests);setNotice(`請求情報保存済み／予定${requests.length}件を変更`);setOpen(false)}catch(e){setNotice(e instanceof Error?e.message:String(e));setOpen(false)}finally{setBusy(false)}}
  return <main style={{maxWidth:1000,margin:'24px auto',padding:20}}><h1>請求予定日変更・隔離検証</h1><p>合成データ・メモリーだけ。本番DBに接続・保存しません。</p><p>基本設定：{days?.join('、')} ／ 保存済み予定：{dates.map(d=>d??'未登録').join('、')}</p><button className="btn btn-main" onClick={()=>setOpen(true)}>確認画面を開く</button><button className="btn btn-sub" onClick={()=>setFail(!fail)}>{fail?'失敗検証を解除':'途中失敗を試す'}</button>{notice&&<p role="status">{notice}</p>}{open&&<Modal title="請求情報を編集" width={800} closeDisabled={busy} onClose={()=>setOpen(false)}><BillingScheduleChangeReview review={review} name="検証用発電所" recipientName={()=>'合成顧客'} busy={busy} onBack={()=>setOpen(false)} onSave={requests=>void save(requests)}/></Modal>}</main>
}
function Playground(){const [index,setIndex]=useState(0);return <><label>検証ケース<select aria-label="検証ケース" value={index} onChange={e=>setIndex(Number(e.target.value))}>{samples.map((s,i)=><option key={s.label} value={i}>{s.label}</option>)}</select></label><Preview key={index} sample={samples[index]}/></>}
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<Playground/> )
else document.getElementById('root')!.textContent='隔離検証モード専用です。'
