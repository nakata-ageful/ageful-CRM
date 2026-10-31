import {validCertificateDate,type CertificateText} from './meti-certificate'
import {parsePowerContract} from './power-contract'
import type {PowerCell,PowerTableRow} from './power-contract-table'
type Box={x0:number;y0:number;x1:number;y1:number}
type OcrLine={bbox:Box;words:{text:string;bbox:Box}[]}
type OcrResult={blocks?:{paragraphs:{lines:OcrLine[]}[]}[]}
/** Tesseract.js 7.0.0's pinned worker message protocol (see src/createWorker.js).
 * Owning the native port lets cancellation kill even a worker stuck loading WASM,
 * which the async public createWorker factory cannot expose before init finishes.
 * Browser regression tests exercise this protocol against the installed worker.
 * All engine/language resources are same-origin. No PDF/image leaves the browser. */
export function createPowerOcr(signal:AbortSignal,onProgress:(s:string)=>void){
 const root=`${location.origin}/pdf-resources/ocr`,port=new Worker(`${root}/worker.min.js`)
 let stopped=false,serial=0,numericLoaded=false
 const pending=new Map<string,{resolve:(data:OcrResult)=>void;reject:(e:Error)=>void}>()
 const stop=()=>{if(stopped)return;stopped=true;port.terminate();for(const p of pending.values())p.reject(Error('文字認識を中止しました。'));pending.clear()}
 const fail=()=>{for(const p of pending.values())p.reject(Error('画像の文字認識ができませんでした。PDFが鮮明か確認して、もう一度お試しください。'));stop()}
 port.onerror=fail;port.onmessageerror=fail
 port.onmessage=({data})=>{const p=pending.get(data.jobId);if(!p)return;if(data.status==='progress'){onProgress(data.data?.status==='recognizing text'?`画像の文字を読み取り中… ${Math.round((data.data.progress??0)*100)}%`:'文字認識を準備中…');return}pending.delete(data.jobId);if(data.status==='resolve')p.resolve(data.data);else p.reject(Error('画像の文字認識に失敗しました。元のPDFを確認してください。'))}
 signal.addEventListener('abort',stop,{once:true})
 const job=(action:string,payload:unknown)=>new Promise<OcrResult>((resolve,reject)=>{if(stopped||signal.aborted){reject(Error('文字認識を中止しました。'));return}const jobId=`power-${++serial}`;pending.set(jobId,{resolve,reject});port.postMessage({workerId:'power-contract',jobId,action,payload})})
 return {
  async init(){
   await job('load',{options:{lstmOnly:true,corePath:`${root}/core`,logging:false}})
   await job('loadLanguage',{langs:'jpn',options:{langPath:root,gzip:true,cacheMethod:'none',lstmOnly:true}})
   await job('initialize',{langs:'jpn',oem:1,config:{}})
   await job('setParameters',{params:{tessedit_pageseg_mode:'11'}})
  },
  async read(image:Uint8Array,page:number,height:number,scale:number,tableRows:PowerTableRow[]=[]):Promise<CertificateText[]>{
   await job('setParameters',{params:{tessedit_pageseg_mode:'11'}})
   const result=await job('recognize',{image,options:{},output:{text:false,blocks:true}})
   let lines=(result.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines))
   const compact=(s:string)=>s.normalize('NFKC').replace(/\s/g,'')
   const pageText=compact(lines.flatMap(l=>l.words.map(w=>w.text)).join(''))
   const toItems=()=>lines.flatMap(l=>l.words.map(w=>({text:w.text,x:w.bbox.x0/scale,y:(height-(l.bbox.y0+l.bbox.y1)/2)/scale,width:(w.bbox.x1-w.bbox.x0)/scale,page})))
   let baseline:ReturnType<typeof parsePowerContract>|undefined
   if(tableRows.length&&pageText.includes('関西電力')&&!pageText.includes('九州電力')&&pageText.includes('電力受給契約内容のお知らせ')){
    try{baseline=parsePowerContract(toItems(),true)}catch{/* Incomplete OCR is handled by the normal parser after retry. */}
    if(!baseline||['gridId','certifiedAt','pointId','supplyStart','changeDate','fitPrice','fitMonth'].some(k=>!baseline![k as keyof typeof baseline])){
     onProgress('読み取れなかった表の項目を確認しています…')
     const readCell=async(rectangle:PowerCell)=>{
      const cell=await job('recognize',{image,options:{rectangle},output:{text:false,blocks:true}})
      return compact((cell.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines.flatMap(l=>l.words.map(w=>w.text)))).join(''))
     }
     type Pair={label:string;labelCell:PowerCell;valueCell:PowerCell;value:string}
     const pairs:Pair[]=[],numbers:{pair:Pair;kind:'id'|'point'|'power'}[]=[]
     const labels=['ご契約名義','受電地点特定番号','発電設備設置場所','認定ID','受給開始日','特定契約日','受給最大電力','買取単価','発電設備区分','買取期間','買取者','備考']
     const nameOf=(s:string)=>labels.find(l=>s===l||l==='特定契約日'&&/^特定.{2}日\(受給契約日\)$/.test(s))
     const inCell=(w:{bbox:Box},c:PowerCell)=>w.bbox.x0>=c.left-3*scale&&w.bbox.x0<c.left+c.width+3*scale&&w.bbox.y0>=c.top-3*scale&&w.bbox.y1<=c.top+c.height+3*scale
     const validDate=(s:string)=>{const m=s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);return !!m&&validCertificateDate(`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`)}
     await job('setParameters',{params:{tessedit_pageseg_mode:'6',tessedit_char_whitelist:''}})
     for(const row of tableRows.slice(0,24)){
      // Reuse clear first-pass headings instead of re-reading every cell.
      const initial=compact(lines.flatMap(l=>l.words.filter(w=>inCell(w,row.cells[0])).map(w=>w.text)).join(''))
      const name=nameOf(initial)??nameOf(await readCell(row.cells[0]))
      if(!name)continue
      const key=name==='受給開始日'?'supplyStart':name==='特定契約日'?'changeDate':name==='買取単価'?'fitPrice':undefined
      if(key&&!baseline?.[key]){
       const value=await readCell(row.cells[1]),valid=key==='fitPrice'?/^\d+(?:\.\d+)?円/.test(value)&&value.includes('消費税'):validDate(value)
       if(valid)pairs.push({label:name,labelCell:row.cells[0],valueCell:row.cells[1],value})
      }
      if(name==='認定ID'||name==='受電地点特定番号'||name==='受給最大電力'&&!baseline?.notes.includes('最大受電電力：')){
       const pair={label:name,labelCell:row.cells[0],valueCell:row.cells[1],value:''};pairs.push(pair)
       numbers.push({pair,kind:name==='認定ID'?'id':name==='受給最大電力'?'power':'point'})
      }
      // An adjacent date is used only under its own positively read heading.
      const second=name==='認定ID'&&!baseline?.certifiedAt?'認定日':name==='受給開始日'?'接続契約日':name==='特定契約日'?'契約変更日':''
      if(row.cells.length===4&&second==='認定日'&&await readCell(row.cells[2])===second){const value=await readCell(row.cells[3]);if(validDate(value))pairs.push({label:second,labelCell:row.cells[2],valueCell:row.cells[3],value})}
     }
     if(numbers.length){
      if(!numericLoaded){await job('loadLanguage',{langs:'eng',options:{langPath:root,gzip:true,cacheMethod:'none',lstmOnly:true}});numericLoaded=true}
      await job('initialize',{langs:'eng',oem:1,config:{}})
      for(const {pair,kind} of numbers){
       await job('setParameters',{params:{tessedit_pageseg_mode:'7',tessedit_char_whitelist:kind==='id'?'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789':kind==='power'?'0123456789.kW':'0123456789-'}})
       const value=await readCell(pair.valueCell),valid=kind==='id'?/^(?:[A-Z]{2}[0-9]{5}|[A-Z][0-9]{6})[A-Z][0-9]{2}$/:kind==='power'?/^\d{1,3}\.\d+kW$/:/^\d{2}(?:-\d{4}){5}$/
       if(valid.test(value))pair.value=value
      }
      await job('initialize',{langs:'jpn',oem:1,config:{}})
      await job('setParameters',{params:{tessedit_pageseg_mode:'11',tessedit_char_whitelist:''}})
     }
     for(const pair of pairs){
      // An unsuccessful retry preserves the original result. Name/address and
      // already-valid dates/prices never pass through this correction path.
      if(!pair.value)continue
      for(const line of lines)line.words=line.words.filter(w=>!inCell(w,pair.labelCell)&&!inCell(w,pair.valueCell))
      const y=pair.labelCell.top+pair.labelCell.height/2
      for(const [text,cell]of [[pair.label,pair.labelCell],[pair.value,pair.valueCell]] as const)lines.push({bbox:{x0:cell.left,x1:cell.left+cell.width,y0:y,y1:y},words:[{text,bbox:{x0:cell.left,x1:cell.left+cell.width,y0:y,y1:y}}]})
     }
    }
   }
   // A table rule can obscure decimal points or the first characters. Re-read
   // just these two labelled cells as single lines; accept only complete values.
   if(lines.some(l=>compact(l.words.map(w=>w.text).join('')).includes('九州電力'))){
    // Sparse-text segmentation can omit almost an entire ruled table. The
    // three-column form has no transaction-counter heading to anchor a crop.
    // Retry once as a text block, accepting it only when the actual table
    // headings and the same contract/provider are present. Do not combine
    // competing OCR passes or infer cells from hard-coded page coordinates.
    const tableLabels=['受給開始日','固定買取終了年月','購入料金単価','受電地点特定番号','最大受電電力']
    const textOf=(ls:OcrLine[])=>compact(ls.flatMap(l=>l.words.map(w=>w.text)).join(''))
    if(!tableLabels.every(label=>textOf(lines).includes(label))){
     onProgress('契約書の表を読み取り直しています…')
     await job('setParameters',{params:{tessedit_pageseg_mode:'6'}})
     const table=await job('recognize',{image,options:{},output:{text:false,blocks:true}})
     const tableLines=(table.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines)),text=textOf(tableLines)
     if(text.includes('九州電力')&&!text.includes('関西電力')&&text.includes('電力受給契約のご案内')&&tableLabels.every(label=>text.includes(label)))lines=tableLines
    }
    const startLines=lines.filter(l=>compact(l.words.map(w=>w.text).join('')).startsWith('受給開始日'))
    const thirdLines=lines.filter(l=>compact(l.words.map(w=>w.text).join('')).startsWith('取引開始指示数'))
    if(startLines.length===1&&thirdLines.length===1&&Math.abs(startLines[0].bbox.y0-thirdLines[0].bbox.y0)<10*scale){
     const first=startLines[0].bbox,third=thirdLines[0].bbox,half=(third.x0-first.x0)/2
     const rectangle={left:Math.floor(first.x0+half-8*scale),top:Math.floor(first.y0-4*scale),width:Math.floor(half),height:Math.ceil(40*scale)}
     await job('setParameters',{params:{tessedit_pageseg_mode:'6'}})
     const cell=await job('recognize',{image,options:{rectangle},output:{text:false,blocks:true}})
     const cellLines=(cell.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines))
     const text=compact(cellLines.flatMap(l=>l.words.map(w=>w.text)).join(''))
     if(text.includes('固定買取終了年月')&&/\d{4}年\d{1,2}月/.test(text)){
      for(const l of lines)l.words=l.words.filter(w=>!(w.bbox.x0>=rectangle.left&&w.bbox.x0<rectangle.left+rectangle.width&&w.bbox.y0>=rectangle.top&&w.bbox.y1<=rectangle.top+rectangle.height))
      lines.push(...cellLines)
     }
    }
    for(const spec of [{label:'最大受電電力',width:95,valid:/^\d{1,3}\.\d+kW$/i},{label:'電気方式',width:145,valid:/^交流(?:単相|三相|3相)[0-9]+線式$/}]){
     const anchors=lines.filter(l=>compact(l.words.map(w=>w.text).join('')).startsWith(spec.label));if(anchors.length!==1)continue
     const box=anchors[0].bbox,rectangle={left:Math.floor(box.x0),top:Math.floor((box.y0+box.y1)/2+5*scale),width:Math.ceil(spec.width*scale),height:Math.ceil(25*scale)}
     await job('setParameters',{params:{tessedit_pageseg_mode:'7'}})
     const cell=await job('recognize',{image,options:{rectangle},output:{text:false,blocks:true}})
     const cellLines=(cell.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines))
     if(!spec.valid.test(compact(cellLines.flatMap(l=>l.words.map(w=>w.text)).join(''))))continue
     for(const l of lines)l.words=l.words.filter(w=>!(w.bbox.x0>=rectangle.left&&w.bbox.x0<rectangle.left+rectangle.width&&w.bbox.y0>=rectangle.top&&w.bbox.y1<=rectangle.top+rectangle.height))
     lines.push(...cellLines)
    }
   }
   return lines.flatMap(l=>l.words.map(w=>({text:w.text,x:w.bbox.x0/scale,y:(height-(l.bbox.y0+l.bbox.y1)/2)/scale,width:(w.bbox.x1-w.bbox.x0)/scale,page})))
  },
  stop(){signal.removeEventListener('abort',stop);stop()},
 }
}
