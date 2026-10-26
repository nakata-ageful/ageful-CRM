import {useEffect,useRef,useState} from 'react'
import type {Customer,Project} from '../types'
import {Modal} from './Modal'
import {certificateEmpty,certificateFields,certificateNotes,certificateRequest,certificateSame,type CertificateData,type CertificateRequest} from '../lib/meti-certificate'
import {saveCertificate,CertificateSaveError} from '../lib/meti-certificate-save'
import {customerDisplayName} from '../lib/customer-search'
import './MetiCertificateImport.css'

export function MetiCertificateImport({project,customer,onClose,onSaved}:{project:Project;customer:Customer|null;onClose:()=>void;onSaved:()=>void}){
  const [data,setData]=useState<CertificateData|null>(null),[fileName,setFileName]=useState(''),[pdfUrl,setPdfUrl]=useState('')
  const [selected,setSelected]=useState<Set<string>>(new Set()),[confirmed,setConfirmed]=useState(false)
  const [busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[progress,setProgress]=useState(''),[error,setError]=useState('')
  const [pending,setPending]=useState<CertificateRequest|null>(null)
  const reader=useRef<AbortController|null>(null),lock=useRef(false)
  useEffect(()=>()=>reader.current?.abort(),[])
  useEffect(()=>()=>{if(pdfUrl)URL.revokeObjectURL(pdfUrl)},[pdfUrl])
  async function read(file:File|undefined){
    if(!file||busy||saving||pending)return
    reader.current?.abort();const controller=new AbortController();reader.current=controller
    setBusy(true);setError('');setData(null);setSelected(new Set());setConfirmed(false);setFileName(file.name);setPdfUrl('');setProgress('PDFを読み込み中…')
    try{
      const {readCertificate}=await import('../lib/meti-certificate-reader')
      const result=await readCertificate(file,controller.signal,setProgress)
      if(!controller.signal.aborted){setData(result);setPdfUrl(URL.createObjectURL(file))}
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'PDFを読み込めませんでした。元のPDFを確認してください。')}
    finally{if(!controller.signal.aborted)setBusy(false)}
  }
  const toggle=(key:string)=>setSelected(old=>{const next=new Set(old);if(next.has(key))next.delete(key);else next.add(key);return next})
  const change=(key:keyof CertificateData,value:string)=>{setData(d=>({...d??certificateEmpty,[key]:value}));setConfirmed(false)}
  async function save(){
    if(lock.current||!data||!confirmed)return
    let request:CertificateRequest
    try{request=pending??certificateRequest(project,customer,data,selected)}catch(e){setError((e as Error).message);return}
    lock.current=true;setSaving(true);setError('');setPending(request)
    try{await saveCertificate(request);onSaved()}
    catch(e){const certain=e instanceof CertificateSaveError&&!e.uncertain;if(certain)setPending(null);setError(`${(e as Error).message}${certain?'':' 保存結果が不明な場合は、同じ内容で再確認できます。'}`)}
    finally{lock.current=false;setSaving(false)}
  }
  const customerName=customer?customerDisplayName(customer):'所有者未登録'
  const mismatch=data&&((project.grid_id&&!certificateSame(project.grid_id,data.gridId))||(data.businessName&&!certificateSame(customerName,data.businessName)))
  return <Modal title="認定書PDFを読み込む" width={920} onClose={onClose} closeDisabled={saving}>
    <div className="meti-import">
      <div className="meti-import-heading"><b>{project.plant_name||project.project_name}</b><span>顧客：{customerName}</span></div>
      <div className="meti-file-row"><label className="meti-file">認定書PDF<input type="file" accept="application/pdf,.pdf" disabled={busy||saving||!!pending} onChange={e=>void read(e.target.files?.[0])}/></label>{pdfUrl&&<a className="btn btn-sub btn-sm" href={pdfUrl} title={fileName} target="_blank" rel="noreferrer">元のPDFを開く</a>}</div>
      <small>PDFはこの端末内で読み取ります。チェックして「反映する」を押すまで登録内容は変わりません。</small>
      {busy&&<p role="status">{progress}</p>}
      {error&&<p role="alert" className="meti-error">{error}</p>}
      {data&&<>
        <div className="meti-identity"><span>PDFの事業者名</span><b>{data.businessName||'読み取れませんでした'}</b>{mismatch&&<strong>登録中の顧客名・設備IDと違いがあります。PDFが正しいか確認してください。</strong>}</div>
        <p className="meti-instruction">反映したい項目にチェックしてください。</p>
        <div className="meti-comparison" aria-label="現在の登録内容とPDFの比較">
          <div className="meti-compare-head"><span>反映する項目</span><span>現在の登録内容</span><span>PDFから読み取った内容</span></div>
          {certificateFields.map(f=>{
            const current=String(project[f.key]??''),value=data[f.source],same=certificateSame(current,value)&&!!value
            return <div className="meti-compare-row" key={f.key}>
              <label><input type="checkbox" checked={selected.has(f.key)} disabled={saving||!!pending||(!value||same)&&!selected.has(f.key)} onChange={()=>toggle(f.key)}/>{f.label}{same&&<small>一致</small>}</label>
              <span className="meti-current">{current||'未登録'}</span>
              <label className="meti-extracted"><span className="meti-mobile-label">読み取り内容</span><input aria-label={`PDFの${f.label}`} className="form-input" type={f.type==='date'?'date':'text'} inputMode={f.type==='number'?'decimal':undefined} value={value} placeholder="読み取れませんでした" disabled={saving||!!pending} onChange={e=>change(f.source,e.target.value)}/></label>
            </div>
          })}
          <div className="meti-compare-row"><label><input type="checkbox" checked={selected.has('customer_address')} disabled={saving||!!pending||(!customer||!data.businessAddress||certificateSame(customer?.address,data.businessAddress))&&!selected.has('customer_address')} onChange={()=>toggle('customer_address')}/>顧客情報の住所</label><span className="meti-current">{customer?.address||'未登録'}</span><label className="meti-extracted"><span className="meti-mobile-label">読み取り内容</span><textarea aria-label="PDFの事業者住所" className="form-input" rows={2} value={data.businessAddress} disabled={saving||!!pending} onChange={e=>change('businessAddress',e.target.value)}/><small>変更すると、この顧客のほかの発電所でも同じ住所になります。</small></label></div>
          <div className="meti-compare-row"><label><input type="checkbox" checked={selected.has('meti_notes')} disabled={saving||!!pending||((!data.businessAddress&&!data.siteAddress)||certificateNotes(project.meti_notes,data)===(project.meti_notes??''))&&!selected.has('meti_notes')} onChange={()=>toggle('meti_notes')}/>経済産業省の備考に住所を追記</label><span className="meti-current">{project.meti_notes||'未登録'}</span><div className="meti-extracted"><span>事業者住所：{data.businessAddress||'読み取れませんでした'}</span><label>発電所住所<textarea aria-label="PDFの発電所住所" className="form-input" rows={2} value={data.siteAddress} disabled={saving||!!pending} onChange={e=>change('siteAddress',e.target.value)}/></label><small>概要の住所：{project.site_address||'未登録'}<br/>概要の住所と今ある備考を残して追記します。</small></div></div>
        </div>
        <label className="meti-confirm"><input type="checkbox" checked={confirmed} disabled={saving||!!pending} onChange={e=>setConfirmed(e.target.checked)}/>この発電所の認定証明書であることと、選んだ項目の内容を確認しました</label>
      </>}
      <div className="meti-actions"><button type="button" className="btn btn-sub" disabled={saving} onClick={onClose}>閉じる</button><button type="button" className="btn btn-main" disabled={busy||saving||!data||!confirmed||!selected.size} onClick={()=>void save()}>{saving?'保存中…':pending?'同じ内容で保存を再確認':selected.size?`選んだ${selected.size}項目を反映する`:'選んだ項目を反映する'}</button></div>
    </div>
  </Modal>
}
