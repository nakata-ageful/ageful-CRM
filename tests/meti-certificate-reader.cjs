// Fake PDF.js worker lifecycle only: no real credentials, files or network.
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm')
const source=fs.readFileSync('src/lib/meti-certificate-reader.ts','utf8'),code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const pending=()=>new Promise(()=>{})
function env(options={}){
 let destroyCount=0,created=0,cleaned=0,reads=0,timer,cleared=false,parsed=0,terminated=0,cleanupTimer
 const fakePage={getTextContent:()=>options.textPending?pending():Promise.resolve({items:options.items??[{str:'text',transform:[1,0,0,1,50,60],width:100}]}),cleanup(){cleaned++}}
 const task={promise:options.documentPending?pending():Promise.resolve({numPages:options.pages??2,getPage:()=>Promise.resolve(fakePage)}),destroy:()=>{destroyCount++;return options.destroyPending?pending():Promise.resolve()}}
 const fakePdf={PDFWorker:class{destroy(){}},getDocument(){created++;return task}}
 const m={exports:{}}
 vm.runInNewContext(code,{module:m,exports:m.exports,Error,Promise,TextDecoder,Uint8Array,location:{origin:'http://local.invalid'},
  Worker:class{terminate(){terminated++}},setTimeout(fn,ms){if(ms===45000)timer=fn;else{assert.equal(ms,1000);cleanupTimer=fn}return 1},clearTimeout(){cleared=true},
  require(name){if(name==='pdfjs-dist')return options.importPending?pending():fakePdf;if(name.includes('pdf.worker'))return{default:'/local-worker.mjs'};if(name==='./meti-certificate')return{parseCertificate(items){parsed++;if(options.parseError)throw Error('unsupported form');return{count:items.length}}};throw Error(name)}
 })
 const file={name:options.name??'test.pdf',size:options.size??128,arrayBuffer:()=>{reads++;return options.filePending?pending():Promise.resolve(new TextEncoder().encode(options.badHeader?'not pdf':'%PDF-1.7\n').buffer)}}
 const controller=new AbortController()
 return{run:(cb=()=>{})=>m.exports.readCertificate(file,controller.signal,cb),controller,tick:()=>timer(),cleanupTick:()=>cleanupTimer(),terminated:()=>terminated,stats:()=>({destroyCount,created,cleaned,reads,cleared,parsed})}
}
const turn=()=>new Promise(resolve=>setImmediate(resolve))
;(async()=>{
 let e=env();await e.run();assert.deepEqual(e.stats(),{destroyCount:1,created:1,cleaned:2,reads:1,cleared:true,parsed:1})
 for(const options of [{pages:11},{items:[]},{parseError:true},{items:[{str:'x'.repeat(1000001),transform:[1,0,0,1,1,1],width:1}]}]){
  e=env(options);await assert.rejects(e.run());assert.equal(e.stats().destroyCount,1);assert.equal(e.stats().cleared,true)
 }
 e=env({documentPending:true});let job=e.run();await turn();assert.equal(e.stats().created,1);e.controller.abort();await assert.rejects(job,/中止/);assert.equal(e.stats().destroyCount,1)
 e=env({documentPending:true,destroyPending:true});job=e.run();await turn();e.tick();await assert.rejects(job,/時間/);assert.equal(e.terminated(),1,'A stuck worker is killed even if task.destroy never settles')
 e=env({destroyPending:true});job=e.run();await turn();e.cleanupTick();await job;assert.equal(e.terminated(),1,'Normal cleanup also has a hard stop')
 e=env({textPending:true});job=e.run();await turn();e.controller.abort();await assert.rejects(job,/中止/);assert.equal(e.stats().destroyCount,1);assert.equal(e.stats().cleaned,1)
 e=env({documentPending:true});job=e.run();await turn();e.tick();await assert.rejects(job,/時間/);assert.equal(e.stats().destroyCount,1)
 e=env({importPending:true});job=e.run();await turn();e.controller.abort();await assert.rejects(job,/中止/);assert.equal(e.stats().created,0,'Closing while loading the library never creates a late worker')
 e=env({filePending:true});job=e.run();e.controller.abort();await assert.rejects(job,/中止/);assert.equal(e.stats().created,0)
 e=env();e.controller.abort();await assert.rejects(e.run(),/中止/);assert.equal(e.stats().reads,0)
 for(const options of [{size:16*1024*1024},{size:0},{name:'not-a-pdf.txt'},{badHeader:true}]){e=env(options);await assert.rejects(e.run());assert.equal(e.stats().created,0)}
 for(let n=0;n<30;n++){e=env();await e.run();assert.equal(e.stats().destroyCount,1)}
 console.log('PASS: lazy worker creation, normal/error/oversize/empty/parse cleanup, early file/import cancellation, active-document/text cancellation, 45s timeout, limits, and 30 repeated reads each terminate once')
})().catch(e=>{console.error(e);process.exitCode=1})
