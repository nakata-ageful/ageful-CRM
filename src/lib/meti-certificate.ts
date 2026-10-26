import type {Customer, Project} from '../types'

export type CertificateText = {text:string;x:number;y:number;width:number;page:number}
export type CertificateData = {
  businessName:string;businessAddress:string;siteAddress:string;gridId:string;certifiedAt:string;
  panelMaker:string;panelModel:string;panelCount:string;panelKw:string
}
export const certificateEmpty:CertificateData={businessName:'',businessAddress:'',siteAddress:'',gridId:'',certifiedAt:'',panelMaker:'',panelModel:'',panelCount:'',panelKw:''}
const norm=(s:string)=>s.normalize('NFKC').replace(/(?<=\d)[ー−‐](?=\d)/g,'-').trim()
const compact=(s:string)=>norm(s).replace(/\s/g,'')
export const certificateSame=(a:unknown,b:unknown)=>compact(String(a??''))===compact(String(b??''))

/** The supported JPEA form has labels in the left column and values to their right.
 * Use coordinates, not PDF stream order (the latter mixes headings and values).
 * Ambiguous repeated labels are never silently resolved to the first match. */
export function parseCertificate(items:CertificateText[]):CertificateData {
  const content=items.map(i=>({...i,text:norm(i.text)})).filter(i=>i.text)
  if(!content.some(i=>compact(i.text).includes('発電の認定の証明について')))throw Error('認定証明書の書式を確認できませんでした。JPEAの認定証明書PDFを選んでください。')
  function value(label:string):string {
    const labels=content.filter(i=>compact(i.text)===label)
    if(labels.length!==1)return ''
    const l=labels[0]
    const next=content.filter(i=>i.page===l.page&&Math.abs(i.x-l.x)<4&&i.y<l.y-3).sort((a,b)=>b.y-a.y)[0]
    const bottom=Math.max(l.y-50,next?next.y+4:l.y-12)
    const values=content.filter(i=>i.page===l.page&&i.x>l.x+l.width+5&&i.y<=l.y+3&&i.y>bottom)
      .sort((a,b)=>Math.abs(a.y-b.y)<3?a.x-b.x:b.y-a.y)
    return values.map(i=>i.text).join(' ').trim()
  }
  const date=value('認定日').match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日$/)
  const certifiedAt=date?`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`:''
  const gridId=compact(value('設備ID'))
  const count=compact(value('枚数')).match(/^(\d+)枚$/)
  const kw=compact(value('合計出力')).match(/^(\d+(?:\.\d+)?)kW$/i)
  return {
    businessName:value('事業者名'),businessAddress:value('事業者住所'),siteAddress:value('発電設備の設置場所'),
    gridId:/^[A-Z0-9]{6,30}$/.test(gridId)?gridId:'',certifiedAt:validCertificateDate(certifiedAt)?certifiedAt:'',
    panelMaker:value('製造事業者名'),panelModel:value('型式番号'),panelCount:count?.[1]??'',panelKw:kw?.[1]??'',
  }
}
export function validCertificateDate(s:string){const date=new Date(`${s}T00:00:00Z`);return /^\d{4}-\d{2}-\d{2}$/.test(s)&&s>='1900-01-01'&&s<='9999-12-31'&&!Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===s}
export function certificateNotes(existing:string|null|undefined,d:CertificateData):string {
  const lines=[d.businessAddress?`事業者住所：${d.businessAddress}`:'',d.siteAddress?`発電所住所：${d.siteAddress}`:''].filter(Boolean)
  const added=lines.filter(line=>!(existing??'').includes(line))
  return [existing?.trim(),added.length?`【認定証明書】\n${added.join('\n')}`:''].filter(Boolean).join('\n\n')
}
export const certificateFields=[
  {key:'grid_id',source:'gridId',label:'設備ID',type:'text'},
  {key:'grid_certified_at',source:'certifiedAt',label:'認定日',type:'date'},
  {key:'panel_maker',source:'panelMaker',label:'パネル メーカー',type:'text'},
  {key:'panel_model',source:'panelModel',label:'パネル 型式',type:'text'},
  {key:'panel_count',source:'panelCount',label:'パネル 枚数',type:'number'},
  {key:'panel_kw',source:'panelKw',label:'パネル 合計出力（kW）',type:'number'},
] as const
export type CertificateProjectPatch=Partial<Pick<Project,'grid_id'|'grid_certified_at'|'panel_maker'|'panel_model'|'panel_count'|'panel_kw'|'meti_notes'>>
export type CertificateRequest={projectId:number;customerId:number|null;before:CertificateProjectPatch;patch:CertificateProjectPatch;customerBefore:string|null;customerAddress:string|null;updateCustomer:boolean}
export function certificateRequest(project:Project,customer:Customer|null,d:CertificateData,selected:Set<string>):CertificateRequest {
  const patch:CertificateProjectPatch={},before:CertificateProjectPatch={}
  for(const f of certificateFields){
    if(!selected.has(f.key))continue
    const v=d[f.source].trim()
    if(!v)throw Error(`${f.label}が空欄です。読み取り内容を確認してください。`)
    if(f.type==='date'&&!validCertificateDate(v))throw Error('認定日を確認してください。')
    if(f.key==='grid_id'&&!/^[A-Z0-9]{6,30}$/.test(v))throw Error('設備IDは半角英数字で確認してください。')
    if(f.type==='number'&&(!/^\d+(?:\.\d+)?$/.test(v)||Number(v)<=0||Number(v)>1000000||(f.key==='panel_count'&&!Number.isInteger(Number(v)))))throw Error(`${f.label}を確認してください。`)
    Object.assign(patch,{[f.key]:f.type==='number'?Number(v):v});Object.assign(before,{[f.key]:project[f.key]??null})
  }
  if(selected.has('meti_notes')){if(!d.businessAddress&&!d.siteAddress)throw Error('住所を読み取れませんでした。');patch.meti_notes=certificateNotes(project.meti_notes,d);before.meti_notes=project.meti_notes??null}
  const updateCustomer=selected.has('customer_address')
  if(updateCustomer&&(!customer||!d.businessAddress.trim()))throw Error('顧客または事業者住所を確認してください。')
  if(!Object.keys(patch).length&&!updateCustomer)throw Error('反映する項目を選んでください。')
  return {projectId:project.id,customerId:project.customer_id,before,patch,customerBefore:customer?.address??null,customerAddress:updateCustomer?d.businessAddress.trim():null,updateCustomer}
}
