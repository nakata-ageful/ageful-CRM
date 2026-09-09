import type {Contract} from '../types'
import {contractTransferLabels} from '../lib/contract-transfer-form'

export function OwnershipTransferHistory({transfers,events,recipientName}:{transfers:readonly Record<string,unknown>[];events:readonly Record<string,unknown>[];recipientName:(id:number)=>string}){
  const display=(v:unknown)=>v==null?'未記入':typeof v==='boolean'?(v?'あり':'なし'):typeof v==='object'?JSON.stringify(v):String(v)
  return <details className="card" style={{padding:16}}><summary>所有者変更・請求の変更履歴</summary>
    {transfers.length===0&&<p>所有者変更の履歴はありません。</p>}
    {[...transfers].reverse().map(t=>{
      const before=t.contract_before as Record<string,unknown>,after=t.contract_after as Record<string,unknown>
      return <section key={String(t.id)}><h3>{String(t.transfer_date)}：{recipientName(Number(t.from_customer_id))} → {recipientName(Number(t.to_customer_id))}</h3>
        <p>確認内容：{String((t.field_decisions as Record<string,unknown>)?.reason??'記録なし')}</p>
        <details><summary>このときの契約情報（変更前 → 変更後）</summary><p>参照専用です。過去の請求額の計算には使いません。</p>
          {Object.entries(contractTransferLabels).map(([key,label])=><p key={key}>{label}：{display(before[key as keyof Contract])} → {display(after[key as keyof Contract])}</p>)}
        </details>
      </section>
    })}
    <h3>請求の変更履歴</h3>{[...events].reverse().map(e=>{
      const before=e.before_value as Record<string,unknown>|null,after=e.after_value as Record<string,unknown>
      const method=(v:unknown)=>v==='invoice'?'請求書':v==='direct_debit'?'口座振替':'未設定'
      const amount=(v:Record<string,unknown>|null)=>v?.frozen_amount??v?.planned_amount??'金額要確認'
      return <details key={String(e.id)}><summary>{String(e.recorded_at).slice(0,10)}：{String(e.reason??'請求記録の保存')}</summary>
        <p>請求先：{before?.recipient_customer_id?recipientName(Number(before.recipient_customer_id)):'未設定'} → {after.recipient_customer_id?recipientName(Number(after.recipient_customer_id)):'未設定'}</p>
        <p>請求方法：{method(before?.collection_method)} → {method(after.collection_method)} ／ 金額：{display(amount(before))} → {display(amount(after))}</p>
        <p>予定日：{display(before?.scheduled_date)} → {display(after.scheduled_date)} ／ 請求日：{display(before?.issued_on)} → {display(after.issued_on)} ／ 入金日：{display(before?.received_on)} → {display(after.received_on)}</p>
      </details>
    })}
  </details>
}
