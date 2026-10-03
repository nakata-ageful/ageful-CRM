import {useState} from 'react'
import type {ManagementEvent} from '../lib/management-lifecycle'
import {buildChangeHistory,historyDate,historyFields,historyKindLabels,historyValue,type HistoryEntry,type HistoryKind} from '../lib/change-history-display'
import {Modal} from './Modal'

export function OwnershipTransferHistory({transfers,events,recipientName,managementEvents=[]}:{transfers:readonly Record<string,unknown>[];
  events:readonly Record<string,unknown>[];recipientName:(id:number)=>string;expanded?:boolean;managementEvents?:readonly ManagementEvent[]}){
  const [filter,setFilter]=useState<'all'|HistoryKind>('all'),[selected,setSelected]=useState<HistoryEntry|null>(null),[allFields,setAllFields]=useState(false)
  const entries=buildChangeHistory(transfers,events,managementEvents),visible=entries.filter(e=>filter==='all'||e.kind===filter)
  const display=(key:string,value:unknown)=>historyValue(key,value,recipientName)
  const values=(e:HistoryEntry)=>({before:(e.record.before_value??{}) as Record<string,unknown>,after:(e.record.after_value??{}) as Record<string,unknown>})
  const summary=(e:HistoryEntry)=>{
    if(e.kind==='ownership')return `${recipientName(Number(e.record.from_customer_id))} → ${recipientName(Number(e.record.to_customer_id))}`
    if(e.kind==='management')return `適用日：${String(e.record.effective_date)}`
    const {before,after}=values(e),payerBefore=display('recipient_customer_id',before.recipient_customer_id),payerAfter=display('recipient_customer_id',after.recipient_customer_id)
    const amountText=(v:Record<string,unknown>)=>`${v.frozen_amount!=null?'確定額':'予定額'}：${v.frozen_amount==null&&v.planned_amount==null?'金額要確認':display(v.frozen_amount!=null?'frozen_amount':'planned_amount',v.frozen_amount??v.planned_amount)}`
    const amountBefore=amountText(before),amountAfter=amountText(after)
    return `請求先：${payerBefore===payerAfter||!e.record.before_value?payerAfter:`${payerBefore} → ${payerAfter}`} ／ ${amountBefore===amountAfter||!e.record.before_value?amountAfter:`${amountBefore} → ${amountAfter}`}`
  }
  const target=(e:HistoryEntry)=>{
    if(e.kind==='ownership')return `所有者の変更日：${String(e.record.transfer_date??'未記入')}`
    if(e.kind!=='billing')return null
    const {after}=values(e),round=after.service_month!=null?`${after.service_month}月分`:after.round_number!=null?`第${after.round_number}回`:'回数未登録'
    return `${after.period_start&&after.period_end?`${after.period_start} ～ ${after.period_end}`:after.service_year?`${after.service_year}年（保守期間未記入）`:'保守期間未記入'} ／ ${round} ／ 請求回ID ${String(e.record.billing_unit_id??after.id??'未記入')}`
  }
  const detail=selected&&(selected.kind==='ownership'?{before:selected.record.contract_before,after:selected.record.contract_after,kind:'contract' as const}:selected.kind==='billing'?{...values(selected),kind:'billing' as const}:null)
  const fields=detail?historyFields(detail.before,detail.after,detail.kind,allFields):[]
  return <section className="card change-history">
    <header className="change-history-heading"><div><h3 className="section-title">変更履歴</h3><p>いつ、何を変更したかを一覧で確認できます。変更前後の詳しい内容は「詳細を見る」から開きます。</p></div><span>{entries.length}件</span></header>
    <div className="history-filters" role="group" aria-label="履歴の種類">{(['all','ownership','billing','management'] as const).map(kind=><button type="button" key={kind} aria-pressed={filter===kind} onClick={()=>setFilter(kind)}>{kind==='all'?'すべて':historyKindLabels[kind]} <span>{entries.filter(e=>kind==='all'||e.kind===kind).length}</span></button>)}</div>
    {!visible.length&&<p className="history-empty">{filter==='all'?'まだ変更履歴はありません。':`${historyKindLabels[filter]}の履歴はありません。`}</p>}
    <ol className="history-list">{visible.map(e=><li key={e.key} className="history-entry">
      <div className="history-entry-meta"><span className={`history-kind ${e.kind}`}>{historyKindLabels[e.kind]}</span><time>{e.record.recorded_at||e.kind==='billing'?'記録日':'適用日'}：{historyDate(e.date)}</time></div>
      <div className="history-entry-body"><h4>{e.title}</h4><p className="history-entry-summary">{summary(e)}</p>{target(e)&&<p>{target(e)}</p>}<p>確認内容：{e.reason}</p></div>
      <button type="button" className="btn btn-sub" aria-label={`${e.title}（${historyDate(e.date)}・履歴ID ${e.record.id}）の詳細を見る`} onClick={()=>{setSelected(e);setAllFields(false)}}>詳細を見る</button>
    </li>)}</ol>
    {selected&&<Modal title={`${selected.title}の詳細`} width={960} onClose={()=>setSelected(null)}><div className="history-detail">
      <p>{selected.record.recorded_at||selected.kind==='billing'?'記録日':'適用日'}：{historyDate(selected.date)}</p><h3>{summary(selected)}</h3>{target(selected)&&<p>{target(selected)}</p>}<p>確認内容：{selected.reason}</p>
      {selected.kind==='management'?<p>適用日：{String(selected.record.effective_date)}。過去の請求や未入金は削除されません。</p>:<>
        {selected.kind==='ownership'&&<p className="history-reference-note">当時の契約情報の参照専用記録です。過去の請求金額を再計算するものではありません。</p>}
        <div className="history-detail-toolbar"><h4>{allFields?'保存された全項目':'変更された項目'}</h4><button type="button" className="btn btn-sub" onClick={()=>setAllFields(v=>!v)}>{allFields?'変更された項目だけ表示':'保存された全項目を表示'}</button></div>
        {!fields.length&&<p>変更された項目はありません。引き継いだ内容は「保存された全項目を表示」で確認できます。</p>}
        {!!fields.length&&<div className="history-diff-scroll"><table className="history-diff-table"><thead><tr><th>項目</th><th>変更前</th><th>変更後</th></tr></thead><tbody>{fields.map(f=><tr key={f.key}><th scope="row">{f.label}</th><td>{display(f.key,f.before)}</td><td>{display(f.key,f.after)}</td></tr>)}</tbody></table></div>}
      </>}
      <div className="editor-footer"><button type="button" className="btn btn-sub" onClick={()=>setSelected(null)}>閉じる</button></div>
    </div></Modal>}
  </section>
}
