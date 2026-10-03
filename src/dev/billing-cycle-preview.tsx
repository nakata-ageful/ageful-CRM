import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {BillingCycleSettings} from '../components/BillingCycleSettings'
import {InvoiceLedgerDetail} from '../components/InvoiceLedgerDetail'
import {BillingOverviewTable} from '../components/BillingOverviewTable'
import {OwnershipTransferHistory} from '../components/OwnershipTransferHistory'
import {legacyScheduleSetupReview} from '../lib/billing-cutover-coverage'
import type {BillingCycleRule} from '../lib/billing-cycle'
import type {Contract,BillingRow} from '../types'
import type {BillingUnit} from '../lib/billing-unit'
import {contractFieldKinds} from '../lib/ownership-field-selection'
import '../styles.css'
// Synthetic in-memory fixture only. No Supabase, auth, business actions or persistence.
const contract={...Object.fromEntries(Object.keys(contractFieldKinds).map(k=>[k,null])),id:1,project_id:1,maintenance_start_date:'2023-08-01',billing_method:'請求書',billing_count:1,billing_schedule_days:['12月1日'],annual_maintenance_inc:165000} as unknown as Contract
const paid:BillingUnit={id:'1',projectId:1,serviceYear:2026,roundLabel:'保存済み単回記録',method:'請求書',recipientId:1,lifecycle:'received',scheduledDate:null,issuedOn:'2026-07-01',receivedOn:'2026-07-11',frozenAmount:68750,frozenLineItems:[{name:'移行期間の保守料',amount:68750}],frozenAt:'2026-07-01T00:00:00Z',revision:0,periodStart:'2026-08-01',periodEnd:'2026-12-31'}
function Preview(){
  const [rules,setRules]=useState<BillingCycleRule[]>([]),[units,setUnits]=useState([paid]),[fail,setFail]=useState(false),[overlap,setOverlap]=useState(false)
  const [tab,setTab]=useState('請求情報'),[events,setEvents]=useState<Record<string,unknown>[]>([])
  const shown=overlap?units.map(u=>u.id==='1'?{...u,periodEnd:'2027-07-31'}:u):units
  const data={units:shown,cycleRules:rules,recipients:[{id:1,name:'検証顧客A'}],recipientName:()=> '検証顧客A',projectName:()=> '検証発電所',plannedAmount:()=>null}
  const row={project_id:1,project_name:'検証発電所',customer_name:'検証顧客A',contract,records:[]} as unknown as BillingRow
  const setup=legacyScheduleSetupReview([row],new Map([[1,1]]),shown,'2026-10-03',undefined,[],rules)
  return <main style={{padding:24,maxWidth:1240,margin:'auto'}}><div className="notice">隔離検証：合成データのみ。本番DBへの接続はありません。保存はこのページのメモリー内だけです。</div>
    <h2>検証発電所 ／ 保守期間の切替</h2><div className="detail-tabs">{['請求情報','請求詳細','請求一覧','変更履歴'].map(t=><button className={`detail-tab ${tab===t?'active':''}`} key={t} onClick={()=>setTab(t)}>{t}</button>)}</div>
    <p><label><input type="checkbox" checked={fail} onChange={e=>setFail(e.target.checked)}/>保存失敗を検証</label>{' '}<label><input type="checkbox" checked={overlap} onChange={e=>setOverlap(e.target.checked)}/>切替前の期間が翌年まで続く場合を検証</label></p>
    {tab==='請求情報'&&<BillingCycleSettings contract={contract} units={shown} rules={rules} onSave={async value=>{if(fail)throw Error('隔離検証の保存失敗');const rule:BillingCycleRule={id:rules.length+1,project_id:1,effective_year:value.year,mode:value.mode,reason:value.reason,recorded_at:new Date().toISOString()};setRules([...rules,rule]);setEvents([...events,{id:`cycle:${rule.id}`,project_id:1,event_type:'cycle_rule_changed',recorded_at:rule.recorded_at,before_value:rules.at(-1)??null,after_value:rule,reason:rule.reason}])}}/>}
    {tab==='請求詳細'&&<InvoiceLedgerDetail contract={contract} projectId={1} currentRecipientId={1} maintenanceStartDate={contract.maintenance_start_date} today="2026-10-03" data={data} onAddSchedule={async(item,reason)=>{if(fail)throw Error('隔離検証の保存失敗');setUnits([...units,{id:String(units.length+1),projectId:1,serviceYear:item.year,roundLabel:`第${item.round}回`,method:'請求書',recipientId:item.recipientId,lifecycle:'planned',scheduledDate:item.date,issuedOn:null,receivedOn:null,frozenAmount:null,frozenLineItems:null,frozenAt:null,plannedAmount:item.amount,revision:0,periodStart:item.periodStart,periodEnd:item.periodEnd,planNote:reason}])}}/>}
    {tab==='請求一覧'&&<section className="card" style={{padding:20}}><h3>今月・来月・再来月の請求予定</h3><BillingOverviewTable data={data} units={shown.filter(u=>u.lifecycle==='planned')} candidates={setup.items} mode="upcoming" today="2026-10-03"/></section>}
    {tab==='変更履歴'&&<OwnershipTransferHistory transfers={[]} events={events} recipientName={data.recipientName}/>}
  </main>
}
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<Preview/>)
else document.getElementById('root')!.textContent='隔離検証モード専用です。'
