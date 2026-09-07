import { useEffect,useRef,useState } from 'react'
import { OwnershipBillingPlanEditor } from '../components/OwnershipBillingPlanEditor'
import type { TransferBillingChoice,TransferBillingUnit } from '../lib/ownership-billing-plan'
import { billingUnitFromStorage } from '../lib/billing-unit-storage'
import { createInvoiceTestDb } from './invoice-test-db'
import manualPlan from '../../database/drafts/20260907_manual_billing_plan.sql?raw'

export function OwnershipBillingDbPreview(){
  const [units,setUnits]=useState<TransferBillingUnit[]|null>(null),[version,setVersion]=useState(0)
  const [message,setMessage]=useState('検証用DBを準備しています…'),[events,setEvents]=useState<{id:number;reason:string}[]>([])
  const saveRef=useRef<((choices:TransferBillingChoice[],reason:string)=>Promise<void>)|null>(null)
  useEffect(()=>{
    let active=true;let close:(()=>Promise<void>)|undefined
    void createInvoiceTestDb().then(async db=>{
      close=()=>db.close();if(!active){await db.close();return}
      await db.transaction(async tx=>{await tx.exec("set local ageful.allow_draft_migration='yes'");await tx.exec(manualPlan)})
      async function reload(){
        const rows=await db.query<{unit:Record<string,unknown>}>('select to_jsonb(u) as unit from billing_units u order by scheduled_date,id')
        const history=await db.query<{id:number;reason:string}>('select id,reason from billing_unit_events order by id desc')
        if(active){setUnits(rows.rows.map(({unit})=>({...billingUnitFromStorage(unit),
          collectionState:unit.collection_state as TransferBillingUnit['collectionState'],periodStart:unit.period_start as string|null,
          periodEnd:unit.period_end as string|null,planNote:unit.plan_note as string})));setEvents(history.rows);setVersion(v=>v+1)}
      }
      let pending:{id:string;fingerprint:string}|null=null
      saveRef.current=async(choices,reason)=>{
        const fingerprint=JSON.stringify({choices,reason})
        if(pending&&pending.fingerprint!==fingerprint)throw Error('前回の保存結果が未確認です。同じ内容で再試行してください')
        pending??={id:crypto.randomUUID(),fingerprint}
        try{await db.query('select write_manual_billing_plan($1,1,$2::jsonb,$3)',[pending.id,JSON.stringify(choices),reason])}
        catch(e){if(e&&typeof e==='object'&&'code' in e&&['P0001','23514','23503','23502','22P02','22007','22008'].includes(String(e.code)))pending=null;throw e}
        await reload();pending=null;if(active)setMessage('検証用DBへ予定と履歴を保存し、読み直しました。所有者・契約は変更していません。')
      }
      await reload();if(active)setMessage('架空データを読み込みました。')
    }).catch(e=>{if(active)setMessage(String(e))})
    return()=>{active=false;saveRef.current=null;if(close)void close()}
  },[])
  return <main style={{maxWidth:1000,margin:'24px auto',padding:20}}>
    <h1>サンプル発電所 ― 所有者変更の保存検証</h1>
    <p className="notice">架空データ専用です。保存先はこのページ内の一時DBで、再読み込みすると消えます。本番・所有者情報は変更しません。</p>
    <p role="status">{message}</p>
    {units&&<OwnershipBillingPlanEditor key={version} projectId={1} oldOwner={{id:1,name:'顧客A'}} newOwner={{id:2,name:'顧客B'}} units={units}
      onSave={async(choices,reason)=>{if(!saveRef.current)throw Error('準備中です');await saveRef.current(choices,reason)}}/>}
    <section className="card" style={{padding:20}}><h2>保存した変更履歴</h2>
      {!events.length?<p>保存履歴はありません。</p>:events.map(e=><p key={e.id}>記録 {e.id}：{e.reason}</p>)}
    </section>
  </main>
}
