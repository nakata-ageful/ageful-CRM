import {useEffect,useState} from 'react'
import {compareTodoDueDate,loadDashboardProjectTodos,type DashboardProjectTodo} from '../lib/project-todos'

export function DashboardTodoPanel({onViewTodo,load=loadDashboardProjectTodos}:{onViewTodo:(projectId:number,completed?:boolean)=>void;load?:()=>Promise<DashboardProjectTodo[]>}){
 const [items,setItems]=useState<DashboardProjectTodo[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[completed,setCompleted]=useState(false)
 useEffect(()=>{
  let cancelled=false;setLoading(true);setError('')
  void load().then(rows=>{if(!cancelled)setItems(rows)}).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:typeof e==='object'&&e&&'message'in e?String(e.message):'通信に失敗しました。')})
   .finally(()=>{if(!cancelled)setLoading(false)})
  return()=>{cancelled=true}
 },[load,refresh])
 const rows=items.filter(t=>t.is_completed===completed).sort(compareTodoDueDate)
 return <section className="card dashboard-todos"><div className="card-header-row"><h3 className="section-title">タスク</h3>
  <button type="button" className="btn btn-sub btn-sm" disabled={loading} onClick={()=>{setLoading(true);setRefresh(n=>n+1)}}>再読み込み</button></div>
  <div className="filter-tabs" role="group" aria-label="タスクの表示を切り替え">{[false,true].map(done=><button type="button" key={String(done)} className={`filter-tab ${completed===done?'active':''}`} aria-pressed={completed===done} disabled={loading||!!error} onClick={()=>setCompleted(done)}>{done?'完了':'未完了'}{!loading&&!error?`（${items.filter(t=>t.is_completed===done).length}件）`:''}</button>)}</div>
  {loading?<p role="status">Todoを読み込み中…</p>:error?<div role="alert" className="form-error">Todoを読み込めませんでした。{error}「再読み込み」を押してください。</div>:
  !rows.length?<p className="empty-cell">{completed?'完了したタスクはありません':'未完了のタスクはありません'}</p>:<div className="dashboard-todo-scroll"><table><thead><tr><th>発電所</th><th>やること</th><th>期日</th>{completed&&<th>完了日</th>}<th>操作</th></tr></thead><tbody>
   {rows.map(t=><tr key={t.id}><td className="dashboard-todo-project"><strong>{t.project_name}</strong></td><td className="dashboard-todo-task">{t.content}</td>
    <td className="dashboard-todo-date">{t.due_date??'—'}</td>{completed&&<td className="dashboard-todo-completed-date">{new Date(t.completed_at!).toLocaleDateString('ja-JP')}</td>}<td className="dashboard-todo-action"><button type="button" className="btn btn-sub btn-sm" aria-label={`${t.project_name}のTodoへ：${t.content}`} onClick={()=>onViewTodo(t.project_id,completed)}>Todoへ</button></td></tr>)}
  </tbody></table></div>}
 </section>
}
