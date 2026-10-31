import type {Project} from '../types'
import {validCertificateDate,type CertificateText} from './meti-certificate'

export type PowerContractData={provider:'kansai'|'kyushu';businessName:string;gridId:string;certifiedAt:string;pointId:string;supplyStart:string;changeDate:string;fitPrice:string;fitMonth:string;notes:string;ocr:boolean}
export const powerFields=[
 {key:'grid_id',source:'gridId',label:'設備ID',type:'text'},
 {key:'grid_certified_at',source:'certifiedAt',label:'認定日',type:'date'},
 {key:'generation_point_id',source:'pointId',label:'受給地点番号',type:'text'},
 {key:'power_supply_start_date',source:'supplyStart',label:'受給開始日',type:'date'},
 {key:'power_change_date',source:'changeDate',label:'電力変更日',type:'date'},
 {key:'fit_period',source:'fitPrice',label:'FIT（税抜・円）',type:'number'},
 {key:'fit_end_date',source:'fitMonth',label:'FIT期間',type:'month'},
] as const
export type PowerPatch=Partial<Pick<Project,typeof powerFields[number]['key']|'power_company_notes'>>
export type PowerContractRequest={projectId:number;customerId:number|null;before:PowerPatch;patch:PowerPatch}
const norm=(s:string)=>s.normalize('NFKC').replace(/[−‐‑–—]/g,'-').trim()
const compact=(s:string)=>norm(s).replace(/\s/g,'')
export function kansaiFitMonth(start:string):string{
 if(!validCertificateDate(start))return ''
 const [year,month]=start.split('-').map(Number)
 const next=month===12?1:month+1,yy=year+20+(month===12?1:0)
 return yy<=9999?`${yy}-${String(next).padStart(2,'0')}`:''
}
function date(text:string){const m=compact(text).match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);const s=m?`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`:'';return validCertificateDate(s)?s:''}
function month(text:string){const m=compact(text).match(/(\d{4})年(\d{1,2})月/);const s=m?`${m[1]}-${m[2].padStart(2,'0')}`:'';return validCertificateDate(`${s}-01`)?s:''}
/** User-specified conversion for the supported Kyushu form. Never round a price. */
export function kyushuNetPrice(gross:string){if(!/^\d+(?:\.\d{1,2})?$/.test(gross))return '';const [a,b='']=gross.split('.');return String((Number(a)*100+Number(b.padEnd(2,'0')))/110)}
export function powerNotes(existing:string|null|undefined,incoming:string){const old=existing??'',addition=incoming.trim();if(!addition||old.includes(addition))return old;return [old.trim(),addition].filter(Boolean).join('\n\n')}

/** Read only a single supported contract page. Rows are reconstructed by position,
 * rather than PDF stream order. Additional terms pages cannot supply field values. */
export function parsePowerContract(input:CertificateText[],ocr=false):PowerContractData{
 const items=input.map(i=>({...i,text:compact(i.text)})).filter(i=>i.text)
 type Row={text:string;y:number;items:typeof items}
 function rowsFor(page:number){const rows:Row[]=[];for(const i of items.filter(i=>i.page===page).sort((a,b)=>b.y-a.y||a.x-b.x)){let r=rows.find(r=>Math.abs(r.y-i.y)<7);if(!r){r={text:'',y:i.y,items:[]};rows.push(r)}r.items.push(i)}for(const r of rows){r.items.sort((a,b)=>a.x-b.x);r.text=r.items.map(i=>i.text).join('')}return rows.sort((a,b)=>b.y-a.y)}
 const pages=[...new Set(items.map(i=>i.page))].map(page=>({page,rows:rowsFor(page)}))
 const contracts=pages.filter(p=>p.rows.some(r=>r.text.includes('電力受給契約内容のお知らせ')||r.text.includes('電力受給契約のご案内')))
 if(contracts.length!==1)throw Error('関西電力または九州電力の契約書を1件ずつ選んでください。書式を読み取れない場合は、鮮明なPDFをご用意ください。')
 const rows=contracts[0].rows,text=rows.map(r=>r.text).join('\n'),k=text.includes('関西電力'),q=text.includes('九州電力')
 if(k===q)throw Error('電力会社を特定できませんでした。関西電力・九州電力の契約書を1件ずつ選んでください。')
 const provider=k?'kansai':'kyushu'
 const row=(label:string)=>{const found=rows.filter(r=>r.text.startsWith(label));return found.length===1?found[0]:undefined}
 const right=(label:string)=>row(label)?.text.slice(label.length)??''
 // Kyushu's values are below their labels. Locate each column from the labels,
 // and stop before the next row; do not mix neighbouring dates/numbers.
 const labels=['受給開始日','固定買取終了年月','取引開始指示数','購入料金単価','最大受電電力','認定ID','電気方式','周波数','標準電圧','受電地点特定番号','発電場所']
 function below(label:string){
  const occurrences: {r:Row;x:number}[]=[]
  for(const r of rows.filter(r=>labels.some(l=>r.text.startsWith(l)))){let offset=0;for(const i of r.items){if(r.text.indexOf(label)===offset)occurrences.push({r,x:i.x});offset+=i.text.length}}
  if(occurrences.length!==1)return ''
  const {r,x}=occurrences[0]
  const other=labels.filter(l=>l!==label).map(l=>{let offset=0;for(const i of r.items){if(r.text.indexOf(l)===offset)return i.x;offset+=i.text.length}return Infinity}).filter(v=>v>x+20)
  const end=Math.min(...other,600)
  return rows.filter(v=>v.y<r.y-5&&v.y>r.y-25).flatMap(v=>v.items.filter(i=>i.x>=x-12&&i.x<end-5)).map(i=>i.text).join('')
 }
 const gridRaw=k?right('認定ID').split('認定日')[0]:below('認定')
 const ids=[...new Set(gridRaw.match(/[A-Z]{2}[0-9]{5}[A-Z][0-9]{2}/g)??[])]
 const gridId=ids.length===1?ids[0]:''
 const allPoints=text.match(/\d{2}(?:-\d{4}){5}/g)??[]
 if(allPoints.length>1)throw Error('複数の受給地点番号があります。契約書を1件ずつ選んでください。')
 const pointId=allPoints[0]??''
 const supplyStart=k?date(right('受給開始日').split('接続契約日')[0]):''
 const changeDate=k?date(right('特定契約日').split('契約変更日')[0]):date(below('受給開始日'))
 const certifiedAt=k?date(row('認定ID')?.text.split('認定日')[1]??''):''
 const fitMonth=k?kansaiFitMonth(supplyStart):month(below('固定買取終了年月'))
 const priceRaw=(k?right('買取単価'):below('購入料金単価')).match(/^(\d+(?:\.\d+)?)円/)
 // Kansai explicitly states tax is added. A different tax format is not guessed.
 const fitPrice=k?(priceRaw&&right('買取単価').includes('消費税')?String(Number(priceRaw[1])):''):(priceRaw?kyushuNetPrice(priceRaw[1]):'')
 const businessName=k?right('ご契約名義'):rows.filter(r=>r.text.endsWith('さま')&&r.y>(rows.find(r=>r.text.includes('電力受給契約のご案内'))?.y??0)).map(r=>r.text.replace(/さま$/,'')).join('')
 const site=k?right('発電設備設置場所'):below('発電場所')
 const max=(k?right('受給最大電力'):below('最大受電電力')).match(/^(\d{1,3}\.\d+)kW/i)?.[0]??''
 const electrical=q?below('電気方式').match(/交流(?:単相|三相|3相)[0-9]+線式/)?.[0]??'':''
 const freq=q?below('周波数').match(/^\d{2}Hz/i)?.[0]??'':''
 const volts=q?below('標準電圧').match(/^\d+V(?:または\d+V)?/)?.[0]??'':''
 const contactIndex=rows.findIndex(r=>k?r.text.startsWith('当社の連絡先'):r.text.includes('連絡先')&&r.text.length<15)
 const contactRows=contactIndex<0?[]:rows.slice(contactIndex,contactIndex+4)
 const contact=contactRows.map(r=>r.text).join('\n').replace(/^当社の連絡先[:：]?/,'').replace(/電話番号[:：]?/,'').split(/※|お問合せ/)[0].replace(/^[<〈＜].*?[>〉＞]\n?/,'').trim()
 const notes=[`【${k?'関西電力':'九州電力'} 契約書】`,site?`発電場所：${site}`:'',max?`最大受電電力：${max}`:'',[electrical,freq,volts].filter(Boolean).join('／'),contact?`電力会社連絡先：${contact}`:''].filter(Boolean).join('\n')
 return {provider,businessName,gridId,certifiedAt,pointId,supplyStart,changeDate,fitPrice,fitMonth,notes,ocr}
}

export function powerContractRequest(project:Project,data:PowerContractData,selected:Set<string>):PowerContractRequest{
 const patch:PowerPatch={},before:PowerPatch={}
 for(const f of powerFields){if(!selected.has(f.key))continue;const v=data[f.source].trim();if(!v)throw Error(`${f.label}の読み取り内容を入力してください。`)
  if(f.type==='date'&&!validCertificateDate(v)||f.type==='month'&&!validCertificateDate(`${v}-01`))throw Error(`${f.label}を確認してください。`)
  if(f.key==='grid_id'&&!/^[A-Z0-9]{6,30}$/.test(v))throw Error('設備IDを半角英数字で確認してください。')
  if(f.key==='generation_point_id'&&!/^\d{2}(?:-\d{4}){5}$/.test(v))throw Error('受給地点番号は22桁の数字をハイフンで区切って入力してください。')
  if(f.type==='number'&&(!/^\d+(?:\.\d+)?$/.test(v)||!Number.isInteger(Number(v))||Number(v)<=0||Number(v)>1000))throw Error('現在のFIT欄は整数の円単位です。小数の単価は丸めず、この項目を外してご相談ください。')
  Object.assign(patch,{[f.key]:f.type==='number'?Number(v):f.type==='month'?`${v}-01`:v});Object.assign(before,{[f.key]:project[f.key]??null})
 }
 if(selected.has('power_company_notes')){if(!data.notes.trim())throw Error('追記する備考を入力してください。');patch.power_company_notes=powerNotes(project.power_company_notes,data.notes);before.power_company_notes=project.power_company_notes??null}
 if(!Object.keys(patch).length)throw Error('反映する項目を選んでください。')
 return {projectId:project.id,customerId:project.customer_id,before,patch}
}
