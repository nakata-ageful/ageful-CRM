import {parseCertificate,type CertificateText} from './meti-certificate'

const stopped=()=>new Error('PDFの読み込みを中止しました。')
/** File bytes stay in this browser. Parsing runs in PDF.js's worker, created
 * only after selection. Every exit path terminates it, including close/timeout. */
export async function readCertificate(file:File,signal:AbortSignal,onProgress:(s:string)=>void){
  if(signal.aborted)throw stopped()
  if(!/\.pdf$/i.test(file.name)||file.size>15*1024*1024||file.size===0)throw Error('15MB以内のPDFファイルを選んでください。')
  let rejectWait:(e:Error)=>void=()=>{},destroy:(()=>Promise<void>)|undefined,forceStop:(()=>void)|undefined,cancelled=false
  const interrupted=new Promise<never>((_,reject)=>{rejectWait=reject})
  const wait=<T,>(promise:Promise<T>)=>Promise.race([promise,interrupted])
  const cancel=(error:Error)=>{cancelled=true;rejectWait(error);forceStop?.();void destroy?.().catch(()=>{})}
  const abort=()=>cancel(stopped())
  signal.addEventListener('abort',abort,{once:true})
  const timeout=setTimeout(()=>cancel(new Error('PDFの読み込みに時間がかかっています。通信状況やPDFを確認して、もう一度お試しください。')),45000)
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
    engineWorker=new pdfjs.PDFWorker({port})
    const task=pdfjs.getDocument({data:bytes,worker:engineWorker,cMapUrl:`${location.origin}/pdf-resources/cmaps/`,cMapPacked:true,stopAtErrors:true})
    let destroyed:Promise<void>|undefined
    destroy=()=>destroyed??(destroyed=task.destroy().finally(()=>forceStop?.()))
    const pdf=await wait(task.promise)
    if(pdf.numPages>10)throw Error('10ページ以内の認定書を選んでください。')
    const items:CertificateText[]=[]
    let characters=0
    for(let n=1;n<=pdf.numPages;n++){
      onProgress(`${n} / ${pdf.numPages}ページを読み込み中…`)
      if(signal.aborted)throw stopped()
      const page=await wait(pdf.getPage(n))
      try{
        const text=await wait(page.getTextContent())
        for(const i of text.items)if('str'in i){
          characters+=i.str.length
          if(items.length>=20000||characters>1000000)throw Error('このPDFは情報量が多いため読み込めません。認定書だけのPDFを選んでください。')
          items.push({text:i.str,x:i.transform[4],y:i.transform[5],width:i.width,page:n})
        }
      }finally{page.cleanup()}
    }
    if(signal.aborted)throw stopped()
    if(!items.some(i=>i.text.trim()))throw Error('画像のみのPDFはまだ読み取れません。文字を選択できる元のPDFを選んでください。')
    return parseCertificate(items)
  }catch(e){
    if(e instanceof Error&&e.name==='PasswordException')throw Error('パスワード保護のないPDFを選んでください。')
    if(e instanceof Error&&e.name==='InvalidPDFException')throw Error('PDFを読み込めませんでした。元のPDFを確認してください。')
    throw e
  }finally{
    clearTimeout(timeout);signal.removeEventListener('abort',abort)
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
