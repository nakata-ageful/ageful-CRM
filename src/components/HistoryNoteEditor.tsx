import {useRef,useState} from 'react'
import {historyNoteState,type HistoryNote,type HistoryNoteKind,type HistoryNoteRequest} from '../lib/history-notes'
import {historyDate} from '../lib/change-history-display'

export function HistoryNoteEditor({projectId,kind,targetId,original,notes=[],onSave}:{projectId:number;kind:HistoryNoteKind;targetId:string;original:string;
  notes?:readonly HistoryNote[];onSave?:(request:HistoryNoteRequest)=>Promise<void>}){
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('')
  const [editRevision,setEditRevision]=useState(0)
  const locked=useRef(false)
  let current:ReturnType<typeof historyNoteState>
  try{current=historyNoteState(notes,kind,targetId,original,projectId)}catch(e){return <p role="alert">{e instanceof Error?e.message:String(e)}</p>}
  async function save(){
    if(!onSave||locked.current||editRevision!==current.revision||!draft.trim()||draft.trim()===current.text||draft.trim().length>4000)return
    locked.current=true;setBusy(true);setError('')
    try{await onSave({projectId,kind,targetId,expectedRevision:editRevision,text:draft.trim()});setEditing(false)}
    catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{locked.current=false;setBusy(false)}
  }
  return <div className="history-note">
    <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>確認内容：{current.text||'記録なし'}{current.revision>0&&<small>（訂正済み）</small>}</p>
    {!editing&&onSave&&<button type="button" className="btn btn-sub btn-sm" onClick={()=>{setDraft(current.text);setEditRevision(current.revision);setError('');setEditing(true)}}>確認内容を編集</button>}
    {editing&&<fieldset disabled={busy} style={{border:0,padding:0,minWidth:0}}>
      <label className="form-label">確認内容<textarea className="form-input" rows={4} maxLength={4000} value={draft} onChange={e=>setDraft(e.target.value)} style={{width:'100%',boxSizing:'border-box'}}/></label>
      <p>文章だけを修正します。所有者・変更日・請求は変わりません。訂正前の文章も残ります。</p>
      {editRevision!==current.revision&&<p role="alert">確認内容が更新されています。キャンセルして、最新の文章から編集し直してください。</p>}
      <div style={{display:'flex',flexWrap:'wrap',gap:8}}><button type="button" className="btn btn-sub" onClick={()=>{setEditing(false);setError('')}}>キャンセル</button>
        <button type="button" className="btn btn-main" disabled={editRevision!==current.revision||!draft.trim()||draft.trim()===current.text||draft.trim().length>4000} onClick={()=>void save()}>{busy?'保存中…':'確認内容を保存'}</button></div>
    </fieldset>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {current.changes.length>0&&<details style={{marginTop:8}}><summary>訂正履歴（{current.changes.length}件）</summary>
      <p style={{whiteSpace:'pre-wrap'}}>最初の内容：{original||'記録なし'}</p>
      {current.changes.map(n=><p key={n.operation_key} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{historyDate(n.created_at)}：{n.text}</p>)}
    </details>}
  </div>
}
