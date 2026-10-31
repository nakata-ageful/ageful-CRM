import type {CertificateText} from './meti-certificate'
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
 let stopped=false,serial=0
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
  async read(image:Uint8Array,page:number,height:number,scale:number):Promise<CertificateText[]>{
   await job('setParameters',{params:{tessedit_pageseg_mode:'11'}})
   const result=await job('recognize',{image,options:{},output:{text:false,blocks:true}})
   let lines=(result.blocks??[]).flatMap(b=>b.paragraphs.flatMap(p=>p.lines))
   const compact=(s:string)=>s.normalize('NFKC').replace(/\s/g,'')
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
