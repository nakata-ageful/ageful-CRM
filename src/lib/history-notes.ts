export type HistoryNoteKind = 'ownership' | 'workflow' | 'billing' | 'management'
export type HistoryNote = {
  operation_key:string; project_id:number; kind:HistoryNoteKind; target_id:string; revision:number;
  original_text:string; previous_text:string; text:string; created_at:string
}
export type HistoryNoteRequest = {projectId:number;kind:HistoryNoteKind;targetId:string;expectedRevision:number;text:string}

export function historyNotesFromStorage(rows:unknown):HistoryNote[]{
  if(!Array.isArray(rows))throw Error('確認内容の訂正履歴を取得できません')
  const seen=new Set<string>()
  return rows.map((row:unknown)=>{
    if(!row||typeof row!=='object')throw Error('確認内容の訂正履歴が不正です')
    const r=row as HistoryNote
    if(!['ownership','workflow','billing','management'].includes(r.kind)||!Number.isSafeInteger(r.project_id)||r.project_id<1||typeof r.target_id!=='string'||!r.target_id
      ||!Number.isSafeInteger(r.revision)||r.revision<1||typeof r.operation_key!=='string'||typeof r.created_at!=='string'
      ||typeof r.text!=='string'||!r.text.trim()||r.text.length>4000||typeof r.original_text!=='string'||typeof r.previous_text!=='string')throw Error('確認内容の訂正履歴が不正です')
    const key=`${r.kind}:${r.target_id}:${r.revision}`
    if(seen.has(key))throw Error('確認内容の訂正履歴が重複しています')
    seen.add(key);return r
  })
}

export function historyNoteState(notes:readonly HistoryNote[],kind:HistoryNoteKind,targetId:string,original:string,projectId?:number){
  const changes=notes.filter(n=>n.kind===kind&&n.target_id===targetId&&(projectId==null||n.project_id===projectId)).sort((a,b)=>a.revision-b.revision)
  let text=original,revision=0
  for(const note of changes){
    if(note.revision!==revision+1||note.original_text!==original||note.previous_text!==text)throw Error('確認内容の訂正履歴のつながりを確認できません。画面を再読み込みしてください')
    text=note.text;revision=note.revision
  }
  return {text,revision,changes}
}
