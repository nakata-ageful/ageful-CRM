import {useState} from 'react'
import {Modal} from './Modal'
import {historyDate,historyFields,historyValue} from '../lib/change-history-display'
import {HistoryNoteEditor} from './HistoryNoteEditor'
import type {HistoryNote,HistoryNoteRequest} from '../lib/history-notes'

const labels:Record<string,string>={start:'引継ぎの見込みを登録',candidate:'引継ぎ先を設定',unknown:'所有者を未確認として登録',complete:'引継ぎ手続きを完了',cancel:'引継ぎ候補を取下げ'}
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
export function OwnershipWorkflowHistory({events,recipientName,onViewProspect,historyNotes=[],onSaveHistoryNote}:{events:readonly Record<string,unknown>[];recipientName:(id:number)=>string;onViewProspect?:(id:number)=>void;
  historyNotes?:readonly HistoryNote[];onSaveHistoryNote?:(request:HistoryNoteRequest)=>Promise<void>}){
  const [selected,setSelected]=useState<Record<string,unknown>|null>(null)
  const person=(id:unknown)=>typeof id==='number'&&id>0?recipientName(id):'未確認'
  const before=selected?obj(selected.before_snapshot):{},after=selected?obj(selected.after_snapshot):{}
  const contracts=Array.isArray(before.contract)?before.contract:[],fields=historyFields({},contracts[0],'contract',true)
  const note=(e:Record<string,unknown>,editable=false)=><HistoryNoteEditor key={`workflow:${e.operation_key}`} projectId={Number(e.project_id)} kind="workflow" targetId={String(e.operation_key)}
    original={String(e.reason??'')} notes={historyNotes} onSave={editable?onSaveHistoryNote:undefined}/>
  if(!events.length)return null
  return <section className="card change-history"><h3>引継ぎ手続きの履歴</h3><ol className="history-list">
    {[...events].reverse().map(e=><li className="history-entry" key={String(e.operation_key)}>
      <div className="history-entry-meta"><time>{historyDate(String(e.created_at))}</time></div>
      <div className="history-entry-body"><h4>{labels[String(e.action)]??'引継ぎ手続き'}</h4>{e.effective_on!=null&&<p>所有が終了した日：{String(e.effective_on)}</p>}{note(e)}</div>
      <button type="button" className="btn btn-sub" onClick={()=>setSelected(e)}>詳細を見る</button>
    </li>)}
  </ol>{selected&&<Modal title={labels[String(selected.action)]??'引継ぎ手続き'} width={900} onClose={()=>setSelected(null)}>
    <div className="history-detail"><p>記録日：{historyDate(String(selected.created_at))}</p>
      <p>現在の所有者：{person(obj(before.project).customer_id)} → {person(obj(after.project).customer_id)}</p>
      <p>引継ぎ先：{person(obj(after.prospect).candidate_customer_id)}</p>{note(selected,true)}
      {selected.prospect_id!=null&&onViewProspect&&<button type="button" className="btn btn-sub" onClick={()=>{onViewProspect(Number(selected.prospect_id));setSelected(null)}}>見込みを開く</button>}
      {!!fields.length&&<><h4>この操作前に保存した契約情報</h4><div className="history-diff-scroll"><table className="history-diff-table"><thead><tr><th>項目</th><th>当時の内容</th></tr></thead><tbody>{fields.map(f=><tr key={f.key}><th>{f.label}</th><td>{historyValue(f.key,f.after,recipientName)}</td></tr>)}</tbody></table></div></>}
    </div>
  </Modal>}</section>
}
