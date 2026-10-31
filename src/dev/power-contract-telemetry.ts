// Local preview instrumentation only, never imported by the production app.
if(import.meta.env.MODE!=='operator-demo')throw Error('Isolation required')
let liveWorkers=0,start=0,elapsed=0,longTasks:number[]=[],reading=false
const NativeWorker=window.Worker
window.Worker=class extends NativeWorker{
 private live=true
 constructor(url:string|URL,options?:WorkerOptions){super(url,options);liveWorkers++;this.addEventListener('message',e=>{if(e.data?.action==='recognize'&&e.data?.status==='resolve'){const lines=(e.data.data?.blocks??[]).flatMap((b:{paragraphs:{lines:{text:string}[]}[]})=>b.paragraphs.flatMap(p=>p.lines.map(l=>l.text)));const out=document.getElementById('power-debug');if(out)out.textContent+='\n'+lines.join('\n')}})}
 terminate(){if(this.live){liveWorkers--;this.live=false}super.terminate()}
}
let longTasksSupported=false
if(PerformanceObserver.supportedEntryTypes?.includes('longtask')){longTasksSupported=true;new PerformanceObserver(list=>{for(const e of list.getEntries())if(start&&e.startTime>=start)longTasks.push(e.duration)}).observe({type:'longtask'})}
window.addEventListener('change',e=>{if(e.target instanceof HTMLInputElement&&e.target.type==='file'){start=performance.now();elapsed=0;longTasks=[];reading=true}},true)
new MutationObserver(()=>{if(reading&&(document.querySelector('.meti-identity')||document.querySelector('.form-error'))){elapsed=Math.round(performance.now()-start);reading=false}}).observe(document.body,{childList:true,subtree:true})
setInterval(()=>{const out=document.getElementById('power-metrics');if(!out)return;const assets=performance.getEntriesByType('resource').filter(e=>e.startTime>=start&&e.name.includes('/pdf-resources/ocr/'));const text=JSON.stringify({elapsedMs:elapsed,reading,liveWorkers,ocrAssetRequests:assets.length,longTasksSupported,maxLongTaskMs:Math.round(Math.max(0,...longTasks))});if(out.textContent!==text)out.textContent=text},250)
