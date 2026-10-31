import {useEffect,useRef,useState} from 'react'
import type {Customer,Project} from '../types'
import {Modal} from './Modal'
import {FormError} from './FormError'
import {powerFields,powerContractRequest,powerNotes,kansaiFitMonth,type PowerContractData,type PowerContractRequest} from '../lib/power-contract'
import {savePowerContract,PowerContractSaveError} from '../lib/power-contract-save'
import {certificateSame} from '../lib/meti-certificate'
import {customerDisplayName} from '../lib/customer-search'
import './MetiCertificateImport.css'

export function PowerContractImport({project,customer,onClose,onSaved}:{project:Project;customer:Customer|null;onClose:()=>void;onSaved:()=>void}){
 const [data,setData]=useState<PowerContractData|null>(null),[pdfUrl,setPdfUrl]=useState(''),[selected,setSelected]=useState<Set<string>>(new Set()),[confirmed,setConfirmed]=useState(false)
 const [busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState<PowerContractRequest|null>(null)
 const reader=useRef<AbortController|null>(null),lock=useRef(false)
 useEffect(()=>()=>reader.current?.abort(),[])
 useEffect(()=>()=>{if(pdfUrl)URL.revokeObjectURL(pdfUrl)},[pdfUrl])
 async function read(file:File|undefined){
  if(!file||busy||saving||pending)return
  reader.current?.abort();const c=new AbortController();reader.current=c
  setBusy(true);setError('');setData(null);setSelected(new Set());setConfirmed(false);setPdfUrl('');setProgress('PDFを読み込み中…')
  try{const {readPowerContract}=await import('../lib/power-contract-reader');const result=await readPowerContract(file,c.signal,setProgress);if(!c.signal.aborted){setData(result);setPdfUrl(URL.createObjectURL(file))}}
  catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:'PDFを読み込めませんでした。元のPDFをご確認ください。')}
  finally{if(!c.signal.aborted)setBusy(false)}
 }
 function change(key:keyof PowerContractData,value:string){setData(d=>d?{...d,[key]:value,...(key==='supplyStart'&&d.provider==='kansai'?{fitMonth:kansaiFitMonth(value)}:{})}:d);setConfirmed(false)}
 function toggle(key:string){setSelected(old=>{const next=new Set(old);if(next.has(key))next.delete(key);else next.add(key);return next});setConfirmed(false)}
 async function save(){if(lock.current||!data||!confirmed)return;let req:PowerContractRequest;try{req=pending??powerContractRequest(project,data,selected)}catch(e){setError((e as Error).message);return}
  lock.current=true;setSaving(true);setError('');setPending(req)
  try{await savePowerContract(req);onSaved()}catch(e){const certain=e instanceof PowerContractSaveError&&!e.uncertain;if(certain)setPending(null);setError(`${(e as Error).message}${certain?'':' 保存結果が不明な場合は、同じ内容で再確認できます。'}`)}finally{lock.current=false;setSaving(false)}
 }
 const customerName=customer?customerDisplayName(customer):'所有者未登録'
 const mismatch=data&&((data.businessName&&!certificateSame(customerName,data.businessName))||(project.grid_id&&data.gridId&&!certificateSame(project.grid_id,data.gridId)))
 const fields=powerFields.filter(f=>data?.provider!=='kyushu'||!['grid_certified_at','power_supply_start_date'].includes(f.key))
 return <Modal title="電力会社の契約書PDFを読み込む" width={920} onClose={onClose} closeDisabled={saving}><div className="meti-import">
  <div className="meti-import-heading"><b>{project.plant_name||project.project_name}</b><span>顧客：{customerName}</span></div>
  <div className="meti-file-row"><label className="meti-file">関西電力・九州電力の契約書<input type="file" accept="application/pdf,.pdf" disabled={busy||saving||!!pending} onChange={e=>void read(e.target.files?.[0])}/></label>{pdfUrl&&<a className="btn btn-sub btn-sm" href={pdfUrl} target="_blank" rel="noreferrer">元のPDFを開く</a>}</div>
  <small>端末内で読み取ります。チェックして「反映する」を押すまで登録内容は変わりません。</small>
  {busy&&<p role="status">{progress}</p>}<FormError message={error}/>
  {data&&<>
   <div className="meti-identity"><b>{data.provider==='kansai'?'関西電力':'九州電力'}</b><span>PDFの契約名義：{data.businessName||'読み取れませんでした'}</span>{mismatch&&<strong>顧客名・設備IDに違いがあります。この発電所の書類か確認してください。所有者は変更しません。</strong>}{data.ocr&&<strong>画像から読み取っています。数字や名前を元のPDFと照合してください。</strong>}</div>
   <p className="meti-instruction">内容を確認して、反映する項目にチェックしてください。</p>
   <div className="meti-comparison" aria-label="現在の登録内容と契約書の比較">
    <div className="meti-compare-head"><span>反映する項目</span><span>現在の登録内容</span><span>PDFから読み取った内容</span></div>
    {fields.map(f=>{const current=String(project[f.key]??''),value=data[f.source],shown=f.type==='month'?current.slice(0,7):current,same=!!value&&certificateSame(shown,value)
     return <div className="meti-compare-row" key={f.key}><label><input type="checkbox" checked={selected.has(f.key)} disabled={saving||!!pending||(!value||same)&&!selected.has(f.key)} onChange={()=>toggle(f.key)}/>{f.label}{same&&<small>一致</small>}</label><span className="meti-current">{shown||'未登録'}</span><label className="meti-extracted"><span className="meti-mobile-label">読み取り内容</span><input className="form-input" aria-label={`PDFの${f.label}`} type={f.type==='date'?'date':f.type==='month'?'month':'text'} inputMode={f.type==='number'?'decimal':undefined} value={value} disabled={saving||!!pending} placeholder="読み取れませんでした" onChange={e=>change(f.source,e.target.value)}/>{f.key==='fit_end_date'&&data.provider==='kansai'&&<small>受給開始日の20年後の翌月</small>}{f.key==='fit_period'&&data.provider==='kyushu'&&<small>書類の税込単価を1.1で割った金額</small>}{f.key==='power_change_date'&&<small>{data.provider==='kyushu'?'書類の「受給開始日」':'書類の「特定契約日（受給契約日）」'}</small>}</label></div>
    })}
    <div className="meti-compare-row"><label><input type="checkbox" checked={selected.has('power_company_notes')} disabled={saving||!!pending||(!data.notes.trim()||powerNotes(project.power_company_notes,data.notes)===(project.power_company_notes??''))&&!selected.has('power_company_notes')} onChange={()=>toggle('power_company_notes')}/>電力会社の備考に追記</label><span className="meti-current">{project.power_company_notes||'未登録'}</span><label className="meti-extracted"><span className="meti-mobile-label">追記する内容</span><textarea className="form-input" rows={6} aria-label="契約書から備考に追記する内容" value={data.notes} disabled={saving||!!pending} onChange={e=>change('notes',e.target.value)}/><small>今ある備考は残します。読み取れなかった情報は、PDFを見ながら追記できます。</small></label></div>
   </div>
   <label className="meti-confirm"><input type="checkbox" checked={confirmed} disabled={saving||!!pending} onChange={e=>setConfirmed(e.target.checked)}/>この発電所の書類であることと、選んだ項目の内容を確認しました</label>
  </>}
  <div className="meti-actions"><button type="button" className="btn btn-sub" disabled={saving} onClick={onClose}>閉じる</button><button type="button" className="btn btn-main" disabled={busy||saving||!data||!confirmed||!selected.size} onClick={()=>void save()}>{saving?'保存中…':pending?'同じ内容で保存を再確認':selected.size?`選んだ${selected.size}項目を反映する`:'選んだ項目を反映する'}</button></div>
 </div></Modal>
}
