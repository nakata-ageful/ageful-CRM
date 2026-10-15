import {customerStore,projectStore,contractStore,prospectStore,annualRecordStore,maintenanceResponseStore,periodicMaintenanceStore} from '../lib/mock-store'
import {contractFieldKinds,projectFieldKinds,prepareOwnershipFields} from '../lib/ownership-field-selection'
import {prepareOwnershipBillingPlan} from '../lib/ownership-billing-plan'
import type {BillingRuntimeSnapshot} from '../lib/billing-runtime'
import type {Contract,Project} from '../types'
import type {OwnershipTransferInput} from '../components/OwnershipTransferEditor'
export const billingRuntimeEnabled=true
let snapshot:BillingRuntimeSnapshot={units:[],events:[],transfers:[],managementEvents:[],cycleRules:[],ownershipWorkflowReady:true,ownershipWorkflowEvents:[],newProspectReady:true,cutoverOn:'2026-01-01'}
let seeded=false
export function seedFullDemo(){
  if(seeded)return;seeded=true
  for(const store of [customerStore,projectStore,prospectStore,annualRecordStore,maintenanceResponseStore,periodicMaintenanceStore])for(const row of store.getAll())store.delete(row.id)
  contractStore.getAll().splice(0)
  const blank={name_kana:null,company_name:null,company_name_kana:null,is_corporate:false,email:null,phone:null,postal_code:null,address:null,notes:null}
  const a=customerStore.create({...blank,name:'練習用 所有者A'});customerStore.create({...blank,name:'練習用 顧客B'})
  const p=projectStore.create({...Object.fromEntries(Object.keys(projectFieldKinds).map(k=>[k,null])),customer_id:a.id,project_name:'練習用発電所',plant_name:'練習用発電所'} as Omit<Project,'id'|'created_at'>)
  contractStore.create({...Object.fromEntries(Object.keys(contractFieldKinds).map(k=>[k,null])),project_id:p.id,billing_method:'請求書',billing_count:1,billing_schedule_days:['12月1日'],annual_maintenance_inc:165000,maintenance_start_date:'2026-01-01'} as Omit<Contract,'id'|'created_at'>)
  snapshot.units=[{id:'demo-next',projectId:p.id,serviceYear:2027,roundLabel:'第1回',method:'請求書',scheduledDate:'2026-12-01',recipientId:a.id,lifecycle:'planned',issuedOn:null,receivedOn:null,frozenAmount:null,frozenLineItems:null,frozenAt:null,plannedAmount:165000,revision:1,collectionState:'pending',periodStart:'2027-01-01',periodEnd:'2027-12-31'}]
  location.hash=`project-detail/${p.id}`
}
export async function loadBillingRuntime(){return structuredClone(snapshot)}
export async function hasPendingBillingRuntime(){return false}
type Request={action:string;value:Record<string,unknown>}
export async function saveBillingRuntime<T>(request:Record<string,unknown>|null,reload:()=>Promise<T>):Promise<T>{
  if(!request)throw Error('練習環境に未確認の保存はありません')
  const r=request as Request
  const workflow=r.action==='ownership_workflow',action=workflow?String(r.value.action):r.action
  const v=(workflow?r.value.value:r.value) as Record<string,unknown>
  const input=(workflow?v.transfer:v) as OwnershipTransferInput|undefined
  const id=Number(v.projectId??input?.project.id),p=projectStore.getById(id)
  if(!p)throw Error('練習用の発電所がありません')
  const before=structuredClone(p),pr=v.prospectId?prospectStore.getById(Number(v.prospectId)):null
  const candidate=v.customerId?customerStore.getById(Number(v.customerId)):null
  if(action==='start'){
    if(prospectStore.getAll().some(pr=>pr.ownership_project_id===id&&pr.ownership_state==='open'&&pr.candidate_customer_id===(candidate?.id??null)))throw Error('同じ引継ぎ先の見込みが登録済みです')
    prospectStore.create({customer_name:candidate?.name??'引継ぎ先未定',customer_name_kana:candidate?.name_kana??null,project_name:p.plant_name||p.project_name,ownership_project_id:id,candidate_customer_id:candidate?.id??null,ownership_state:'open',converted_customer_id:null,converted_at:null,loan_company:null,equipment:null,land_cost:null,loan_amount:null,apply_status:'未',contract_status:'未',apply_tasks:{},contract_tasks:{},apply_sub_tasks:{},contract_sub_tasks:{},apply_memo:null,contract_memo:null,site_address:null,panel_kw:null,sales_company:null,referrer:null,lead_date:null,apply_submit_date:null,apply_result_date:null,sale_contract_date:null,land_contract_date:null,loan_apply_date:null,handover_date:null})
  }else if(action==='candidate'){
    if(!pr||!candidate)throw Error('見込みと引継ぎ先を選択してください')
    prospectStore.update(pr.id,{candidate_customer_id:candidate.id,customer_name:candidate.name,customer_name_kana:candidate.name_kana})
  }else if(action==='cancel'){
    if(!pr)throw Error('見込みを指定してください');prospectStore.update(pr.id,{ownership_state:'cancelled'})
  }else if(action==='unknown'){
    if(!p.customer_id||!v.date||String(v.date)>new Date().toLocaleDateString('sv-SE'))throw Error('所有が終了した日を確認してください')
    projectStore.update(id,{customer_id:null,previous_owner_customer_id:p.customer_id,owner_unconfirmed_on:String(v.date)})
  }else if(action==='complete'||action==='transfer'){
    if(!input||workflow&&(!input.procedureConfirmed||!pr||pr.candidate_customer_id!==input.newOwner))throw Error('引継ぎ手続きを確認してください')
    if(input.choices.some(c=>'newOccurrence'in c))throw Error('この練習では登録済みの請求予定を使ってください。新規追加のチェックを外してください。')
    const choices=input.choices.filter(c=>'unitId'in c)
    prepareOwnershipBillingPlan({projectId:id,oldOwnerId:p.customer_id??p.previous_owner_customer_id!,newOwnerId:input.newOwner,units:snapshot.units.filter(u=>u.projectId===id),choices})
    const prepared=prepareOwnershipFields(p,input.contract,input.fields)
    contractStore.update(input.contract.id,{...prepared.after.contract,ownership_transfer_date:input.date} as Partial<Contract>)
    projectStore.update(id,{customer_id:input.newOwner,previous_owner_customer_id:p.customer_id??p.previous_owner_customer_id,owner_unconfirmed_on:null})
    snapshot.units=snapshot.units.map(u=>{const c=choices.find(c=>c.unitId===u.id);return c?{...u,recipientId:c.recipientId,scheduledDate:c.scheduledDate,plannedAmount:c.plannedAmount,periodStart:c.periodStart,periodEnd:c.periodEnd,revision:u.revision+1}:u})
    if(pr)prospectStore.update(pr.id,{ownership_state:'completed'})
    snapshot.transfers.push({id:snapshot.transfers.length+1,project_id:id,from_customer_id:before.customer_id??before.previous_owner_customer_id,to_customer_id:input.newOwner,transfer_date:input.date,contract_before:input.contract,contract_after:prepared.after.contract})
  }else throw Error('この練習環境は所有者引継ぎの操作用です。この保存操作には対応していません。')
  snapshot.ownershipWorkflowEvents!.push({operation_key:crypto.randomUUID(),project_id:id,prospect_id:pr?.id??null,action,effective_on:new Date().toLocaleDateString('sv-SE'),created_at:new Date().toISOString(),reason:'架空データの操作練習',before_snapshot:{project:before},after_snapshot:{project:projectStore.getById(id)}})
  return reload()
}
