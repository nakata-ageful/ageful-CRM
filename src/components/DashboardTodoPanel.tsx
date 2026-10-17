import {useEffect,useState} from 'react'
import {loadIncompleteProjectTodos,type IncompleteProjectTodo} from '../lib/project-todos'

export function DashboardTodoPanel({onViewTodo,load=loadIncompleteProjectTodos}:{onViewTodo:(projectId:number)=>void;load?:()=>Promise<IncompleteProjectTodo[]>}){
 const [items,setItems]=useState<IncompleteProjectTodo[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0)
 useEffect(()=>{
  let cancelled=false;setLoading(true);setError('')
  void load().then(rows=>{if(!cancelled)setItems(rows)}).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:typeof e==='object'&&e&&'message'in e?String(e.message):'通信に失敗しました。')})
   .finally(()=>{if(!cancelled)setLoading(false)})
  return()=>{cancelled=true}
 },[load,refresh])
 return <section className="card dashboard-todos"><div className="card-header-row"><h3 className="section-title">未完了のタスク{!loading&&!error?`（${items.length}件）`:''}</h3>
  <button type="button" className="btn btn-sub btn-sm" disabled={loading} onClick={()=>{setLoading(true);setRefresh(n=>n+1)}}>再読み込み</button></div>
  {loading?<p role="status">Todoを読み込み中…</p>:error?<div role="alert" className="form-error">Todoを読み込めませんでした。{error}「再読み込み」を押してください。</div>:
  !items.length?<p className="empty-cell">未完了のタスクはありません</p>:<div className="dashboard-todo-scroll"><table><thead><tr><th>発電所</th><th>やること</th><th>追加日</th><th>操作</th></tr></thead><tbody>
   {items.map(t=><tr key={t.id}><td className="dashboard-todo-project"><strong>{t.project_name}</strong></td><td className="dashboard-todo-task">{t.content}</td>
    <td className="dashboard-todo-date">{new Date(t.created_at).toLocaleDateString('ja-JP')}</td><td className="dashboard-todo-action"><button type="button" className="btn btn-sub btn-sm" aria-label={`${t.project_name}のTodoへ：${t.content}`} onClick={()=>onViewTodo(t.project_id)}>Todoへ</button></td></tr>)}
  </tbody></table></div>}
 </section>
}
