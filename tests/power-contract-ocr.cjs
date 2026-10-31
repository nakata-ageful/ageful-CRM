const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const helpers={};function helper(n){n=n.replace('./','');if(helpers[n])return helpers[n];const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/'+n+'.ts','utf8'),{compilerOptions:{module:1,target:9}}).outputText,{module:m,exports:m.exports,Date,Set,require:helper});return helpers[n]=m.exports}
const code=ts.transpileModule(fs.readFileSync('src/lib/power-contract-ocr.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function setup(stuck=false,replies=[]){let stopped=0,port,packets=[],url;const m={exports:{}};class Worker{constructor(u){url=u;port=this}terminate(){stopped++}postMessage(p){packets.push(p);if(stuck===true||typeof stuck==='function'&&stuck(p))return;queueMicrotask(()=>this.onmessage({data:{jobId:p.jobId,status:'resolve',data:p.action==='recognize'?(replies.shift()??{blocks:[]}):undefined}}))}}
 vm.runInNewContext(code,{module:m,exports:m.exports,Error,Promise,Map,Math,Worker,require:helper,location:{origin:'http://local.test'}})
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
 const kansai=blocks([line('関西電力送配電株式会社',10),line('電力受給契約内容のお知らせ',30),line('古い誤読',110)])
 const cell=(left,top)=>({left,top,width:80,height:30}),tables=[{cells:[cell(10,100),cell(100,100)]},{cells:[cell(10,150),cell(100,150)]}]
 let isolated=setup(false,[kansai,blocks([line('認定ID',110)]),blocks([line('受電地点特定番号',160)]),blocks([line('ZZ12345A67',110)]),blocks([line('06-1111-2222-3333-4444-5555',160)])]);await isolated.engine.init();read=await isolated.engine.read(new Uint8Array([1]),1,1000,1,tables);isolated.engine.stop()
 assert.ok(read.some(i=>i.text==='ZZ12345A67'));assert.ok(read.some(i=>i.text==='06-1111-2222-3333-4444-5555'));assert.ok(!read.some(i=>i.text==='古い誤読'))
 assert.deepEqual(isolated.packets.filter(p=>p.action==='initialize').map(p=>p.payload.langs),['jpn','eng','jpn']);assert.equal(isolated.packets.filter(p=>p.action==='loadLanguage'&&p.payload.langs==='eng').length,1)
 isolated=setup(false,[kansai,blocks([line('認定ID',110)]),blocks([line('受電地点特定番号',160)]),blocks([line('ZZ12345A678',110)]),blocks([line('06-1111-2222-3333-4444-555',160)])]);await isolated.engine.init();read=await isolated.engine.read(new Uint8Array([1]),1,1000,1,tables);isolated.engine.stop();assert.ok(!read.some(i=>i.text.includes('ZZ12345')||i.text.includes('06-1111')),'Incomplete/extra digits stay blank without repair')
 console.log('PASS: cell-isolated numeric recognition, same-origin English loaded lazily, Japanese restored, bad digits not repaired, original row replaced')
 const completeText=['関西電力','電力受給契約内容のお知らせ','認定IDZZ12345A67認定日2018年11月29日','受電地点特定番号06-1111-2222-3333-4444-5555','受給開始日2019年12月20日接続契約日2018年8月16日','特定契約日2023年6月27日契約変更日2024年8月1日','買取単価18円に消費税を加える']
 const completeScan=blocks(completeText.map((text,i)=>line(text,10+i*35)))
 let normal=setup(false,[completeScan]);await normal.engine.init();await normal.engine.read(new Uint8Array([1]),1,1000,1,tables);normal.engine.stop();assert.equal(normal.packets.filter(p=>p.action==='recognize').length,1,'A fully read contract never runs cell OCR or loads English')
 let loading=setup(p=>p.action==='loadLanguage'&&p.payload.langs==='eng',[kansai,blocks([line('認定ID',110)]),blocks([line('受電地点特定番号',160)])]);await loading.engine.init();const loadingJob=loading.engine.read(new Uint8Array([1]),1,1000,1,tables);await new Promise(r=>setImmediate(r));loading.signal.abort();await assert.rejects(loadingJob,/中止/);assert.equal(loading.stopped(),1,'Cancelling a pending English model load terminates the worker')
 const correctDate=blocks([...kansai.blocks[0].paragraphs[0].lines,line('受給開始日2024年5月8日',210)])
 const dateTable=[{cells:[cell(10,200),cell(100,200)]}]
 let preserve=setup(false,[correctDate,blocks([line('受給開始日',210)])]);await preserve.engine.init();read=await preserve.engine.read(new Uint8Array([1]),1,1000,1,dateTable);preserve.engine.stop();assert.ok(read.some(i=>i.text==='受給開始日2024年5月8日'),'Existing valid date is never reread/replaced')
 console.log('PASS: complete first-pass skips all cell retries, valid dates preserved, cancellation while loading English')
 let e=setup(true),pending=e.engine.init();e.signal.abort();await assert.rejects(pending,/中止/);assert.equal(e.stopped(),1,'Abort kills a stuck WASM/language initialization immediately')
 e=setup(true);pending=e.engine.init();e.port().onerror();await assert.rejects(pending,/文字認識/);assert.equal(e.stopped(),1)
 e=setup();e.signal.abort();await assert.rejects(e.engine.init(),/中止/);assert.equal(e.stopped(),1)
 console.log('PASS: pinned worker protocol, same-origin language/WASM, zero CDN requests, immediate cancellation during initialization, worker errors and repeated reads clean up exactly once')
})().catch(e=>{console.error(e);process.exitCode=1})
