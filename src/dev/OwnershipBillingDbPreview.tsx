import { useEffect,useRef,useState } from 'react'
import { OwnershipBillingPlanEditor } from '../components/OwnershipBillingPlanEditor'
import type { TransferBillingChoice,TransferBillingUnit } from '../lib/ownership-billing-plan'
import { billingUnitFromStorage } from '../lib/billing-unit-storage'
import { createInvoiceTestDb } from './invoice-test-db'
import manualPlan from '../../database/drafts/20260907_manual_billing_plan.sql?raw'
import detailChoices from '../../database/drafts/20260907_transfer_detail_choices.sql?raw'
import transfer from '../../database/drafts/20260907_transfer_ownership_manual.sql?raw'
import { InvoiceLedgerDetail } from '../components/InvoiceLedgerDetail'
import {createInvoiceWriteSession,type InvoiceWriteRequest} from '../lib/invoice-write-session'
import createDebit from '../../database/drafts/20260907_create_manual_debit_plan.sql?raw'
import {ManualDebitPlanCreator,type NewDebitPlan} from '../components/ManualDebitPlanCreator'

export function OwnershipBillingDbPreview(){
  const [units,setUnits]=useState<TransferBillingUnit[]|null>(null),[version,setVersion]=useState(0)
  const [message,setMessage]=useState('検証用DBを準備しています…'),[events,setEvents]=useState<{id:number;reason:string}[]>([])
  const [owner,setOwner]=useState(1),[date,setDate]=useState(''),[noteMode,setNoteMode]=useState('keep'),[note,setNote]=useState('')
  const [contractNote,setContractNote]=useState(''),[transferCount,setTransferCount]=useState(0)
  const [transfers,setTransfers]=useState<{id:number;from_customer_id:number;to_customer_id:number;transfer_date:string;contract_before:Record<string,unknown>;contract_after:Record<string,unknown>}[]>([])
  const writeRef=useRef<((request:InvoiceWriteRequest)=>Promise<unknown>)|null>(null)
  const addRef=useRef<((value:NewDebitPlan)=>Promise<void>)|null>(null)
  const editRef=useRef<((choices:TransferBillingChoice[],reason:string)=>Promise<void>)|null>(null)
  const saveRef=useRef<((choices:TransferBillingChoice[],reason:string,date:string,fields:object)=>Promise<void>)|null>(null)
  useEffect(()=>{
    let active=true;let close:(()=>Promise<void>)|undefined
    void createInvoiceTestDb().then(async db=>{
      close=()=>db.close();if(!active){await db.close();return}
      await db.transaction(async tx=>{await tx.exec("set local ageful.allow_draft_migration='yes'");
        await tx.exec("alter table customers add column name text; update customers set name=case id when 1 then '顧客A' else '顧客B' end; alter table projects add column customer_id bigint default 1, add column old_owner text; alter table contracts add column billing_method text default '請求書', add column notes text default 'Aの契約備考', add column ownership_transfer_date date; alter table annual_records add column contract_id bigint;");
        await tx.exec(manualPlan);await tx.exec(detailChoices);await tx.exec(transfer);await tx.exec(createDebit)})
      let parent:{project:Record<string,unknown>;contract:Record<string,unknown>}
      const today=(await db.query<{today:string}>('select current_date::text as today')).rows[0].today
      if(active)setDate(today)
      async function reload(){
        const rows=await db.query<{unit:Record<string,unknown>}>('select to_jsonb(u) as unit from billing_units u order by scheduled_date,id')
        const history=await db.query<{id:number;reason:string}>('select id,reason from billing_unit_events order by id desc')
        parent=(await db.query<{p:typeof parent}>("select jsonb_build_object('project',(select to_jsonb(p) from projects p where id=1),'contract',(select to_jsonb(c) from contracts c where id=1)) p")).rows[0].p
        const transferRows=(await db.query<(typeof transfers)[number]>('select id,from_customer_id,to_customer_id,transfer_date::text,contract_before,contract_after from ownership_transfers order by id desc')).rows
        if(active){setOwner(Number(parent.project.customer_id));setContractNote(String(parent.contract.notes??''));setTransferCount(transferRows.length);setTransfers(transferRows)}
        if(active){setUnits(rows.rows.map(({unit})=>({...billingUnitFromStorage(unit),
          collectionState:unit.collection_state as TransferBillingUnit['collectionState'],periodStart:unit.period_start as string|null,
          periodEnd:unit.period_end as string|null,planNote:unit.plan_note as string})));setEvents(history.rows);setVersion(v=>v+1)}
      }
      let pending:{id:string;fingerprint:string;source:typeof parent}|null=null
      saveRef.current=async(choices,reason,date,fields)=>{
        const fingerprint=JSON.stringify({choices,reason,date,fields})
        if(pending&&pending.fingerprint!==fingerprint)throw Error('前回の保存結果が未確認です。同じ内容で再試行してください')
        pending??={id:crypto.randomUUID(),fingerprint,source:structuredClone(parent)}
        try{await db.query('select transfer_ownership_manual($1,1,2,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7)',[pending.id,date,JSON.stringify(pending.source.project),JSON.stringify(pending.source.contract),JSON.stringify(fields),JSON.stringify(choices),reason])}
        catch(e){if(e&&typeof e==='object'&&'code' in e&&['P0001','23514','23503','23502','22P02','22007','22008'].includes(String(e.code)))pending=null;throw e}
        await reload();pending=null;if(active)setMessage('所有者・契約・請求予定・履歴を一括保存しました。')
      }
      const writer=createInvoiceWriteSession({operationId:()=>crypto.randomUUID(),reload,
        definitelyRejected:e=>!!e&&typeof e==='object'&&'code'in e&&['P0001','23514','23503','23502','22P02','22007','22008'].includes(String(e.code)),
        write:(id,r)=>r.mode.startsWith('debit_')?db.query('select record_manual_debit_result($1,$2,$3,$4,$5::jsonb,$6)',[id,r.unitId,r.revision,r.mode==='debit_correction'?'correction':r.mode==='debit_received'?'received':'invoice_switch',JSON.stringify(r.value),r.reason])
          :db.query('select write_invoice_unit($1,$2,$3,$4,$5::jsonb,$6)',[id,r.unitId,r.revision,r.mode,JSON.stringify(r.value),r.reason])})
      writeRef.current=r=>writer.save(r)
      function retryable<T>(action:(id:string,value:T)=>Promise<unknown>){
        let pending:{id:string;signature:string}|null=null
        return async(value:T)=>{const signature=JSON.stringify(value)
          if(pending&&pending.signature!==signature)throw Error('前回の結果を確認するため、同じ内容で再試行してください')
          pending??={id:crypto.randomUUID(),signature}
          try{await action(pending.id,value)}catch(e){if(e&&typeof e==='object'&&'code'in e&&['P0001','23514','23503','23502','22P02','22007','22008'].includes(String(e.code)))pending=null;throw e}
          await reload();pending=null
        }
      }
      addRef.current=retryable((id,v:NewDebitPlan)=>db.query('select create_manual_debit_plan($1,1,1,$2,$3,$4,$5,$6,$7,$8)',[id,v.recipient,v.year,v.month,v.date,v.amount,v.note,v.reason]))
      const edit=retryable((id,v:{choices:TransferBillingChoice[];reason:string})=>db.query('select write_manual_billing_plan($1,1,$2::jsonb,$3)',[id,JSON.stringify(v.choices),v.reason]))
      editRef.current=(choices,reason)=>edit({choices,reason})
      await reload();if(active)setMessage('架空データを読み込みました。')
    }).catch(e=>{if(active)setMessage(String(e))})
    return()=>{active=false;saveRef.current=null;if(close)void close()}
  },[])
  return <main style={{maxWidth:1000,margin:'24px auto',padding:20}}>
    <h1>サンプル発電所 ― 所有者変更の保存検証</h1>
    <p className="notice">架空データ専用です。保存先はこのページ内の一時DBで、再読み込みすると消えます。本番は変更しません。</p>
    <p role="status">{message}</p>
    <p>現在の所有者：{owner===1?'顧客A':'顧客B'} ／ 契約備考：{contractNote||'未記入'} ／ 移転履歴：{transferCount}件</p>
    {units&&owner===1&&<><section className="card" style={{padding:20}}>
      <label>移転日<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
      <label>契約備考<select value={noteMode} onChange={e=>setNoteMode(e.target.value)}><option value="keep">そのまま引き継ぐ</option><option value="change">変更して引き継ぐ</option><option value="clear">引き継がない</option></select></label>
      {noteMode==='change'&&<label>新しい契約備考<textarea value={note} onChange={e=>setNote(e.target.value)}/></label>}
    </section><OwnershipBillingPlanEditor key={`${version}-${date}-${noteMode}-${note}`} projectId={1} oldOwner={{id:1,name:'顧客A'}} newOwner={{id:2,name:'顧客B'}} units={units} saveScope="ownership"
      onSave={async(choices,reason)=>{if(!saveRef.current)throw Error('準備中です');await saveRef.current(choices,reason,date,{contract:{notes:noteMode==='change'?{mode:'change',value:note}:{mode:noteMode}}})}}/></>}
    {units&&owner===2&&<InvoiceLedgerDetail data={{units,recipientName:id=>id===1?'顧客A':'顧客B',projectName:()=> 'サンプル発電所',plannedAmount:()=>null,recipients:[{id:1,name:'顧客A'},{id:2,name:'顧客B'}]}} projectId={1}
      onSave={async r=>{if(!writeRef.current)throw Error('準備中です');return writeRef.current(r)}}/>}
    {units&&owner===2&&<><ManualDebitPlanCreator onSave={async v=>{if(!addRef.current)throw Error('準備中です');await addRef.current(v)}}/>
      <details className="card"><summary>未確認の予定を変更（請求書・口座振替）</summary><OwnershipBillingPlanEditor key={`edit-${version}`} projectId={1} oldOwner={{id:1,name:'顧客A'}} newOwner={{id:2,name:'顧客B'}} units={units}
        onSave={async(cs,reason)=>{if(!editRef.current)throw Error('準備中です');await editRef.current(cs,reason)}}/></details></>}
    <section className="card" style={{padding:20}}><h2>保存した変更履歴</h2>
      {!events.length?<p>保存履歴はありません。</p>:events.map(e=><p key={e.id}>記録 {e.id}：{e.reason}</p>)}
    </section>
    <section className="card" style={{padding:20}}><h2>所有者変更の履歴</h2>
      {!transfers.length?<p>所有者変更はまだありません。</p>:transfers.map(t=><div key={t.id}><h3>{t.transfer_date}：{t.from_customer_id===1?'顧客A':'顧客B'} → {t.to_customer_id===1?'顧客A':'顧客B'}</h3>
        <p>契約備考：{String(t.contract_before.notes??'未記入')} → {String(t.contract_after.notes??'未記入')}</p>
        <details><summary>保存した契約情報（監査用・金額計算には使用しません）</summary><pre style={{whiteSpace:'pre-wrap'}}>{JSON.stringify({変更前:t.contract_before,変更後:t.contract_after},null,2)}</pre></details>
      </div>)}
    </section>
  </main>
}
