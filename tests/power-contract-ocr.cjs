const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const code=ts.transpileModule(fs.readFileSync('src/lib/power-contract-ocr.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function setup(stuck=false){let stopped=0,port,packets=[],url;const m={exports:{}};class Worker{constructor(u){url=u;port=this}terminate(){stopped++}postMessage(p){packets.push(p);if(stuck)return;queueMicrotask(()=>this.onmessage({data:{jobId:p.jobId,status:'resolve',data:p.action==='recognize'?{blocks:[]}:undefined}}))}}
 vm.runInNewContext(code,{module:m,exports:m.exports,Error,Promise,Map,Math,Worker,location:{origin:'http://local.test'}})
 const signal=new AbortController(),engine=m.exports.createPowerOcr(signal.signal,()=>{})
 return{engine,signal,packets,stopped:()=>stopped,url:()=>url,port:()=>port}
}
;(async()=>{
 for(let i=0;i<20;i++){const e=setup();await e.engine.init();assert.equal(e.url(),'http://local.test/pdf-resources/ocr/worker.min.js');assert.deepEqual(e.packets.map(p=>p.action),['load','loadLanguage','initialize','setParameters']);assert.equal(e.packets[0].payload.options.corePath,'http://local.test/pdf-resources/ocr/core');assert.equal(e.packets[1].payload.options.langPath,'http://local.test/pdf-resources/ocr');assert.equal(e.packets[1].payload.options.cacheMethod,'none');await e.engine.read(new Uint8Array([1]),1,100,1);e.engine.stop();e.engine.stop();assert.equal(e.stopped(),1)}
 let e=setup(true),pending=e.engine.init();e.signal.abort();await assert.rejects(pending,/中止/);assert.equal(e.stopped(),1,'Abort kills a stuck WASM/language initialization immediately')
 e=setup(true);pending=e.engine.init();e.port().onerror();await assert.rejects(pending,/文字認識/);assert.equal(e.stopped(),1)
 e=setup();e.signal.abort();await assert.rejects(e.engine.init(),/中止/);assert.equal(e.stopped(),1)
 console.log('PASS: pinned worker protocol, same-origin language/WASM, zero CDN requests, immediate cancellation during initialization, worker errors and repeated reads clean up exactly once')
})().catch(e=>{console.error(e);process.exitCode=1})
