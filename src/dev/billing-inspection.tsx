import {useEffect,useMemo,useState} from 'react'
import {createRoot} from 'react-dom/client'
import '../styles.css'
import type {AnnualRecord,BillingRow,Contract} from '../types'
import {supabase} from '../lib/supabase'
import {billingUnitFromStorage} from '../lib/billing-unit-storage'
import {legacyScheduleSetupReview,inspectFutureBillingCoverage} from '../lib/billing-cutover-coverage'
import {managementEventFromStorage} from '../lib/management-lifecycle'
import {BillingOverviewPanel} from '../components/BillingOverviewPanel'
import type {BillingHistoryData} from '../components/BillingHistorySection'

type NamedCustomer={id:number;name:string;company_name:string|null}
type NamedProject={id:number;customer_id:number;project_name:string}
type InspectionSnapshot={
  version:1;mode:'read_only_inspection';future_schedule_coverage_verified:false
  customers:NamedCustomer[];projects:NamedProject[];contracts:Contract[]
  annual_records:AnnualRecord[];units:Record<string,unknown>[];management_events:Record<string,unknown>[]
}

const fixture:InspectionSnapshot={
  version:1,mode:'read_only_inspection',future_schedule_coverage_verified:false,
  customers:[{id:1,name:'確認用A',company_name:null}],
  projects:[{id:1,customer_id:1,project_name:'確認用発電所'}],
  contracts:[{id:1,project_id:1,billing_method:'請求書',billing_count:1,billing_schedule_days:['10月15日'],
    annual_maintenance_inc:165000,billing_item_flags:null,billing_amount_overrides:null,
    land_cost_monthly:0,insurance_fee:0,local_association_fee:0,communication_fee:0,other_fee:0,
    has_issuance_fee:false,issuance_fee_inc:0,has_transfer_fee:false,transfer_fee_inc:0,
    maintenance_start_date:'2025-01-01'} as Contract],
  annual_records:[],
  units:[{id:1,project_id:1,service_year:2025,round_number:1,service_month:null,
    collection_method:'invoice',scheduled_date:'2025-10-15',issued_on:'2025-10-15',
    received_on:'2025-10-20',payment_due_on:'2025-10-31',recipient_customer_id:1,
    lifecycle:'received',frozen_amount:165000,frozen_line_items:[{name:'保守料',amount:165000}],
    frozen_at:'2025-10-15T00:00:00Z',planned_amount:null,revision:0,
    period_start:'2025-01-01',period_end:'2025-12-31',plan_note:''}],
  management_events:[],
}

function isSnapshot(value:unknown):value is InspectionSnapshot{
  if(!value||typeof value!=='object')return false
  const v=value as Record<string,unknown>
  return v.version===1&&v.mode==='read_only_inspection'&&v.future_schedule_coverage_verified===false
    &&['customers','projects','contracts','annual_records','units','management_events'].every(key=>Array.isArray(v[key]))
}

function InspectionPage(){
  const [snapshot,setSnapshot]=useState<InspectionSnapshot|null>(null)
  const [error,setError]=useState('')
  const [loading,setLoading]=useState(true)
  useEffect(()=>{
    let cancelled=false
    async function load(){
      try{
        if(!import.meta.env.DEV)throw Error('本番では確認専用画面を使用できません')
        if(import.meta.env.VITE_BILLING_INSPECTION_FIXTURE==='true'){
          if(!cancelled)setSnapshot(fixture)
          return
        }
        if(!supabase)throw Error('新DBの接続設定がありません')
        const user=await supabase.auth.getUser()
        if(user.error||!user.data.user)throw Error('先に同じローカルURLの通常画面でログインしてください')
        const response=await supabase.rpc('billing_runtime_inspection_snapshot')
        if(response.error||!isSnapshot(response.data))throw Error('確認専用データを取得できません。新DBの権限と移行状態を確認してください')
        if(!cancelled)setSnapshot(response.data)
      }catch(e){if(!cancelled)setError(e instanceof Error?e.message:'確認専用データを取得できません')}
      finally{if(!cancelled)setLoading(false)}
    }
    void load()
    return()=>{cancelled=true}
  },[])

  const view=useMemo(()=>{
    if(!snapshot)return null
    const customers=new Map(snapshot.customers.map(c=>[c.id,c]))
    const projects=new Map(snapshot.projects.map(p=>[p.id,p]))
    const contractsByProject=new Map<number,Contract[]>()
    for(const contract of snapshot.contracts){
      const list=contractsByProject.get(contract.project_id)??[]
      list.push(contract);contractsByProject.set(contract.project_id,list)
    }
    const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
    const rows:BillingRow[]=snapshot.projects.map(project=>{
      const contracts=contractsByProject.get(project.id)??[]
      const contract=contracts.length===1?contracts[0]:null
      const records=contract?snapshot.annual_records.filter(record=>record.contract_id===contract.id):[]
      const currentYearRecords=records.filter(record=>record.year===now.getFullYear())
      const customer=customers.get(project.customer_id)
      return {project_id:project.id,project_name:project.project_name,customer_name:customer?.name??`顧客ID ${project.customer_id}`,
        company_name:customer?.company_name??null,contract,contract_count:contracts.length,
        records,currentYear:now.getFullYear(),currentYearRecord:currentYearRecords[0]??null,currentYearRecords}
    })
    const units=snapshot.units.map(billingUnitFromStorage)
    const recipients=new Map(snapshot.projects.map(project=>[project.id,project.customer_id]))
    const managementEvents=snapshot.management_events.map(managementEventFromStorage)
    const review=legacyScheduleSetupReview(rows,recipients,units,today,undefined,managementEvents)
    const coverage=inspectFutureBillingCoverage(rows.filter(row=>row.contract_count===1),recipients,
      snapshot.units.map(unit=>({
        project_id:Number(unit.project_id),recipient_customer_id:Number(unit.recipient_customer_id),
        collection_method:String(unit.collection_method),scheduled_date:unit.scheduled_date as string|null,
        lifecycle:String(unit.lifecycle),planned_amount:unit.planned_amount as number|null,
        round_number:unit.round_number as number|null,service_month:unit.service_month as number|null,
      })),today.slice(0,7),24,managementEvents)
    const invoiceCandidates=coverage.candidates.filter(candidate=>candidate.method==='invoice')
    const debitCandidates=coverage.candidates.filter(candidate=>candidate.method==='direct_debit')
    const history:BillingHistoryData={units,recipients:snapshot.customers.map(c=>({id:c.id,name:c.name})),plannedAmount:()=>null,
      managementEvents,recipientName:id=>customers.get(id)?.name??`顧客ID ${id}`,
      projectName:id=>projects.get(id)?.project_name??`発電所ID ${id}`}
    return {today,history,review,coverage,invoiceCandidates,debitCandidates}
  },[snapshot])

  return <main style={{maxWidth:1260,margin:'32px auto',padding:'0 20px'}}>
    <div className="card"><h1>新DBの請求確認</h1><p role="status"><strong>確認専用・保存不可</strong>。旧アプリは継続中です。ここに表示する未保存候補は請求先・金額を確定した記録ではありません。</p>
      <p>この画面は開発環境でのみ動作します。所有者変更・発行・入金・CSV取込はできません。</p></div>
    {loading&&<p>新DBの記録を読み込んでいます…</p>}
    {error&&<div className="notice" role="alert">{error}</div>}
    {snapshot&&view&&<>
      <div className="card"><h2>照合の目安</h2><p>顧客 {snapshot.customers.length}件 ／ 発電所 {snapshot.projects.length}件 ／ 契約 {snapshot.contracts.length}件 ／ 保存済み請求回 {snapshot.units.length}件</p>
        <p>今後24か月の請求書の予定候補：{view.invoiceCandidates.length}回（未保存 {view.invoiceCandidates.filter(candidate=>candidate.status==='missing').length}回）。</p>
        <p>口座振替の確認日候補：{view.debitCandidates.length}か月分（未保存 {view.debitCandidates.filter(candidate=>candidate.status==='missing').length}か月分）。銀行が振替を実行し、このアプリでは結果を確認・記録します。未保存は未払い・振替失敗を意味しません。</p>
        <p>保存内容要確認：{view.coverage.summary.review}回。いずれの候補も、請求書の発行や振替成功を確定した記録ではありません。</p>
        <p>現在の画面で確認が必要な請求設定：{view.review.issues.length}発電所。保守開始日が未入力の案件は別途確認します。</p></div>
      <BillingOverviewPanel data={view.history} today={view.today} setupItems={view.review.items} setupIssues={view.review.issues}/>
    </>}
  </main>
}

createRoot(document.getElementById('root')!).render(<InspectionPage/>)
