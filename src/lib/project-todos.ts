import {hasSupabaseEnv,supabase} from './supabase'

export type ProjectTodo={id:string;project_id:number;content:string;is_completed:boolean;completed_at:string|null;revision:number;created_at:string;updated_at:string}
export type TodoChange={id:string;projectId:number;revision:number|null;content:string;completed:boolean}
const fields='id,project_id,content,is_completed,completed_at,revision,created_at,updated_at'
const demoTodos=new Map<string,ProjectTodo>()
const demoOriginalContent=new Map<string,string>()
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const date=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))
export function parseProjectTodo(value:unknown,projectId:number):ProjectTodo{
 const t=value as ProjectTodo|null
 if(!t||typeof t.id!=='string'||!uuid.test(t.id)||t.project_id!==projectId||typeof t.content!=='string'||!t.content.trim()||t.content.length>2000
  ||typeof t.is_completed!=='boolean'||!Number.isSafeInteger(t.revision)||t.revision<1||!date(t.created_at)||!date(t.updated_at)
  ||(t.is_completed?!date(t.completed_at):t.completed_at!==null))throw Error('Todoの保存内容を確認できません。読み込み直してください。')
 return {id:t.id,project_id:t.project_id,content:t.content,is_completed:t.is_completed,completed_at:t.completed_at,revision:t.revision,created_at:t.created_at,updated_at:t.updated_at}
}
export function validateTodoChange(input:TodoChange):TodoChange{
 const content=input.content.trim()
 if(!uuid.test(input.id)||!Number.isSafeInteger(input.projectId)||input.projectId<1||!content||content.length>2000
  ||typeof input.completed!=='boolean'||(input.revision!==null&&(!Number.isSafeInteger(input.revision)||input.revision<1))
  ||input.revision===null&&input.completed)throw Error('Todoは1〜2000文字で入力してください。')
 return {...input,content}
}
export const definiteTodoRejection=(e:unknown)=>!!e&&typeof e==='object'&&'code'in e&&/^(22|23|42|P0001)/.test(String(e.code))

/** Only called by the Todo tab. No billing/maintenance queries or global reloads. */
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
export async function saveProjectTodo(input:TodoChange):Promise<ProjectTodo>{
 const change=validateTodoChange(input)
 if(!hasSupabaseEnv){
  const previous=demoTodos.get(change.id),now=new Date().toISOString()
  if(change.revision===null){if(previous){if(previous.project_id!==change.projectId)throw Error('発電所を確認してください。');if(demoOriginalContent.get(change.id)!==change.content)throw Error('同じ操作で別のTodoは追加できません。');return structuredClone(previous)}
   const t:ProjectTodo={id:change.id,project_id:change.projectId,content:change.content,is_completed:false,completed_at:null,revision:1,created_at:now,updated_at:now};demoTodos.set(t.id,t);demoOriginalContent.set(t.id,change.content);return structuredClone(t)}
  if(!previous||previous.project_id!==change.projectId)throw Error('Todoが見つかりません。')
  if(previous.content===change.content&&previous.is_completed===change.completed)return structuredClone(previous)
  if(previous.revision!==change.revision)throw Error('Todoが更新されています。読み込み直してください。')
  const t={...previous,content:change.content,is_completed:change.completed,completed_at:change.completed?(previous.completed_at??now):null,revision:previous.revision+1,updated_at:now};demoTodos.set(t.id,t);return structuredClone(t)
 }
 if(!supabase)throw Error('Todoの保存先に接続できません。')
 const {data,error}=await supabase.rpc('project_todo_write',{p_id:change.id,p_project:change.projectId,p_revision:change.revision,p_content:change.content,p_completed:change.completed})
 if(error)throw error
 const t=parseProjectTodo(data,change.projectId)
 if(t.id!==change.id)throw Error('保存したTodoを確認できません。保存結果を再確認してください。')
 return t
}
