import {useState} from 'react'
import type {Contract} from '../types'
import {billingItemSummary,billingItemSelectionPatch} from '../lib/billing-item-selection'
import {fmtYen} from '../lib/utils'
import {managementBillingContract,type ManagementEvent} from '../lib/management-lifecycle'

export function BillingItemSelection({contract,onSave,managementEvents=[]}:{contract:Contract;onSave?:(flags:Record<string,boolean>)=>Promise<void>;managementEvents?:readonly ManagementEvent[]}){
  const [flags,setFlags]=useState(()=>({...contract.billing_item_flags})),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false)
  const summary=billingItemSummary({...contract,billing_item_flags:flags})
  const now=new Date(),today=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`
  const effective=billingItemSummary(managementBillingContract({...contract,billing_item_flags:flags},managementEvents,today))
  return <section className="card"><h3 className="section-title">費目ごとの自社請求対象</h3>
    <p>金額は保守情報に残したまま、自社の請求計算に含める費目を選びます。受託会社・保守委託先の名前からは自動判定しません。</p>
    {!onSave&&<p role="status">過去の請求額を保護するため、新しい回別請求への移行後にここから変更できます。現在の設定を表示しています。</p>}
    <fieldset disabled={busy||!onSave} style={{border:0,padding:0}}>
      {summary.items.map(item=><label key={item.key} style={{display:'flex',gap:12,alignItems:'center',padding:'8px 0',flexWrap:'wrap'}}>
        <input type="checkbox" aria-label={`${item.label}を自社請求に含める`} checked={item.included} onChange={e=>{setFlags(f=>({...f,[item.key]:e.target.checked}));setSaved(false)}}/>
        <span>{item.label}</span><span>{fmtYen(item.amount)}</span><span>{item.included?'対象':'対象外（記録のみ）'}</span>
      </label>)}
      <p>基本設定の自社請求対象額（費目の年間合計）：{fmtYen(summary.includedTotal)} ／ 対象外の記録額：{fmtYen(summary.excludedTotal)}</p>
      {managementEvents.length>0&&<p>終了・再開を反映した現在の対象額（年額換算）：{fmtYen(effective.includedTotal)}。上のチェックは基本設定です。終了・再開の日付指定を優先し、日割りはしません。</p>}
      <p>この合計は売上実績・入金額ではありません。個別金額の上書きと手数料は別設定です。</p>
      {summary.hasOverrides&&<p role="status">各回・各月に個別金額が設定されています。チェックを外しても、その個別金額は変わりません。「請求情報」で確認してください。</p>}
      {summary.hasFees&&<p role="status">手数料ありの設定です。費目をすべて外しても手数料は自動で解除しません。</p>}
      <p>過去の請求・入金と保存済み予定は変更しません。すでにある予定を変更・終了する場合は「請求詳細」で各回を確認してください。</p>
      {onSave&&<button type="button" className="btn btn-main" onClick={async()=>{if(busy)return;setBusy(true);setError('');try{await onSave(billingItemSelectionPatch(flags).billing_item_flags);setSaved(true)}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setBusy(false)}}}>{busy?'保存中…':'請求対象の選択を保存'}</button>}
    </fieldset>
    {error&&<p role="alert">{error}</p>}{saved&&<p role="status">請求対象の選択を保存しました。</p>}
  </section>
}
