import type { Contract } from '../types'
import {contractFieldKinds,type FieldChoice} from '../lib/ownership-field-selection'
import {contractTransferLabels,contractTransferOptions,billingFlagLabels,type ContractChoices} from '../lib/contract-transfer-form'

export function ContractTransferFields({contract,choices,onChange,disabled=false}:{
  contract:Record<string,unknown>;choices:ContractChoices;onChange:(value:ContractChoices)=>void;disabled?:boolean
}) {
  const keys=Object.keys(contractTransferLabels) as (keyof Contract)[]
  function patch(key:keyof Contract,value:FieldChoice){onChange({...choices,[key]:value})}
  const show=(v:unknown):string=>v==null?'未記入':typeof v==='boolean'?(v?'あり':'なし'):Array.isArray(v)?v.join('、'):typeof v==='object'?Object.entries(v).map(([k,n])=>`${k}：${n}`).join('、'):String(v)
  return <details className="card" style={{padding:20}}>
    <summary>契約情報の引き継ぎ（変更・引き継がない：{Object.values(choices).filter(c=>c.mode!=='keep').length}項目）</summary>
    <p>初期設定はすべて「そのまま引き継ぐ」です。変更する項目だけ開いてください。どの選択でも、変更前の情報は履歴に残ります。</p>
    <p>購入日・販売経路を引き継いでも、新所有者の購入日として自動認定はしません。契約の金額を変更しても、保存済みの各回の請求額は変わりません。</p>
    <fieldset disabled={disabled} style={{border:0,padding:0}}>
      <button type="button" className="btn" onClick={()=>onChange({})}>すべて「そのまま引き継ぐ」に戻す</button>
      {keys.filter(key=>contractFieldKinds[key]!=='protected').map(key=>{
        const kind=contractFieldKinds[key],choice=choices[key]??{mode:'keep'},exists=Object.hasOwn(contract,key)
        const value=choice.mode==='change'?choice.value:contract[key]
        const change=(v:unknown)=>patch(key,{mode:'change',value:v})
        const inputLabel=`${contractTransferLabels[key]}（変更後）`,options=contractTransferOptions[key]
        return <details key={key} style={{padding:'10px 0',borderBottom:'1px solid #e2e8f0'}}>
          <summary>{contractTransferLabels[key]}：{choice.mode==='keep'?'そのまま引き継ぐ':choice.mode==='clear'?'引き継がない':'変更して引き継ぐ'}</summary>
          <p>現在：{show(contract[key])}</p>
          {!exists?<p>この保存先には項目がありません。DBの準備後に選択できます。</p>:<>
          <label>{contractTransferLabels[key]}の扱い<select className="form-input" value={choice.mode} onChange={e=>patch(key,e.target.value==='change'?{mode:'change',value:contract[key]??(kind==='boolean'?false:kind==='flags'||kind==='amounts'?{}:kind==='strings'?[]:'')}:{mode:e.target.value as 'keep'|'clear'})}>
            <option value="keep">そのまま引き継ぐ</option><option value="change">変更して引き継ぐ</option><option value="clear">引き継がない</option>
          </select></label>
          {choice.mode==='clear'&&<p>新所有者の現在欄は空欄になります。旧値は履歴に残ります。</p>}
          {choice.mode==='change'&&(kind==='flags'?<div>{Object.entries(billingFlagLabels).map(([k,label])=><label key={k} style={{display:'block'}}><input type="checkbox" checked={(value as Record<string,boolean>)?.[k]!==false} onChange={e=>change({...value as object,[k]:e.target.checked})}/>{label}を含める</label>)}</div>
            :kind==='amounts'?<div><p>「回・月：金額」を1行ずつ入力（例：1:82500）。空欄は個別設定なしです。</p><textarea aria-label={inputLabel} className="form-input" defaultValue={Object.entries((value??{}) as object).map(([k,v])=>`${k}:${v}`).join('\n')} onChange={e=>{
              const entries=e.target.value.trim()?e.target.value.split('\n').map(line=>{const [k,v,...extra]=line.split(':');return [k?.trim(),extra.length||!/^\d+$/.test(v?.trim()??'')?NaN:Number(v)]}):[]
              const obj=Object.fromEntries(entries);change(entries.length!==Object.keys(obj).length?{invalid:NaN}:obj)
            }}/></div>
            :kind==='boolean'?<select aria-label={inputLabel} className="form-input" value={String(value)} onChange={e=>change(e.target.value==='true')}><option value="true">あり</option><option value="false">なし</option></select>
            :options?<select aria-label={inputLabel} className="form-input" value={String(value??'')} onChange={e=>change(e.target.value)}><option value="">選択してください</option>{options.map(option=><option key={option}>{option}</option>)}</select>
            :kind==='strings'?<label>1行に1予定日（請求書：6月15日／口座振替：25日）<textarea className="form-input" value={Array.isArray(value)?value.join('\n'):''} onChange={e=>change(e.target.value.split('\n'))}/></label>
            :kind==='number'?<input aria-label={inputLabel} className="form-input" type="number" min="0" step="1" value={typeof value==='number'&&Number.isFinite(value)?value:''} onChange={e=>change(e.target.value===''?NaN:Number(e.target.value))}/>
            :kind==='date'?<input aria-label={inputLabel} className="form-input" type="date" value={String(value??'')} onChange={e=>change(e.target.value)}/>
            :<textarea aria-label={inputLabel} className="form-input" value={String(value??'')} onChange={e=>change(e.target.value)}/>)}
          </>}
        </details>
      })}
    </fieldset>
    <p>内部ID・登録日時は変更できません。所有権移転日は上の移転日から自動更新します。</p>
  </details>
}
