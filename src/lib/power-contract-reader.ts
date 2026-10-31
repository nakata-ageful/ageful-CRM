import type {CertificateText} from './meti-certificate'
import {parsePowerContract} from './power-contract'
import {createPowerOcr} from './power-contract-ocr'

const stopped=()=>new Error('PDFの読み込みを中止しました。')
/** File bytes stay in this browser. Parsing runs in PDF.js's worker, created
 * only after selection. Every exit path terminates it, including close/timeout. */
export async function readPowerContract(file:File,signal:AbortSignal,onProgress:(s:string)=>void){
  if(signal.aborted)throw stopped()
  if(!/\.pdf$/i.test(file.name)||file.size>15*1024*1024||file.size===0)throw Error('15MB以内のPDFファイルを選んでください。')
  let ocr:ReturnType<typeof createPowerOcr>|undefined,usedOcr=false,scanPages=0
  let rejectWait:(e:Error)=>void=()=>{},destroy:(()=>Promise<void>)|undefined,forceStop:(()=>void)|undefined,cancelled=false
  const interrupted=new Promise<never>((_,reject)=>{rejectWait=reject})
  const wait=<T,>(promise:Promise<T>)=>Promise.race([promise,interrupted])
  const cancel=(error:Error)=>{cancelled=true;rejectWait(error);ocr?.stop();forceStop?.();void destroy?.().catch(()=>{})}
  const abort=()=>cancel(stopped())
  signal.addEventListener('abort',abort,{once:true})
  const timeout=setTimeout(()=>cancel(new Error('PDFの読み込みに時間がかかっています。通信状況やPDFを確認して、もう一度お試しください。')),120000)
  try{
    const bytes=new Uint8Array(await wait(file.arrayBuffer()))
    if(new TextDecoder().decode(bytes.slice(0,1024)).indexOf('%PDF-')<0)throw Error('PDFファイルを確認してください。')
    const [pdfjs,worker]=await wait(Promise.all([import('pdfjs-dist'),import('pdfjs-dist/build/pdf.worker.min.mjs?url')]))
    if(signal.aborted)throw stopped()
    // Own the real browser worker: never fall back to parsing a PDF on the UI
    // thread, and terminate directly even if a damaged PDF never acknowledges close.
    const port=new Worker(worker.default,{type:'module'})
    let engineWorker:InstanceType<typeof pdfjs.PDFWorker>|undefined,disposed=false
    forceStop=()=>{if(disposed)return;disposed=true;engineWorker?.destroy();port.terminate()}
    engineWorker=pdfjs.PDFWorker.create({port})
    const task=pdfjs.getDocument({data:bytes,worker:engineWorker,cMapUrl:`${location.origin}/pdf-resources/cmaps/`,cMapPacked:true,stopAtErrors:true})
    let destroyed:Promise<void>|undefined
    destroy=()=>destroyed??(destroyed=task.destroy().finally(()=>forceStop?.()))
    const pdf=await wait(task.promise)
    if(pdf.numPages>10)throw Error('10ページ以内の電力会社の契約書を選んでください。')
    const items:CertificateText[]=[]
    let characters=0
    for(let n=1;n<=pdf.numPages;n++){
      onProgress(`${n} / ${pdf.numPages}ページを読み込み中…`)
      if(signal.aborted)throw stopped()
      const page=await wait(pdf.getPage(n))
      try{
        const text=await wait(page.getTextContent())
        if(!text.items.some(i=>'str'in i&&i.str.trim())){
          if(++scanPages>3)throw Error('画像のページが多いため読み込めません。3ページ以内に分けてください。')
          if(!ocr){ocr=createPowerOcr(signal,onProgress);await wait(ocr.init())}
          usedOcr=true
          const base=page.getViewport({scale:1}),scale=Math.min(3,Math.sqrt(5000000/(base.width*base.height)))
          const viewport=page.getViewport({scale}),canvas=document.createElement('canvas')
          canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height)
          try{
            const context=canvas.getContext('2d');if(!context)throw Error('このブラウザーでは画像を読み取れません。')
            await wait(page.render({canvasContext:context,canvas,viewport}).promise)
            const blob=await wait(new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('画像を読み取れませんでした。')),'image/png')))
            const extracted=await wait(ocr.read(new Uint8Array(await wait(blob.arrayBuffer())),n,canvas.height,scale))
            if(extracted.length+items.length>20000)throw Error('PDFの情報量が多すぎます。')
            items.push(...extracted)
          }finally{canvas.width=0;canvas.height=0}
        }
        for(const i of text.items)if('str'in i){
          characters+=i.str.length
          if(items.length>=20000||characters>1000000)throw Error('このPDFは情報量が多いため読み込めません。電力会社の契約書だけのPDFを選んでください。')
          items.push({text:i.str,x:i.transform[4],y:i.transform[5],width:i.width,page:n})
        }
      }finally{page.cleanup()}
    }
    if(signal.aborted)throw stopped()
    if(!items.some(i=>i.text.trim()))throw Error('文字を読み取れませんでした。鮮明なPDFを選んでください。')
    return parsePowerContract(items,usedOcr)
  }catch(e){
    if(e instanceof Error&&e.name==='PasswordException')throw Error('パスワード保護のないPDFを選んでください。')
    if(e instanceof Error&&e.name==='InvalidPDFException')throw Error('PDFを読み込めませんでした。元のPDFを確認してください。')
    throw e
  }finally{
    ocr?.stop();clearTimeout(timeout);signal.removeEventListener('abort',abort)
    if(cancelled){forceStop?.();void destroy?.().catch(()=>{})}
    else if(destroy){
      let cleanupTimer:ReturnType<typeof setTimeout>|undefined
      // Graceful cleanup normally finishes immediately. A dead worker cannot
      // keep the modal busy forever: after 1s force termination and return.
      await Promise.race([destroy().catch(()=>{}),new Promise<void>(resolve=>{cleanupTimer=setTimeout(()=>{forceStop?.();resolve()},1000)})])
      clearTimeout(cleanupTimer);forceStop?.()
    }else forceStop?.()
  }
}
