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
import {OwnershipTransferEditor,type OwnershipTransferInput} from '../components/OwnershipTransferEditor'
import {contractFieldKinds,projectFieldKinds} from '../lib/ownership-field-selection'
import type {Contract,Project,Customer} from '../types'
import futureSql from '../../database/drafts/20260914_future_schedule.sql?raw'
import {FutureScheduleEditor} from '../components/FutureScheduleEditor'
import managementSql from '../../database/drafts/20260914_management_lifecycle.sql?raw'
import {ManagementLifecycleEditor} from '../components/ManagementLifecycleEditor'
import {managementEventFromStorage,type ManagementEvent,type ManagementRequest} from '../lib/management-lifecycle'

export function OwnershipBillingDbPreview(){
  const [units,setUnits]=useState<TransferBillingUnit[]|null>(null),[version,setVersion]=useState(0)
  const [message,setMessage]=useState('検証用DBを準備しています…'),[events,setEvents]=useState<{id:number;reason:string}[]>([])
  const [owner,setOwner]=useState(1)
  const [parents,setParents]=useState<{project:Project;contract:Contract}|null>(null)
  const [contractNote,setContractNote]=useState(''),[transferCount,setTransferCount]=useState(0)
  const [transfers,setTransfers]=useState<{id:number;from_customer_id:number;to_customer_id:number;transfer_date:string;contract_before:Record<string,unknown>;contract_after:Record<string,unknown>}[]>([])
  const writeRef=useRef<((request:InvoiceWriteRequest)=>Promise<unknown>)|null>(null)
  const addRef=useRef<((value:NewDebitPlan)=>Promise<void>)|null>(null)
  const editRef=useRef<((choices:TransferBillingChoice[],reason:string)=>Promise<void>)|null>(null)
  const saveRef=useRef<((input:OwnershipTransferInput)=>Promise<void>)|null>(null)
  const managementRef=useRef<((input:ManagementRequest)=>Promise<void>)|null>(null)
  const futureRef=useRef<((input:Record<string,unknown>)=>Promise<void>)|null>(null)
  const [managementEvents,setManagementEvents]=useState<ManagementEvent[]>([])
  useEffect(()=>{
    let active=true;let close:(()=>Promise<void>)|undefined
    void createInvoiceTestDb().then(async db=>{
      close=()=>db.close();if(!active){await db.close();return}
      await db.transaction(async tx=>{await tx.exec("set local ageful.allow_draft_migration='yes'");
        await tx.exec("alter table customers add column name text; update customers set name=case id when 1 then '顧客A' else '顧客B' end; alter table projects add column customer_id bigint default 1, add column old_owner text; alter table contracts add column billing_method text default '請求書', add column notes text default 'Aの契約備考', add column ownership_transfer_date date; alter table annual_records add column contract_id bigint;");
        for(const [table,kinds] of [['contracts',contractFieldKinds],['projects',projectFieldKinds]] as const){
          const present=new Set((await tx.query<{column_name:string}>("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[table])).rows.map(r=>r.column_name))
          for(const [key,kind] of Object.entries(kinds))if(!present.has(key))await tx.exec(`alter table ${table} add column ${key} ${kind==='number'?'numeric':kind==='boolean'?'boolean':kind==='date'?'date':['flags','amounts','strings'].includes(kind)?'jsonb':'text'}`)
        }
        await tx.exec("update projects set project_name='サンプル発電所'; update contracts set billing_count=1,billing_schedule_days='[\"6月15日\"]',annual_maintenance_inc=82500;")
        await tx.exec(manualPlan);await tx.exec(detailChoices);await tx.exec(transfer);await tx.exec(createDebit);await tx.exec(managementSql);await tx.exec(futureSql)})
      let parent:{project:Record<string,unknown>;contract:Record<string,unknown>}
      async function reload(){
        const rows=await db.query<{unit:Record<string,unknown>}>('select to_jsonb(u) as unit from billing_units u order by scheduled_date,id')
        const history=await db.query<{id:number;reason:string}>('select id,reason from billing_unit_events order by id desc')
        const managementRows=(await db.query<{row:Record<string,unknown>}>('select to_jsonb(m) row from project_management_events m order by id')).rows
        if(active)setManagementEvents(managementRows.map(r=>managementEventFromStorage(r.row)))
        parent=(await db.query<{p:typeof parent}>("select jsonb_build_object('project',(select to_jsonb(p) from projects p where id=1),'contract',(select to_jsonb(c) from contracts c where id=1)) p")).rows[0].p
        const transferRows=(await db.query<(typeof transfers)[number]>('select id,from_customer_id,to_customer_id,transfer_date::text,contract_before,contract_after from ownership_transfers order by id desc')).rows
        if(active){setParents(structuredClone(parent) as {project:Project;contract:Contract});setOwner(Number(parent.project.customer_id));setContractNote(String(parent.contract.notes??''));setTransferCount(transferRows.length);setTransfers(transferRows)}
        if(active){setUnits(rows.rows.map(({unit})=>({...billingUnitFromStorage(unit),
          collectionState:unit.collection_state as TransferBillingUnit['collectionState'],periodStart:unit.period_start as string|null,
          periodEnd:unit.period_end as string|null,planNote:unit.plan_note as string})));setEvents(history.rows);setVersion(v=>v+1)}
      }
      let pending:{id:string;fingerprint:string;source:typeof parent}|null=null
      saveRef.current=async({choices,reason,date,fields,newOwner,futureRecipient})=>{
        const fingerprint=JSON.stringify({choices,reason,date,fields,newOwner,futureRecipient})
        if(pending&&pending.fingerprint!==fingerprint)throw Error('前回の保存結果が未確認です。同じ内容で再試行してください')
        pending??={id:crypto.randomUUID(),fingerprint,source:structuredClone(parent)}
        try{await db.query('select transfer_ownership_manual($1,1,$8,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb,$7,$9)',[pending.id,date,JSON.stringify(pending.source.project),JSON.stringify(pending.source.contract),JSON.stringify(fields),JSON.stringify(choices),reason,newOwner,futureRecipient])}
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
      managementRef.current=retryable((id,r:ManagementRequest)=>db.query('select write_management_lifecycle($1,$2,$3,$4,$5,$6,$7::jsonb,$8)',[id,r.projectId,r.expectedLast,r.scope,r.action,r.date,JSON.stringify(r.choices),r.reason]))
      futureRef.current=retryable((id,r:Record<string,unknown>)=>db.query('select create_future_schedule($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7)',[id,r.projectId,JSON.stringify(r.contract),JSON.stringify(r.versions),r.last,JSON.stringify(r.items),r.reason]))
      await reload();if(active)setMessage('架空データを読み込みました。')
    }).catch(e=>{if(active)setMessage(String(e))})
    return()=>{active=false;saveRef.current=null;if(close)void close()}
  },[])
  return <main style={{maxWidth:1000,margin:'24px auto',padding:20}}>
    <h1>サンプル発電所 ― 所有者変更の保存検証</h1>
    <p className="notice">架空データ専用です。保存先はこのページ内の一時DBで、再読み込みすると消えます。本番は変更しません。</p>
    <p role="status">{message}</p>
    <p>現在の所有者：{owner===1?'顧客A':'顧客B'} ／ 契約備考：{contractNote||'未記入'} ／ 移転履歴：{transferCount}件</p>
    {units&&<ManagementLifecycleEditor key={`management-${version}`} projectId={1} events={managementEvents} units={units} onSave={async r=>{if(!managementRef.current)throw Error('準備中です');await managementRef.current(r)}}/>}
    {units&&parents&&<FutureScheduleEditor key={`future-${version}`} row={{project_id:1,project_name:'サンプル発電所',customer_name:'顧客A',company_name:null,contract:parents.contract,records:[],currentYearRecord:null,currentYearRecords:[],currentYear:2026}} customers={[{id:1,name:'顧客A'},{id:2,name:'顧客B'}] as Customer[]} units={units} events={managementEvents} onSave={async r=>{if(!futureRef.current)throw Error('準備中です');await futureRef.current(r)}}/>}
    {units&&parents&&<OwnershipTransferEditor key={`transfer-${transferCount}`} {...parents} customers={[{id:1,name:'顧客A'},{id:2,name:'顧客B'}]} units={units} testOnly onSave={async input=>{if(!saveRef.current)throw Error('準備中です');await saveRef.current(input)}}/>}
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
