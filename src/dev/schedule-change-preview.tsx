import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Modal} from '../components/Modal'
import {BillingScheduleChangeReview} from '../components/BillingScheduleChangeReview'
import {reviewScheduleDateChanges,saveScheduleDateChanges} from '../lib/billing-schedule-change'
import type {Contract} from '../types'
import type {BillingUnit} from '../lib/billing-unit'
import type {InvoiceWriteRequest} from '../lib/invoice-write-session'
import '../styles.css'
const before={id:1,project_id:1,billing_method:'請求書',billing_count:2,maintenance_start_date:'2020-06-27',billing_schedule_days:['5月1日','11月1日']} as Contract
const after={...before,billing_schedule_days:['5月1日','11月1日']}
const unit:BillingUnit={id:'1',projectId:1,serviceYear:2026,roundLabel:'第2回',method:'請求書',scheduledDate:'2026-12-01',recipientId:1,lifecycle:'planned',issuedOn:null,receivedOn:null,frozenAt:null,frozenAmount:null,frozenLineItems:null,plannedAmount:165000,revision:1,periodStart:'2026-06-27',periodEnd:'2027-06-26'}
const review=reviewScheduleDateChanges(before,after,[unit,{...unit,id:'2',serviceYear:2027,scheduledDate:null,periodStart:'2027-06-27',periodEnd:'2028-06-26'}],'2026-10-15')!
function Preview(){const [open,setOpen]=useState(true),[busy,setBusy]=useState(false),[fail,setFail]=useState(false),[notice,setNotice]=useState(''),[dates,setDates]=useState<(string|null)[]>(['2026-12-01',null]),[days,setDays]=useState(before.billing_schedule_days)
  async function save(requests:InvoiceWriteRequest[]){setBusy(true);try{await saveScheduleDateChanges(async()=>{setDays(after.billing_schedule_days)},async q=>{if(fail)throw Error('合成データの通信失敗（結果要確認）');setDates(d=>d.map((date,i)=>i===q.unitId-1?String((q.value as {scheduled_date:string}).scheduled_date):date))},requests);setNotice(`請求情報保存済み／予定${requests.length}件を変更`);setOpen(false)}catch(e){setNotice(e instanceof Error?e.message:String(e));setOpen(false)}finally{setBusy(false)}}
  return <main style={{maxWidth:1000,margin:'24px auto',padding:20}}><h1>請求予定日変更・隔離検証</h1><p>合成データ・メモリーだけ。本番DBに接続・保存しません。</p><p>基本設定：{days?.join('、')} ／ 保存済み予定：{dates.map(d=>d??'未登録').join('、')}</p><button className="btn btn-main" onClick={()=>setOpen(true)}>確認画面を開く</button><button className="btn btn-sub" onClick={()=>setFail(!fail)}>{fail?'失敗検証を解除':'途中失敗を試す'}</button>{notice&&<p role="status">{notice}</p>}{open&&<Modal title="請求情報を編集" width={800} closeDisabled={busy} onClose={()=>setOpen(false)}><BillingScheduleChangeReview review={review} name="検証用発電所" recipientName={()=>'合成顧客'} busy={busy} onBack={()=>setOpen(false)} onSave={requests=>void save(requests)}/></Modal>}</main>
}
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<Preview/> )
else document.getElementById('root')!.textContent='隔離検証モード専用です。'
