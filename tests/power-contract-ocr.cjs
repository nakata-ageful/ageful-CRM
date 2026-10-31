const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const code=ts.transpileModule(fs.readFileSync('src/lib/power-contract-ocr.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function setup(stuck=false,replies=[]){let stopped=0,port,packets=[],url;const m={exports:{}};class Worker{constructor(u){url=u;port=this}terminate(){stopped++}postMessage(p){packets.push(p);if(stuck)return;queueMicrotask(()=>this.onmessage({data:{jobId:p.jobId,status:'resolve',data:p.action==='recognize'?(replies.shift()??{blocks:[]}):undefined}}))}}
 vm.runInNewContext(code,{module:m,exports:m.exports,Error,Promise,Map,Math,Worker,location:{origin:'http://local.test'}})
 const signal=new AbortController(),engine=m.exports.createPowerOcr(signal.signal,()=>{})
 return{engine,signal,packets,stopped:()=>stopped,url:()=>url,port:()=>port}
}
;(async()=>{
 for(let i=0;i<20;i++){const e=setup();await e.engine.init();assert.equal(e.url(),'http://local.test/pdf-resources/ocr/worker.min.js');assert.deepEqual(e.packets.map(p=>p.action),['load','loadLanguage','initialize','setParameters']);assert.equal(e.packets[0].payload.options.corePath,'http://local.test/pdf-resources/ocr/core');assert.equal(e.packets[1].payload.options.langPath,'http://local.test/pdf-resources/ocr');assert.equal(e.packets[1].payload.options.cacheMethod,'none');await e.engine.read(new Uint8Array([1]),1,100,1);e.engine.stop();e.engine.stop();assert.equal(e.stopped(),1)}
 // Synthetic ruled-table retry: replace the whole pass, not concatenate it.
 const line=(text,y)=>({bbox:{x0:10,y0:y,x1:300,y1:y+10},words:[{text,bbox:{x0:10,y0:y,x1:300,y1:y+10}}]})
 const blocks=ls=>({blocks:[{paragraphs:[{lines:ls}]}]})
 const sparse=blocks([line('九州電力株式会社',10),line('不完全な初回結果',30)])
 const headings=['九州電力株式会社','電力受給契約のご案内','受給開始日','固定買取終了年月','購入料金単価','受電地点特定番号','最大受電電力']
 const complete=blocks(headings.map((s,i)=>line(s,10+i*30)))
 let retry=setup(false,[sparse,complete]);await retry.engine.init();let read=await retry.engine.read(new Uint8Array([1]),1,1000,1);retry.engine.stop()
 assert.ok(read.some(i=>i.text==='固定買取終了年月'));assert.ok(!read.some(i=>i.text==='不完全な初回結果'))
 assert.equal(retry.packets.filter(p=>p.action==='setParameters'&&p.payload.params.tessedit_pageseg_mode==='6').length,1,'Only one block retry')
 retry=setup(false,[sparse,blocks([line('無関係な文章',10)])]);await retry.engine.init();read=await retry.engine.read(new Uint8Array([1]),1,1000,1);retry.engine.stop();assert.ok(read.some(i=>i.text==='不完全な初回結果'));assert.ok(!read.some(i=>i.text==='無関係な文章'))
 retry=setup(false,[blocks(headings.filter(s=>s!=='最大受電電力').map((s,i)=>line(s,10+i*30))),blocks([...headings,'関西電力'].map((s,i)=>line(s,10+i*30)))]);await retry.engine.init();read=await retry.engine.read(new Uint8Array([1]),1,1000,1);retry.engine.stop();assert.ok(!read.some(i=>i.text==='関西電力'),'Reject conflicting providers in retry')
 console.log('PASS: bounded table retry, complete same-provider contract required, no competing OCR-pass merge')
 let e=setup(true),pending=e.engine.init();e.signal.abort();await assert.rejects(pending,/中止/);assert.equal(e.stopped(),1,'Abort kills a stuck WASM/language initialization immediately')
 e=setup(true);pending=e.engine.init();e.port().onerror();await assert.rejects(pending,/文字認識/);assert.equal(e.stopped(),1)
 e=setup();e.signal.abort();await assert.rejects(e.engine.init(),/中止/);assert.equal(e.stopped(),1)
 console.log('PASS: pinned worker protocol, same-origin language/WASM, zero CDN requests, immediate cancellation during initialization, worker errors and repeated reads clean up exactly once')
})().catch(e=>{console.error(e);process.exitCode=1})
