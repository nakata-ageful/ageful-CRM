import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Modal} from '../components/Modal'
import {OwnershipWorkflowPanel} from '../components/OwnershipWorkflowPanel'
import {OwnershipTransferEditor,type OwnershipTransferInput} from '../components/OwnershipTransferEditor'
import {contractFieldKinds,projectFieldKinds,prepareOwnershipFields} from '../lib/ownership-field-selection'
import type {Customer,CustomerInput,Project,Contract} from '../types'
import type {TransferBillingUnit} from '../lib/ownership-billing-plan'
import '../styles.css'

// No actions/data/Supabase imports. All writes below are React memory only.
const initialProject={...Object.fromEntries(Object.keys(projectFieldKinds).map(k=>[k,null])),id:1,customer_id:1,project_name:'練習用発電所',plant_name:'練習用発電所'} as Project
const initialContract={...Object.fromEntries(Object.keys(contractFieldKinds).map(k=>[k,null])),id:1,project_id:1,billing_method:'請求書',billing_count:1,billing_schedule_days:['12月1日'],maintenance_start_date:'2026-01-01',annual_maintenance_inc:165000} as Contract
const people:Customer[]=[{id:1,name:'デモ所有者A',is_corporate:false},{id:2,name:'デモ顧客B',is_corporate:false}] as Customer[]
const unit:TransferBillingUnit={id:'demo-future',projectId:1,serviceYear:2027,roundLabel:'第1回',method:'請求書',scheduledDate:'2026-12-01',recipientId:1,lifecycle:'planned',issuedOn:null,receivedOn:null,frozenAmount:null,frozenLineItems:null,frozenAt:null,plannedAmount:165000,revision:1,collectionState:'pending',periodStart:'2027-01-01',periodEnd:'2027-12-31',planNote:'デモ専用の請求予定'}
const paid:TransferBillingUnit={...unit,id:'demo-paid',serviceYear:2026,lifecycle:'received',issuedOn:'2025-12-01',receivedOn:'2025-12-20',scheduledDate:'2025-12-01',frozenAmount:165000,frozenLineItems:[{name:'保守料',amount:165000}],frozenAt:'2025-12-01T00:00:00Z',collectionState:'succeeded',periodStart:'2026-01-01',periodEnd:'2026-12-31'}
function Demo(){
  const [project,setProject]=useState(initialProject),[contract,setContract]=useState(initialContract),[customers,setCustomers]=useState(people),[units,setUnits]=useState([paid,unit])
  const [prospect,setProspect]=useState<{candidate:number|null;completed:boolean}|null>(null)
  const [screen,setScreen]=useState<'project'|'prospect'>('project'),[modal,setModal]=useState<'start'|'candidate'|'complete'|'direct'|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
  const name=(id:number|null)=>customers.find(c=>c.id===id)?.name??'所有者未確認'
  async function create(input:CustomerInput){const c={...input,id:Math.max(...customers.map(c=>c.id))+1,created_at:new Date().toISOString()} as Customer;setCustomers(xs=>[...xs,c]);return c}
  function reset(){setProject(initialProject);setContract(initialContract);setCustomers(people);setUnits([paid,unit]);setProspect(null);setModal(null);setScreen('project');setNotice('デモを最初に戻しました')}
  async function complete(input:OwnershipTransferInput){
    if(input.choices.some(c=>'newOccurrence'in c))throw Error('この練習では、登録済みの12月1日の予定を使ってください。「新しい予定を追加する」のチェックを外してください。')
    const prepared=prepareOwnershipFields(project,contract,input.fields)
    setContract(prepared.after.contract as Contract);setProject({...project,customer_id:input.newOwner})
    setUnits(xs=>xs.map(u=>{const c=input.choices.find(c=>'unitId'in c&&c.unitId===u.id);return c&&'unitId'in c?{...u,recipientId:c.recipientId,scheduledDate:c.scheduledDate,plannedAmount:c.plannedAmount,revision:u.revision+1}:u}))
    if(prospect)setProspect({...prospect,completed:true})
    setModal(null);setScreen('project');setNotice(`デモ内で所有者を${name(input.newOwner)}に変更しました。本番データは変更していません。`)
  }
  return <main className="main" style={{margin:0,maxWidth:1200}}>
    <h1>所有者引継ぎ 体験デモ</h1><p style={{color:'#9a3412'}}>架空のデータだけを使います。本番への接続・保存はしません。再読み込みで最初に戻ります。</p>
    <div className="toolbar"><button className="btn btn-sub" onClick={()=>setScreen('project')}>発電所詳細</button><button className="btn btn-sub" disabled={!prospect} onClick={()=>setScreen('prospect')}>見込み管理</button><button className="btn btn-sub" disabled={busy} onClick={reset}>デモを最初に戻す</button></div>
    {notice&&<p role="status">{notice}</p>}
    {screen==='project'?<>
      <section className="card"><h2>練習用発電所</h2><p>現在の所有者：<strong>{name(project.customer_id)}</strong></p><button className="btn btn-main" onClick={()=>setModal('start')}>所有者を変更</button></section>
      <section className="card"><h3>請求予定（デモ）</h3><p>保守期間：2027-01-01 ～ 2027-12-31</p>{units.filter(u=>u.lifecycle==='planned').map(u=><p key={u.id}>{u.scheduledDate} ／ 請求先：{name(u.recipientId)} ／ {(u.plannedAmount??0).toLocaleString()}円</p>)}{units.filter(u=>u.lifecycle==='received').map(u=><p key={u.id}>過去の入金済み記録：{name(u.recipientId)} ／ {u.frozenAmount?.toLocaleString()}円（変更対象外）</p>)}</section>
    </>:<section className="card"><h2>見込み管理（デモ用の簡略表示）</h2><h3>練習用発電所</h3><p>引継ぎ先：{prospect?.candidate?name(prospect.candidate):'引継ぎ先未定'}</p><p>状態：{prospect?.completed?'引継ぎ完了':'手続き中'}</p>
      {!prospect?.completed&&<><button className="btn btn-sub" onClick={()=>setModal('candidate')}>引継ぎ先を設定</button>{prospect?.candidate&&<button className="btn btn-main" onClick={()=>setModal('complete')}>所有者を確定する</button>}</>}
      <p>相手を選ぶだけでは所有者は変わりません。「所有者を確定する」で契約・請求先を確認します。</p>
    </section>}
    {modal&&<Modal title={modal==='candidate'?'引継ぎ先を設定':'所有者を変更'} width={1100} closeDisabled={busy} onClose={()=>setModal(null)}>
      {modal==='complete'||modal==='direct'?<OwnershipTransferEditor project={project} contract={contract} customers={customers} units={units} initialOwnerId={modal==='complete'?prospect?.candidate??undefined:undefined} workflow={modal==='complete'?{applyStatus:'未',contractStatus:'未'}:undefined} testOnly onBusyChange={setBusy} onCreateCustomer={create} onReloadCustomers={async()=>customers} onSave={complete}/>:<OwnershipWorkflowPanel project={project} customers={customers} candidateOnly={modal==='candidate'} onBusyChange={setBusy} onDirect={modal==='start'?()=>setModal('direct'):undefined} onCreateCustomer={create} onReloadCustomers={async()=>customers} onSave={async(action,id,date)=>{
        if(action==='unknown'){setProject({...project,customer_id:null,previous_owner_customer_id:project.customer_id,owner_unconfirmed_on:date});setNotice('デモ内で所有者を未確認にしました。請求予定は残っています。');setModal(null);return}
        setProspect({candidate:id,completed:false});setModal(null);setScreen('prospect');setNotice(action==='start'?'見込みを登録しました。現在の所有者はまだ変わりません。':'引継ぎ先を設定しました。現在の所有者はまだ変わりません。')
      }}/ >}
    </Modal>}
  </main>
}
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<Demo/> )
else document.getElementById('root')!.textContent='本番では使えない隔離デモです。'
