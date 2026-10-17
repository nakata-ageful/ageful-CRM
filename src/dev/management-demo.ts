// Operator-demo only: synthetic in-memory effects. Never imported by production App.
// Uses the real UI/pure validators, not the hosted DB transaction implementation.
import {customerStore,projectStore,contractStore} from '../lib/mock-store'
import {contractFieldKinds,projectFieldKinds} from '../lib/ownership-field-selection'
import {validateManagementRequest,type ManagementRequest} from '../lib/management-lifecycle'
import {prepareOwnershipBillingPlan,type TransferBillingUnit,type TransferBillingChoice} from '../lib/ownership-billing-plan'
import {maintenanceSchedule,type MaintenanceScheduleItem} from '../lib/maintenance-schedule'
import {isBillingDate} from '../lib/billing-unit'
import {validateIndividualPeriod} from '../lib/individual-maintenance-period'
import type {BillingRuntimeSnapshot} from '../lib/billing-runtime'
import type {Contract,Project} from '../types'

export function seedManagementPractice(snapshot:BillingRuntimeSnapshot){
  const owner=customerStore.getAll()[0],year=new Date().getFullYear()
  let first=0
  for(const [index,label] of ['管理の終了・再開','請求予定を追加','振替・予定変更'].entries()){
    const name=`練習${['①','②','③'][index]} ${label}`
    const p=projectStore.create({...Object.fromEntries(Object.keys(projectFieldKinds).map(k=>[k,null])),customer_id:owner.id,
      project_name:name,plant_name:name,notes:'練習用の架空発電所。本番DBには保存されません。再読み込みで最初に戻ります。'} as Omit<Project,'id'|'created_at'>)
    first||=p.id
    contractStore.create({...Object.fromEntries(Object.keys(contractFieldKinds).map(k=>[k,null])),project_id:p.id,billing_method:'請求書',billing_count:1,
      billing_schedule_days:['12月1日'],annual_maintenance_inc:165000,maintenance_start_date:`${year-1}-01-01`} as Omit<Contract,'id'|'created_at'>)
    const paid=unit(snapshot,p.id,owner.id,year-1,`${year-1}-12-01`,165000)
    Object.assign(paid,{lifecycle:'received',issuedOn:`${year-1}-12-01`,receivedOn:`${year-1}-12-20`,frozenAmount:165000,
      frozenLineItems:[{name:'保守料',amount:165000}],frozenAt:`${year-1}-12-01T00:00:00Z`,collectionState:'succeeded'})
    snapshot.units.push(paid)
    if(index!==1)snapshot.units.push(unit(snapshot,p.id,owner.id,year,`${year}-12-01`,165000))
  }
  return first
}
function unit(snapshot:BillingRuntimeSnapshot,projectId:number,recipientId:number,year:number,date:string,amount:number|null):TransferBillingUnit{
  return {id:String(Math.max(1000,...snapshot.units.map(u=>Number(u.id)||0))+1),projectId,recipientId,recipientSource:'confirmed',serviceYear:year,roundLabel:'第1回',method:'請求書',
    scheduledDate:date,issuedOn:null,receivedOn:null,paymentDueOn:null,lifecycle:'planned',collectionState:'pending',frozenAmount:null,frozenLineItems:null,frozenAt:null,
    plannedAmount:amount,revision:0,periodStart:`${year}-01-01`,periodEnd:`${year}-12-31`,planNote:'練習用'}
}
function stored(u:TransferBillingUnit){return {id:Number(u.id),project_id:u.projectId,service_year:u.serviceYear,round_number:/^第(\d+)回$/.exec(u.roundLabel)?.[1],
  service_month:/^(\d+)月分$/.exec(u.roundLabel)?.[1],recipient_customer_id:u.recipientId,collection_method:u.method==='請求書'?'invoice':'direct_debit',
  lifecycle:u.lifecycle,scheduled_date:u.scheduledDate,planned_amount:u.plannedAmount,frozen_amount:u.frozenAmount,issued_on:u.issuedOn,received_on:u.receivedOn,
  period_start:u.periodStart,period_end:u.periodEnd,revision:u.revision,plan_note:u.planNote}}
function audit(s:BillingRuntimeSnapshot,type:string,before:TransferBillingUnit|null,after:TransferBillingUnit,reason:string){
  s.events.push({id:s.events.length+1,project_id:after.projectId,billing_unit_id:Number(after.id),event_type:type,recorded_at:new Date().toISOString(),
    reason,before_value:before?stored(before):null,after_value:stored(after)})
}
export function applyManagementPractice(snapshot:BillingRuntimeSnapshot,action:string,v:Record<string,unknown>):BillingRuntimeSnapshot|null{
  if(!['management','plan','future_schedule','debit_add','service_period'].includes(action))return null
  const s=structuredClone(snapshot),projectId=Number(v.projectId),p=projectStore.getById(projectId),c=contractStore.getByProjectId(projectId)
  if(!p||!c)throw Error('練習用発電所を確認してください')
  const own=s.units.filter(u=>u.projectId===projectId),reason=String(v.reason??'').trim()
  if(!reason)throw Error('確認内容を入力してください')
  if(action==='management'){
    const r=v as unknown as ManagementRequest
    validateManagementRequest(r,s.managementEvents,own)
    for(const choice of r.choices){
      const u=s.units.find(u=>u.id===choice.unitId)!,before=structuredClone(u)
      if(choice.action==='keep')continue
      if(choice.action==='cancel')u.lifecycle='cancelled';else u.plannedAmount=choice.amount
      u.revision++;audit(s,choice.action==='cancel'?'cancelled':'plan_changed',before,u,reason)
    }
    s.managementEvents.push({id:Math.max(0,...s.managementEvents.map(e=>e.id))+1,project_id:projectId,scope:r.scope,action:r.action,effective_date:r.date,reason})
  }else if(action==='plan'){
    const prepared=prepareOwnershipBillingPlan({projectId,oldOwnerId:p.customer_id??0,newOwnerId:p.customer_id??0,units:own,
      choices:v.choices as TransferBillingChoice[],allowedRecipientIds:customerStore.getAll().map(c=>c.id)})
    for(const choice of prepared.changes){const u=s.units.find(u=>u.id===choice.unitId)!,before=structuredClone(u)
      Object.assign(u,{recipientId:choice.recipientId,method:choice.method,scheduledDate:choice.scheduledDate,plannedAmount:choice.plannedAmount,
        periodStart:choice.periodStart,periodEnd:choice.periodEnd,planNote:choice.note,revision:u.revision+1});audit(s,'plan_changed',before,u,reason)}
  }else if(action==='future_schedule'){
    if(!Array.isArray(v.items)||!v.items.length)throw Error('追加する回を選択してください')
    for(const item of v.items as MaintenanceScheduleItem[]){
      const candidates=maintenanceSchedule(c,item.year,item.recipientId,s.units.filter(u=>u.projectId===projectId),s.managementEvents,
        {periodStart:item.periodStart,periodEnd:item.periodEnd},s.cycleRules)
      const candidate=candidates.find(i=>i.round===item.round)
      if(!candidate||candidate.exclusion||!isBillingDate(item.date)||item.amount!==null&&(!Number.isSafeInteger(item.amount)||item.amount<0))throw Error(candidate?.exclusion??'追加する回を確認してください')
      const u=unit(s,projectId,item.recipientId,item.year,item.date,item.amount)
      Object.assign(u,{roundLabel:`第${item.round}回`,method:item.method==='invoice'?'請求書':'口座振替',periodStart:item.periodStart,periodEnd:item.periodEnd})
      s.units.push(u);audit(s,'created',null,u,reason)
    }
  }else if(action==='debit_add'){
    const year=Number(v.year),month=Number(v.month),recipient=Number(v.recipient),amount=v.amount===null?null:Number(v.amount)
    if(!Number.isInteger(year)||year<2000||year>2200||!Number.isInteger(month)||month<1||month>12||!isBillingDate(String(v.date))
      ||!customerStore.getById(recipient)||amount!==null&&(!Number.isSafeInteger(amount)||amount<0))throw Error('対象年月・日付・金額を確認してください')
    if(own.some(u=>u.serviceYear===year&&u.roundLabel===`${month}月分`))throw Error('この月の予定は登録済みです')
    const u=unit(s,projectId,recipient,year,String(v.date),amount)
    Object.assign(u,{roundLabel:`${month}月分`,method:'口座振替',periodStart:null,periodEnd:null,planNote:String(v.note??'')})
    s.units.push(u);audit(s,'created',null,u,reason)
  }else{
    const year=Number(v.year),period=validateIndividualPeriod({periodStart:String(v.periodStart),periodEnd:String(v.periodEnd)},year,projectId,own.filter(u=>u.serviceYear!==year),c.maintenance_start_date)
    for(const u of s.units.filter(u=>u.projectId===projectId&&u.serviceYear===year)){const before=structuredClone(u);Object.assign(u,period,{revision:u.revision+1});audit(s,'corrected',before,u,reason)}
  }
  return s
}
