import {useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {OwnershipTransferEditor} from '../components/OwnershipTransferEditor'
import {Modal} from '../components/Modal'
import {contractFieldKinds,projectFieldKinds} from '../lib/ownership-field-selection'
import type {Contract,Project,CustomerInput} from '../types'
import type {RegistrationCustomer} from '../lib/customer-registration'
import '../styles.css'

// Synthetic memory only. No Supabase, authentication or business writers.
const initialProject={...Object.fromEntries(Object.keys(projectFieldKinds).map(k=>[k,null])),id:1,customer_id:1,project_name:'検証用発電所',plant_name:'検証用発電所'} as Project
const contract={...Object.fromEntries(Object.keys(contractFieldKinds).map(k=>[k,null])),id:1,project_id:1,billing_method:'請求書',billing_count:1,billing_schedule_days:['12月1日'],maintenance_start_date:'2020-01-01',annual_maintenance_inc:82500} as Contract
function Preview(){
  const rows=useRef<RegistrationCustomer[]>([{id:1,name:'検証旧所有者'},{id:2,name:'検証既存顧客',phone:'090-0000-0000'}])
  const [customers,setCustomers]=useState(rows.current),[project,setProject]=useState(initialProject),[open,setOpen]=useState(true),[busy,setBusy]=useState(false),[lost,setLost]=useState(false),[notice,setNotice]=useState('')
  const [pending,setPending]=useState<CustomerInput|null>(null)
  async function create(input:CustomerInput){const customer={...input,id:Math.max(...rows.current.map(c=>c.id))+1};rows.current=[...rows.current,customer];
    if(lost)throw Error('隔離検証：顧客は保存されたが、通信の応答が届きませんでした');setCustomers(rows.current);return customer}
  return <main style={{maxWidth:1100,margin:'24px auto',padding:20}}><h1>所有者変更・顧客登録の隔離検証</h1><p>合成データのみ。本番DBへ接続・保存しません。再読み込みで初期状態に戻ります。</p>
    <p>現在の所有者ID：{project.customer_id} ／ 顧客一覧：{customers.length}件</p><button className="btn btn-main" onClick={()=>setOpen(true)}>所有者を変更</button><button className="btn btn-sub" onClick={()=>setLost(!lost)}>{lost?'通信失敗の検証を解除':'登録の通信失敗を試す'}</button>
    {notice&&<p role="status">{notice}</p>}
    {open&&<Modal title="所有者を変更" width={1100} closeDisabled={busy} onClose={()=>setOpen(false)}><OwnershipTransferEditor project={project} contract={contract} customers={customers} units={[]} testOnly onBusyChange={setBusy} onCreateCustomer={create} pendingCustomerInput={pending} onPendingCustomerChange={setPending}
      onReloadCustomers={async()=>{setCustomers(rows.current);return rows.current}}
      onSave={async input=>{setProject({...project,customer_id:input.newOwner});setNotice(`隔離データで所有者変更を確定：顧客ID ${input.newOwner} ／ ${input.date}`);setOpen(false)}}/>
    </Modal>}
  </main>
}
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<Preview/> )
else document.getElementById('root')!.textContent='隔離検証モード専用です。'
