import {hasSupabaseEnv,supabase} from './supabase'
import {projectStore} from './mock-store'

export type ProjectTodo={id:string;project_id:number;content:string;due_date?:string|null;is_completed:boolean;completed_at:string|null;revision:number;created_at:string;updated_at:string}
export type TodoChange={id:string;projectId:number;revision:number|null;content:string;completed:boolean;dueDate?:string|null}
export type DashboardProjectTodo=ProjectTodo&{project_name:string}
const fields='id,project_id,content,due_date,is_completed,completed_at,revision,created_at,updated_at'
const demoTodos=new Map<string,ProjectTodo>()
const demoOriginalContent=new Map<string,string>()
const demoOriginalDueDate=new Map<string,string|null>()
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const date=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))
export const validTodoDueDate=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&v.slice(0,4)!=='0000'&&date(v)&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v
/** Deadline first; undated tasks last. Stable across reloads and both Todo lists. */
export function compareTodoDueDate(a:ProjectTodo,b:ProjectTodo){
 return (a.due_date??'9999-99-99').localeCompare(b.due_date??'9999-99-99')||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)
}
export const todoTodayInJapan=(now=new Date())=>new Date(now.getTime()+9*60*60*1000).toISOString().slice(0,10)
export const isTodoOverdue=(todo:Pick<ProjectTodo,'due_date'|'is_completed'>,today=todoTodayInJapan())=>!todo.is_completed&&!!todo.due_date&&todo.due_date<today
export function parseProjectTodo(value:unknown,projectId:number):ProjectTodo{
 const t=value as ProjectTodo|null
 if(!Number.isSafeInteger(projectId)||projectId<1||!t||typeof t.id!=='string'||!uuid.test(t.id)||t.project_id!==projectId||typeof t.content!=='string'||!t.content.trim()||t.content.length>2000
  ||t.due_date!=null&&!validTodoDueDate(t.due_date)||typeof t.is_completed!=='boolean'||!Number.isSafeInteger(t.revision)||t.revision<1||!date(t.created_at)||!date(t.updated_at)
  ||(t.is_completed?!date(t.completed_at):t.completed_at!==null))throw Error('Todoの保存内容を確認できません。読み込み直してください。')
 return {id:t.id,project_id:t.project_id,content:t.content,due_date:t.due_date??null,is_completed:t.is_completed,completed_at:t.completed_at,revision:t.revision,created_at:t.created_at,updated_at:t.updated_at}
}
export function validateTodoChange(input:TodoChange):TodoChange{
 const content=input.content.trim()
 if(input.dueDate!=null&&!validTodoDueDate(input.dueDate))throw Error('期日を正しい日付で入力してください。')
 if(!uuid.test(input.id)||!Number.isSafeInteger(input.projectId)||input.projectId<1||!content||content.length>2000
  ||typeof input.completed!=='boolean'||(input.revision!==null&&(!Number.isSafeInteger(input.revision)||input.revision<1))
  ||input.revision===null&&input.completed)throw Error('Todoは1〜2000文字で入力してください。')
 return {...input,content}
}
export const definiteTodoRejection=(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&/^(22|23|42|P0001)/.test(String(e.code))

/** Independent Todo reads. No billing/maintenance queries or global reloads. */
export async function loadProjectTodos(projectId:number):Promise<ProjectTodo[]>{
 if(!Number.isSafeInteger(projectId)||projectId<1)throw Error('発電所を確認してください。')
 if(!hasSupabaseEnv)return structuredClone([...demoTodos.values()].filter(t=>t.project_id===projectId))
 if(!supabase)throw Error('Todoの保存先に接続できません。')
 const rows:ProjectTodo[]=[],ids=new Set<string>();let expected:number|null=null
 for(;;){
  const {data,error,count}=await supabase.from('project_todos').select(fields,{count:'exact'}).eq('project_id',projectId).order('created_at').order('id').range(rows.length,rows.length+499)
  if(error)throw error
  if(!data||count==null||!Number.isSafeInteger(count)||count<0||expected!==null&&count!==expected)throw Error('Todoの一覧が更新されました。もう一度読み込んでください。')
  expected=count
  for(const value of data){const t=parseProjectTodo(value,projectId);if(ids.has(t.id))throw Error('Todoの一覧を読み込み直してください。');ids.add(t.id);rows.push(t)}
  if(rows.length===expected)return rows
  if(!data.length||rows.length>expected)throw Error('Todoの一覧を最後まで取得できませんでした。')
 }
}
/** Dashboard: both task states on non-archived projects. Read-only under existing RLS. */
export async function loadDashboardProjectTodos():Promise<DashboardProjectTodo[]>{
 if(!hasSupabaseEnv){
  return [...demoTodos.values()].flatMap(t=>{const p=projectStore.getById(t.project_id);return p&&!p.archived_at?[{...structuredClone(t),project_name:p.plant_name?.trim()||p.project_name?.trim()||`発電所ID ${p.id}`}]:[]})
   .sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id))
 }
 if(!supabase)throw Error('Todoの保存先に接続できません。')
 const rows:DashboardProjectTodo[]=[],ids=new Set<string>();let expected:number|null=null
 for(;;){
  const {data,error,count}=await supabase.from('project_todos').select(`${fields},projects!inner(id,project_name,plant_name,archived_at)`,{count:'exact'})
   .is('projects.archived_at',null).order('created_at').order('id').range(rows.length,rows.length+499)
  if(error)throw error
  if(!data||count==null||!Number.isSafeInteger(count)||count<0||expected!==null&&count!==expected)throw Error('Todoの一覧が更新されました。もう一度読み込んでください。')
  expected=count
  for(const value of data){
   const t=parseProjectTodo(value,value.project_id),p=value.projects as unknown as {id:number;project_name:string|null;plant_name:string|null;archived_at:string|null}|null
   if(ids.has(t.id)||!p||p.id!==t.project_id||p.archived_at!==null)throw Error('Todoの一覧を確認できません。もう一度読み込んでください。')
   ids.add(t.id);rows.push({...t,project_name:p.plant_name?.trim()||p.project_name?.trim()||`発電所ID ${p.id}`})
  }
  if(rows.length===expected)return rows
  if(!data.length||rows.length>expected)throw Error('Todoの一覧を最後まで取得できませんでした。')
 }
}
export async function saveProjectTodo(input:TodoChange):Promise<ProjectTodo>{
 const change=validateTodoChange(input)
 if(!hasSupabaseEnv){
  const previous=demoTodos.get(change.id),now=new Date().toISOString()
  if(change.revision===null){if(previous){if(previous.project_id!==change.projectId)throw Error('発電所を確認してください。');if(demoOriginalContent.get(change.id)!==change.content||change.dueDate!==undefined&&demoOriginalDueDate.get(change.id)!==change.dueDate)throw Error('同じ操作で別のTodoは追加できません。');return structuredClone(previous)}
   const t:ProjectTodo={id:change.id,project_id:change.projectId,content:change.content,due_date:change.dueDate??null,is_completed:false,completed_at:null,revision:1,created_at:now,updated_at:now};demoTodos.set(t.id,t);demoOriginalContent.set(t.id,change.content);demoOriginalDueDate.set(t.id,t.due_date??null);return structuredClone(t)}
  if(!previous||previous.project_id!==change.projectId)throw Error('Todoが見つかりません。')
  const dueDate=change.dueDate===undefined?previous.due_date??null:change.dueDate
  if(previous.content===change.content&&previous.is_completed===change.completed&&(previous.due_date??null)===dueDate)return structuredClone(previous)
  if(previous.revision!==change.revision)throw Error('Todoが更新されています。読み込み直してください。')
  const t={...previous,content:change.content,due_date:dueDate,is_completed:change.completed,completed_at:change.completed?(previous.completed_at??now):null,revision:previous.revision+1,updated_at:now};demoTodos.set(t.id,t);return structuredClone(t)
 }
 if(!supabase)throw Error('Todoの保存先に接続できません。')
 const args={p_id:change.id,p_project:change.projectId,p_revision:change.revision,p_content:change.content,p_completed:change.completed}
 const {data,error}=await (change.dueDate===undefined?supabase.rpc('project_todo_write',args):supabase.rpc('project_todo_write_with_due_date',{...args,p_due_date:change.dueDate}))
 if(error)throw error
 const t=parseProjectTodo(data,change.projectId)
 if(t.id!==change.id)throw Error('保存したTodoを確認できません。保存結果を再確認してください。')
 if(change.dueDate!==undefined&&(!Object.prototype.hasOwnProperty.call(data,'due_date')||change.revision!==null&&t.due_date!==change.dueDate))throw Error('期日の保存を確認できません。保存結果を再確認してください。')
 return t
}
