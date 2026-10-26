import {parseCertificate,type CertificateText} from './meti-certificate'

/** File bytes stay in this browser. CMaps/worker are served by our own app. */
export async function readCertificate(file:File,signal:AbortSignal,onProgress:(s:string)=>void){
  if(!/\.pdf$/i.test(file.name)||file.size>15*1024*1024||file.size===0)throw Error('15MB以内のPDFファイルを選んでください。')
  const bytes=new Uint8Array(await file.arrayBuffer())
  if(new TextDecoder().decode(bytes.slice(0,1024)).indexOf('%PDF-')<0)throw Error('PDFファイルを確認してください。')
  const pdfjs=await import('pdfjs-dist')
  const worker=await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc=worker.default
  const task=pdfjs.getDocument({data:bytes,cMapUrl:`${location.origin}/pdf-resources/cmaps/`,cMapPacked:true,stopAtErrors:true})
  const abort=()=>{void task.destroy()};signal.addEventListener('abort',abort,{once:true})
  try{
    if(signal.aborted)throw Error('読み込みを中止しました。')
    const pdf=await task.promise
    if(pdf.numPages>10)throw Error('10ページ以内の認定証明書を選んでください。')
    const items:CertificateText[]=[]
    for(let n=1;n<=pdf.numPages;n++){
      onProgress(`${n} / ${pdf.numPages}ページを読み込み中…`)
      const page=await pdf.getPage(n),text=await page.getTextContent()
      for(const i of text.items)if('str'in i)items.push({text:i.str,x:i.transform[4],y:i.transform[5],width:i.width,page:n})
      if(items.length>20000)throw Error('このPDFは情報量が多いため読み込めません。認定証明書だけのPDFを選んでください。')
      page.cleanup()
    }
    if(signal.aborted)throw Error('読み込みを中止しました。')
    if(!items.some(i=>i.text.trim()))throw Error('画像のみのPDFはまだ読み取れません。文字を選択できる元のPDFを選んでください。')
    return parseCertificate(items)
  }catch(e){
    if(e instanceof Error&&e.name==='PasswordException')throw Error('パスワード保護のないPDFを選んでください。')
    throw e
  }finally{signal.removeEventListener('abort',abort);await task.destroy()}
}
