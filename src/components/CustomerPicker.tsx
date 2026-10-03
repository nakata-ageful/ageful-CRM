import {useId,useState} from 'react'
import {customerChoiceLabel,searchCustomers,type CustomerChoice} from '../lib/customer-search'

/** Search is local only. Only an explicit choice changes the saved customer ID. */
export function CustomerPicker({label,value,customers,onChange,disabled=false,emptyLabel='選択してください',allowClear=true}:{
  label:string;value:string;customers:readonly CustomerChoice[];onChange:(value:string)=>void;
  disabled?:boolean;emptyLabel?:string;allowClear?:boolean
}){
  const id=useId(),[query,setQuery]=useState(''),[open,setOpen]=useState(false),[active,setActive]=useState(-1)
  const selected=customers.find(c=>String(c.id)===value),matches=searchCustomers(customers,query)
  const choose=(customer:CustomerChoice)=>{if(disabled)return;onChange(String(customer.id));setQuery('');setActive(-1);setOpen(false)}
  return <div className="customer-picker" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null)){setOpen(false);setActive(-1)}}}>
    <label className="customer-picker-label" htmlFor={id}>{label}</label>
    <div className="customer-picker-selected"><span>{selected?`選択中：${customerChoiceLabel(selected)}`:value?`顧客ID ${value}（候補を選び直してください）`:emptyLabel}</span>
      {allowClear&&value&&<button type="button" disabled={disabled} aria-label={`${label}の選択を解除`} onClick={()=>{onChange('');setQuery('');setActive(-1);setOpen(false)}}>解除</button>}
    </div>
    <input id={id} className="form-input" type="text" role="combobox" autoComplete="off" disabled={disabled}
      aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open&&active>=0?`${id}-option-${active}`:undefined}
      placeholder="名前・会社名・ふりがなで検索" value={query}
      onFocus={()=>setOpen(true)} onChange={e=>{setQuery(e.target.value);setActive(-1);setOpen(true)}}
      onKeyDown={e=>{
        if(e.nativeEvent.isComposing||e.keyCode===229)return
        if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setOpen(true);setActive(n=>!matches.length?-1:e.key==='ArrowDown'?Math.min(n+1,matches.length-1):Math.max(n-1,0))}
        if(e.key==='Escape'&&open){e.preventDefault();e.stopPropagation();setOpen(false);setActive(-1)}
        if(e.key==='Enter'&&open){e.preventDefault();if(active>=0&&matches[active])choose(matches[active])}
      }}/>
    {open&&<div className="customer-picker-results">
      <div className="customer-picker-count" role="status">候補 {matches.length}件{query&&'（部分一致）'}</div>
      <div id={`${id}-options`} role="listbox" aria-label={`${label}の候補`}>
        {matches.map((customer,index)=><button type="button" role="option" id={`${id}-option-${index}`} key={customer.id} disabled={disabled}
          aria-selected={String(customer.id)===value} className={active===index?'active':''}
          ref={node=>{if(node&&active===index)node.scrollIntoView({block:'nearest'})}}
          onMouseDown={e=>e.preventDefault()} onClick={()=>choose(customer)}>{customerChoiceLabel(customer)}</button>)}
      </div>
      {!matches.length&&<p className="customer-picker-empty">該当する顧客はいません。検索文字を変えてください。</p>}
    </div>}
  </div>
}
