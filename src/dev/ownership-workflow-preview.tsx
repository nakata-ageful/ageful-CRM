import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Modal} from '../components/Modal'
import {OwnershipWorkflowPanel} from '../components/OwnershipWorkflowPanel'
import {InvoiceLedgerDetail} from '../components/InvoiceLedgerDetail'
import {OwnershipWorkflowHistory} from '../components/OwnershipWorkflowHistory'
import type {Customer,Project,Contract} from '../types'
import '../styles.css'

const project={id:1,customer_id:1,project_name:'確認用発電所',plant_name:'確認用発電所'} as Project
const customers=[{id:1,name:'旧所有者A',name_kana:null,company_name:null,is_corporate:false},{id:2,name:'引継ぎ候補B',name_kana:null,company_name:null,is_corporate:false}] as Customer[]
const contract={id:1,project_id:1,billing_method:'請求書',billing_count:1,billing_schedule_days:['12月1日'],maintenance_start_date:'2020-01-01',annual_maintenance_inc:165000} as Contract
function Preview(){
  const [sample,setSample]=useState<'start'|'candidate'|'unknown'|'billing'|'history'>('start'),[notice,setNotice]=useState('')
  const unknown={...project,customer_id:null,previous_owner_customer_id:1,owner_unconfirmed_on:'2026-10-01',old_owner:'旧所有者A'}
  const [people,setPeople]=useState(customers)
  const forbidden=async()=>{throw Error('隔離検証：実DBへの操作はありません')}
  return <main style={{padding:16}}><h1>所有者引継ぎの確認用画面</h1><p>合成データのみ。本番の顧客・発電所・請求は読み書きしません。</p>
    <div className="tab-bar">{([['start','見込みへ戻す'],['candidate','未定から顧客を設定'],['unknown','所有者未確認'],['billing','未確認中の請求'],['history','手続きの履歴']] as const).map(([key,label])=><button key={key} onClick={()=>{setSample(key);setNotice('')}}>{label}</button>)}</div>
    {notice&&<p role="status">{notice}</p>}
    {sample==='billing'?<InvoiceLedgerDetail projectId={1} contract={contract} currentRecipientId={0} today="2026-10-15" data={{units:[],recipients:people,recipientName:id=>people.find(c=>c.id===id)?.name??'請求先未設定',projectName:()=>project.project_name,plannedAmount:()=>null}} onAddSchedule={forbidden} onSave={forbidden}/>:sample==='history'?<OwnershipWorkflowHistory recipientName={id=>people.find(c=>c.id===id)?.name??'未確認'} events={[{operation_key:'sample',project_id:1,action:'unknown',effective_on:'2026-10-01',created_at:'2026-10-01T00:00:00Z',reason:'売却済み。新所有者の氏名を確認中',before_snapshot:{project,contract:[contract]},after_snapshot:{project:unknown}}]}/>:<Modal title={sample==='candidate'?'引継ぎ先を設定':'所有者を変更'} width={1000} onClose={()=>setNotice('閉じる操作を確認。本番には保存していません。')}>
      <OwnershipWorkflowPanel key={sample} project={sample==='unknown'?unknown:project} candidateOnly={sample==='candidate'} customers={people}
        onDirect={()=>setNotice('本番では、既存の所有者・契約・各回の請求を確認する画面へ進みます。')}
        onCreateCustomer={async input=>{const c={...input,id:people.length+1,created_at:'2026-10-15'} as Customer;setPeople(xs=>[...xs,c]);return c}}
        onReloadCustomers={async()=>people}
        onSave={async(action,id,date)=>setNotice(`確認用：${action} ／ 引継ぎ先 ${id??'未定'} ／ 日付 ${date||'変更なし'}。本番には保存していません。`)}/>
    </Modal>}
  </main>
}
if(import.meta.env.DEV)createRoot(document.getElementById('root')!).render(<Preview/>)
