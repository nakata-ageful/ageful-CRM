import type {CoverageCandidate} from './billing-cutover-coverage'
import type {TransferBillingUnit} from './ownership-billing-plan'

/** Read-only correspondence review shared by the UI and migration rehearsal. */
export function reviewFutureSchedule(candidates:readonly CoverageCandidate[],units:readonly TransferBillingUnit[]){
 return candidates.map(candidate=>{
  const own=units.filter(u=>u.projectId===candidate.projectId),year=Number(candidate.date.slice(0,4)),month=Number(candidate.date.slice(5,7))
  let exclusion:string|undefined
  if(own.some(u=>u.lifecycle==='planned'&&!u.scheduledDate))exclusion='日付未設定の請求予定があります'
  else if(candidates.filter(c=>c.projectId===candidate.projectId&&c.date===candidate.date).length>1)exclusion='同じ日に複数回の候補があります'
  else {
   const existing=own.find(u=>u.scheduledDate===candidate.date||u.serviceYear===year&&(
    candidate.method==='invoice'&&u.roundLabel.endsWith('月分')||candidate.method==='direct_debit'&&u.roundLabel.startsWith('第')||
    candidate.method==='invoice'&&u.roundLabel===`第${candidate.round}回`||u.roundLabel===`${month}月分`||u.roundLabel==='保存済み単回記録'))
   if(existing)exclusion=existing.lifecycle==='cancelled'?'取りやめた回があります（自動で復活しません）'
    :existing.scheduledDate===candidate.date?'同じ日の記録が保存されています'
    :`${existing.roundLabel}と対応確認が必要です（日付・方法の変更を含む）`
  }
  return {candidate,exclusion}
 })
}
