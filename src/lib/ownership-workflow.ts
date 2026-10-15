import type {Prospect} from '../types'
export const isOwnershipProspect=(p:Prospect)=>p.ownership_project_id!=null
export const prospectCustomerId=(p:Prospect)=>isOwnershipProspect(p)?p.candidate_customer_id:p.converted_customer_id
export const ownershipProspectLabel=(p:Prospect)=>p.ownership_state==='completed'?'引継ぎ完了':p.ownership_state==='cancelled'?'取下げ':p.candidate_customer_id?'引継ぎ手続き中':'引継ぎ先未定'
/** Only task/finance metadata belongs to the prospective buyer; identity changes
 * use the atomic workflow endpoint and never legacy bidirectional sync. */
export function assertOwnershipProspectEdit(p:Prospect,data:Record<string,unknown>){
  if(!isOwnershipProspect(p))return
  if(p.ownership_state!=='open')throw Error('完了・取下げ済みの手続きは変更できません')
  const identity=['ownership_project_id','candidate_customer_id','ownership_state','converted_customer_id','converted_at','customer_name','customer_name_kana','project_name']
  if(Object.keys(data).some(k=>identity.includes(k)))throw Error('引継ぎ先は「引継ぎ先を設定」から変更してください')
}
