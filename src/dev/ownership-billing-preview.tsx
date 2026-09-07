import { createRoot } from 'react-dom/client'
import { OwnershipBillingPlanEditor } from '../components/OwnershipBillingPlanEditor'
import type { TransferBillingUnit } from '../lib/ownership-billing-plan'
import '../styles.css'

const base:TransferBillingUnit={id:'1',projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',
  scheduledDate:'2026-12-01',recipientId:1,lifecycle:'planned',issuedOn:null,receivedOn:null,
  frozenAmount:null,frozenLineItems:null,frozenAt:null,plannedAmount:82500,revision:0,collectionState:'pending'}
const units:TransferBillingUnit[]=[base,{...base,id:'2',roundLabel:'11月分',method:'口座振替',scheduledDate:'2026-11-27'},
  {...base,id:'3',serviceYear:2025,lifecycle:'received',issuedOn:'2025-06-01',receivedOn:'2025-06-10',collectionState:'succeeded',
    frozenAmount:82500,frozenLineItems:[{name:'保守料',amount:82500}],frozenAt:'2025-06-01T00:00:00Z'}]
if(import.meta.env.DEV)createRoot(document.getElementById('root')!).render(<main style={{maxWidth:1000,margin:'24px auto',padding:20}}>
  <h1>サンプル発電所 ― 所有者変更</h1>
  <p className="notice">架空データ専用です。入力・確認のみで、所有者や請求のDB保存は行いません。</p>
  <OwnershipBillingPlanEditor projectId={1} oldOwner={{id:1,name:'顧客A'}} newOwner={{id:2,name:'顧客B'}} units={units}/>
</main>)
