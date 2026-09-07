import { copyJson, canonicalJson } from './billing-json'
import { isBillingDate, type BillingUnit } from './billing-unit'

type Target = { id:string; sourceId:string|null; serviceYear:number; roundLabel:string; scheduledDate:string }
type Retire = { id:string; reason:string }
export type InvoiceScheduleChange = {
  projectId:number
  /** Exact confirmed input, including payer/amount/date/status. Not merely current owner. */
  expectedSourceSignature:string
  defaultRecipientId:number
  targets:Target[]
  retire:Retire[]
}

/** Explicit correspondence review only. Never saves a contract or deletes old plans. */
export function prepareInvoiceScheduleChange(source:readonly BillingUnit[], request:InvoiceScheduleChange) {
  const before=copyJson([...source]), r=copyJson(request)
  if (!Number.isSafeInteger(r.projectId) || r.projectId<=0
    || !Number.isSafeInteger(r.defaultRecipientId) || r.defaultRecipientId<=0) throw new Error('発電所・今後の請求先を確認してください')
  if (canonicalJson(before)!==r.expectedSourceSignature) throw new Error('確認後に請求情報が変わっています')
  if (before.some(u=>u.projectId!==r.projectId) || new Set(before.map(u=>u.id)).size!==before.length) throw new Error('元の請求回の対応が不正です')
  const planned=before.filter(u=>u.lifecycle==='planned')
  if (planned.some(u=>u.method!=='請求書' || u.issuedOn || u.receivedOn || u.frozenAt
    || u.frozenAmount!==null || u.frozenLineItems!==null)) throw new Error('未発行の請求書予定だけが対象です')
  if (new Set(r.targets.map(t=>t.id)).size!==r.targets.length) throw new Error('変更後の請求回IDが重複しています')
  const existingIds=r.targets.filter(t=>t.sourceId!==null).map(t=>t.sourceId!)
  const retiredIds=r.retire.map(t=>t.id)
  const covered=[...existingIds,...retiredIds]
  if (covered.length!==planned.length || new Set(covered).size!==covered.length
    || planned.some(u=>!covered.includes(u.id))) throw new Error('すべての未発行予定を残すか取りやめるか指定してください')
  for (const retired of r.retire) if (!retired.reason.trim()) throw new Error('予定を取りやめる理由が必要です')
  const next:BillingUnit[]=r.targets.map(target=>{
    if (!target.id.trim() || !target.roundLabel.trim() || !isBillingDate(target.scheduledDate)
      || !Number.isSafeInteger(target.serviceYear) || target.serviceYear<2000 || target.serviceYear>2200) throw new Error('変更後の年度・回・予定日を確認してください')
    if (target.sourceId===null) {
      if (before.some(u=>u.id===target.id)) throw new Error('追加予定には未使用のIDが必要です')
      return {id:target.id,projectId:r.projectId,serviceYear:target.serviceYear,roundLabel:target.roundLabel,
        method:'請求書',scheduledDate:target.scheduledDate,recipientId:r.defaultRecipientId,lifecycle:'planned',
        issuedOn:null,receivedOn:null,frozenAmount:null,frozenLineItems:null,frozenAt:null,revision:0}
    }
    const old=planned.find(u=>u.id===target.sourceId)
    if (!old || target.id!==old.id) throw new Error('既存の予定のIDは変更できません')
    const changed=old.serviceYear!==target.serviceYear || old.roundLabel!==target.roundLabel || old.scheduledDate!==target.scheduledDate
    // The one-off payer belongs to the stable occurrence ID, not the array position/date.
    return {...old,serviceYear:target.serviceYear,roundLabel:target.roundLabel,scheduledDate:target.scheduledDate,
      revision:old.revision+(changed?1:0)}
  })
  return {
    before, unchangedHistory:copyJson(before.filter(u=>u.lifecycle!=='planned')),
    planned:next,
    retired:r.retire.map(x=>({before:copyJson(planned.find(u=>u.id===x.id)!),reason:x.reason})),
    correspondence:r.targets.map(t=>({sourceId:t.sourceId,targetId:t.id})),
    readyToWrite:false as const,
  }
}
