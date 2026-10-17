import {useEffect,useRef,useState} from 'react'
import {definiteTodoRejection,loadProjectTodos,parseProjectTodo,saveProjectTodo,validateTodoChange,type ProjectTodo,type TodoChange} from '../lib/project-todos'
import './ProjectTodoPanel.css'

const errorText=(e:unknown)=>e instanceof Error?e.message:typeof e==='object'&&e&&'message'in e?String(e.message):'通信に失敗しました。'
const day=(value:string)=>new Date(value).toLocaleDateString('ja-JP')
export function ProjectTodoPanel({projectId,readOnly=false,load=loadProjectTodos,save=saveProjectTodo}:{
 projectId:number;readOnly?:boolean;load?:(projectId:number)=>Promise<ProjectTodo[]>;save?:(change:TodoChange)=>Promise<ProjectTodo>
}){
 const [items,setItems]=useState<ProjectTodo[]>([]),[ready,setReady]=useState(false),[busy,setBusy]=useState(false)
 const [content,setContent]=useState(''),[editing,setEditing]=useState<string|null>(null),[draft,setDraft]=useState('')
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[pending,setPending]=useState<TodoChange|null>(null),[retry,setRetry]=useState(false)
 const mounted=useRef(false),lock=useRef(false),readVersion=useRef(0)
 useEffect(()=>{
  mounted.current=true;const version=++readVersion.current;setReady(false);setError('')
  void load(projectId).then(rows=>{if(mounted.current&&readVersion.current===version){setItems(rows.map(t=>parseProjectTodo(t,projectId)));setReady(true)}})
   .catch(e=>{if(mounted.current&&readVersion.current===version)setError(`Todoを読み込めませんでした。${errorText(e)}`)})
  return()=>{mounted.current=false;readVersion.current++}
 },[projectId,load])
 async function reload(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('')
  try{
   const rows=(await load(projectId)).map(t=>parseProjectTodo(t,projectId));if(!mounted.current)return
   setItems(rows);setReady(true)
   if(pending){const found=rows.find(t=>t.id===pending.id)
    if(found&&(pending.revision===null||found.content===pending.content&&found.is_completed===pending.completed)){
     if(pending.revision===null)setContent('');else{setEditing(null);setDraft('')}
     setPending(null);setRetry(false);setNotice('保存できていることを確認しました。')
    }else if(pending.revision!==null&&(!found||found.revision!==pending.revision)){
     setPending(null);setRetry(false);setEditing(null);setDraft('');setError('Todoの内容が変わっています。最新の一覧を確認してから操作してください。')
    }else{setRetry(true);setError('保存を確認できません。同じ内容でもう一度保存できます。')}
   }
  }catch(e){if(mounted.current){setReady(false);setError(`Todoを読み込めませんでした。${errorText(e)}`)}}
  finally{lock.current=false;if(mounted.current)setBusy(false)}
 }
 async function write(request:TodoChange){
  if(readOnly||lock.current||!ready)return
  let change:TodoChange;try{change=validateTodoChange(request)}catch(e){setError(errorText(e));return}
  lock.current=true;setBusy(true);setError('');setNotice('');setRetry(false)
  try{
   const result=parseProjectTodo(await save(change),projectId);if(result.id!==change.id)throw Error('保存したTodoを確認できません。')
   if(!mounted.current)return
   setItems(previous=>[...previous.filter(t=>t.id!==result.id),result])
   if(change.revision===null)setContent('');else{setEditing(null);setDraft('')}
   setPending(null);setNotice(change.revision===null?'Todoを追加しました。':change.completed?'完了にしました。':'Todoを保存しました。')
  }catch(e){if(mounted.current){const rejected=definiteTodoRejection(e);setError(`${rejected?'保存できませんでした。':'保存できたか確認してください。'}${errorText(e)}`);setPending(rejected?null:change)}}
  finally{lock.current=false;if(mounted.current)setBusy(false)}
 }
 const disabled=readOnly||busy||!ready||!!pending
 function list(completed:boolean){
  const rows=items.filter(t=>t.is_completed===completed).sort((a,b)=>(completed?(b.completed_at??'').localeCompare(a.completed_at??''):b.created_at.localeCompare(a.created_at))||a.id.localeCompare(b.id))
  return <section className="card project-todo-list"><div className="card-header-row"><h3 className="section-title">{completed?'完了':'未完了'}（{rows.length}件）</h3></div>
   <div className="project-todo-scroll"><table className="data-table"><thead><tr><th>タスク</th><th>{completed?'完了日':'追加日'}</th><th>操作</th></tr></thead><tbody>
    {!rows.length&&<tr><td colSpan={3} className="empty-cell">{completed?'完了したTodoはありません':'未完了のTodoはありません'}</td></tr>}
    {rows.map(t=><tr key={t.id}><td className="project-todo-content">{editing===t.id?<form onSubmit={e=>{e.preventDefault();void write({id:t.id,projectId,revision:t.revision,content:draft,completed:t.is_completed})}}>
     <label>タスクを編集<textarea className="form-input" autoFocus rows={2} required maxLength={2000} value={draft} disabled={disabled} onChange={e=>setDraft(e.target.value)}/></label>
     <div className="project-todo-actions"><button type="submit" className="btn btn-main btn-sm" disabled={disabled||!draft.trim()}>保存</button><button type="button" className="btn btn-sub btn-sm" disabled={disabled} onClick={()=>{setEditing(null);setDraft('')}}>キャンセル</button></div>
    </form>:<span className={completed?'project-todo-done':''}>{t.content}</span>}</td><td className="project-todo-date">{day(completed?t.completed_at!:t.created_at)}</td><td>
     <div className="project-todo-actions"><button className="btn btn-sub btn-sm" type="button" disabled={disabled||!!editing} onClick={()=>void write({id:t.id,projectId,revision:t.revision,content:t.content,completed:!t.is_completed})}>{completed?'未完了に戻す':'完了にする'}</button>
     <button className="btn btn-sub btn-sm" type="button" disabled={disabled||!!editing} onClick={()=>{setEditing(t.id);setDraft(t.content);setError('');setNotice('')}}>編集</button></div>
    </td></tr>)}
   </tbody></table></div>
  </section>
 }
 return <div className="project-todo-panel"><div className="project-todo-heading"><h2>Todo</h2><button className="btn btn-sub btn-sm" type="button" disabled={busy||!!editing&&!pending} onClick={()=>void reload()}>{pending?'保存結果を再確認':'再読み込み'}</button></div>
  {readOnly&&<p className="notice">保管中の発電所のため、Todoは閲覧のみです。</p>}
  {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
  {pending&&<div className="notice"><p>入力は残しています。再読み込みや別の追加をせず、まず「保存結果を再確認」を押してください。</p>{retry&&<button className="btn btn-sub" type="button" disabled={busy||readOnly} onClick={()=>void write(pending)}>同じ内容で再保存</button>}</div>}
  {!readOnly&&<form className="card project-todo-add" onSubmit={e=>{e.preventDefault();if(!disabled&&!editing)void write({id:crypto.randomUUID(),projectId,revision:null,content,completed:false})}}><label htmlFor={`todo-add-${projectId}`}>やることを追加</label><div><textarea id={`todo-add-${projectId}`} className="form-input" rows={2} maxLength={2000} required value={content} onChange={e=>setContent(e.target.value)} disabled={disabled||!!editing} placeholder="例：契約書を送る、所有者に連絡する"/><button className="btn btn-main" type="submit" disabled={disabled||!!editing||!content.trim()}>{busy?'保存中…':'追加する'}</button></div></form>}
  {!ready?<div className="card loading-card" role="status">{error?'Todoを表示できません。「再読み込み」を押してください。':'Todoを読み込み中…'}</div>:<>{list(false)}{list(true)}</>}
 </div>
}
