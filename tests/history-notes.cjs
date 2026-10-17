// Synthetic execution of actual note state + editor. No network or real data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const root=path.resolve(__dirname,'..'),state=[],refs=[];let cursor=0,refCursor=0
const hooks={...React,useState(v){const i=cursor++;if(!(i in state))state[i]=typeof v==='function'?v():v;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v]},useRef(v){return refs[refCursor++]??(refs[refCursor-1]={current:v})}}
function load(f){const file=path.resolve(root,f),m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Date,Intl,Set,Map,require:n=>{if(n==='react')return hooks;if(n==='react/jsx-runtime')return require(n);if(!n.startsWith('.'))throw Error('No external dependency');const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'))}});return m.exports}
const {historyNoteState,historyNotesFromStorage}=load('src/lib/history-notes.ts'),{HistoryNoteEditor}=load('src/components/HistoryNoteEditor.tsx')
const original='元の確認内容',n={operation_key:'aaaa',project_id:1,kind:'ownership',target_id:'1',revision:1,original_text:original,previous_text:original,text:'修正した確認内容',created_at:'2026-10-17T02:00:00Z'}
assert.equal(historyNoteState([],n.kind,n.target_id,original,1).text,original)
assert.equal(historyNoteState([n],n.kind,n.target_id,original,1).text,n.text)
assert.equal(historyNoteState([n],'workflow','1',original,1).text,original)
assert.equal(historyNoteState([n],n.kind,n.target_id,original,2).text,original)
const n2={...n,operation_key:'bbbb',revision:2,previous_text:n.text,text:'二度目の訂正'}
assert.equal(historyNoteState([n2,n],n.kind,n.target_id,original,1).text,n2.text)
assert.throws(()=>historyNoteState([n2],n.kind,n.target_id,original,1),/つながり/)
assert.throws(()=>historyNoteState([{...n,previous_text:'不一致'}],n.kind,n.target_id,original,1),/つながり/)
assert.equal(historyNotesFromStorage([n]).length,1)
for(const invalid of [null,{},[null],[{...n,text:''}],[{...n,revision:0}],[n,n],[{...n,kind:'invoice'}]])assert.throws(()=>historyNotesFromStorage(invalid),/訂正履歴/)
for(const kind of ['billing','management']){
 const note={...n,kind,text:`${kind}の訂正文`}
 assert.equal(historyNotesFromStorage([note])[0].kind,kind)
 assert.equal(historyNoteState([note],kind,'1',original,1).text,note.text)
 assert.equal(historyNoteState([note],'ownership','1',original,1).text,original,'Same numeric ID across kinds stays isolated')
}
const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
const text=e=>Array.isArray(e)?e.map(text).join(''):e?.props?text(e.props.children):typeof e==='string'?e:''
let props={projectId:1,kind:'ownership',targetId:'1',original,notes:[n]},tree
function render(){cursor=0;refCursor=0;tree=HistoryNoteEditor(props);return tree}
const button=label=>nodes(tree,e=>e.type==='button'&&text(e)===label)[0]
;(async()=>{
 render();assert(!button('確認内容を編集'),'read-only records never show editing')
 let received=[],reject=true,release
 props.onSave=async v=>{received.push(v);if(reject)throw Error('保存結果が不明');await new Promise(r=>release=r)}
 render();button('確認内容を編集').props.onClick();render()
 const textarea=()=>nodes(tree,e=>e.type==='textarea')[0]
 assert.equal(textarea().props.value,n.text);assert(button('確認内容を保存').props.disabled)
 textarea().props.onChange({target:{value:'  正しい文章  '}});render();assert(!button('確認内容を保存').props.disabled)
 await button('確認内容を保存').props.onClick();await new Promise(setImmediate);render()
 assert(text(tree).includes('保存結果が不明'));assert(textarea(),'failed save keeps input')
 reject=false;button('確認内容を保存').props.onClick();render();button('保存中…').props.onClick();assert.equal(received.length,2,'duplicate click must not write again')
 assert.equal(received[1].text,'正しい文章');assert.equal(received[1].expectedRevision,1);assert.equal(received[1].targetId,'1');assert.equal(received[1].kind,'ownership')
 release();await new Promise(setImmediate);render();assert(!textarea())
 assert(text(tree).includes('訂正履歴'));assert(text(tree).includes(original));assert.equal(props.notes[0].text,n.text)
 console.log('PASS: note chain/type/project isolation, readonly rendering, prefilled edit, unchanged/blank guard, scoped revision payload, duplicate click lock, failed-save retention and immutable original text')
})().catch(e=>{console.error(e);process.exitCode=1})
