// Exercise the actual component and Modal handlers with synthetic data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const root=path.resolve(__dirname,'..')
function load(file,hooks,overrides,dom){
 file=path.resolve(root,file);const m={exports:{}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Date,Error,Set,Map,AbortController,HTMLElement:dom.Element,document:dom.document,URL:{createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}},require:n=>{
  if(n in overrides)return overrides[n]
  if(n==='react')return {...React,...hooks}
  if(n==='react/jsx-runtime')return require(n)
  if(n.endsWith('.css'))return{}
  if(!n.startsWith('.'))throw Error('Unexpected external dependency: '+n)
  const p=path.resolve(path.dirname(file),n)
  if(/\/(supabase|mock-store|actions)$/.test(p))throw Error('Business access forbidden')
  return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'),hooks,overrides,dom)
 }});return m.exports
}
const sample={provider:'kansai',businessName:'合成顧客',gridId:'ZZ12345A67',certifiedAt:'2018-11-29',pointId:'06-1111-2222-3333-4444-5555',supplyStart:'2019-12-20',changeDate:'2023-06-27',fitPrice:'18',fitMonth:'2040-01',notes:'合成書類の備考',ocr:false}
const walk=(e,p)=>Array.isArray(e)?e.flatMap(v=>walk(v,p)):!e?.props||e.props.style?.display==='none'?[]:[...(p(e)?[e]:[]),...walk(e.props.children,p)]
const button=(t,name)=>{const b=walk(t,e=>e.type==='button'&&e.props.children===name)[0];assert.ok(b,'Button missing: '+name);return b}
const field=(t,name)=>{const f=walk(t,e=>e.props['aria-label']===name)[0];assert.ok(f,'Field missing: '+name);return f}
const checkbox=(t,label)=>{const l=walk(t,e=>e.type==='label'&&Array.isArray(e.props.children)&&e.props.children.some(c=>c===label))[0];assert.ok(l,'Checkbox missing: '+label);return walk(l,e=>e.type==='input'&&e.props.type==='checkbox')[0]}
function harness(save){
 let i=0,j=0,closed=0,saved=0,layout=[],runEffects=false,modalCleanup;const states=[],refs=[],listeners=new Map(),writes=[]
 class Element{constructor(){this.isConnected=true;this.scrollTop=150}focus(){doc.activeElement=this}contains(e){return e===input}closest(selector){return selector==='.modal-body'?body:box}}
 const doc={activeElement:null,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n,f)=>{if(listeners.get(n)===f)listeners.delete(n)}}
 const body=new Element(),box=new Element(),form=new Element(),input=new Element();doc.activeElement=input
 const hooks={useState(v){const n=i++;if(!(n in states))states[n]=typeof v==='function'?v():v;return[states[n],v=>states[n]=typeof v==='function'?v(states[n]):v]},useRef(v){return refs[j++]??(refs[j-1]={current:v})},useEffect(f){if(runEffects)modalCleanup=f()},useLayoutEffect(f){layout.push(f)}}
 class SaveError extends Error{constructor(m,uncertain){super(m);this.uncertain=uncertain}}
 const overrides={'../lib/power-contract-reader':{readPowerContract:async()=>({...sample})},'../lib/power-contract-save':{PowerContractSaveError:SaveError,savePowerContract:async req=>{writes.push(req);if(save)return save(req,SaveError)}}}
 const {PowerContractImport}=load('src/components/PowerContractImport.tsx',hooks,overrides,{Element,document:doc})
 const props={project:{id:1,customer_id:2,project_name:'合成発電所',fit_period:20},customer:{id:2,name:'合成顧客',is_corporate:false},onClose:()=>closed++,onSaved:()=>saved++}
 function render(){i=0;j=0;layout=[];const t=PowerContractImport(props);const surface=walk(t,e=>e.type==='div'&&e.props.className==='meti-import')[0];if(surface)surface.props.ref.current=form;for(const effect of layout)effect();return t}
 function modal(t){modalCleanup?.();runEffects=true;const n=t.type(t.props);runEffects=false;return n}
 return{render,closed:()=>closed,saved:()=>saved,writes,body,doc,input,SaveError,async load(){const t=render();walk(t,e=>e.type==='input'&&e.props.type==='file')[0].props.onChange({target:{files:[{name:'synthetic.pdf'}]}});await new Promise(resolve=>setImmediate(resolve))},closeVia(kind){const n=modal(render());if(kind==='background')n.props.onClick();else if(kind==='x')walk(n,e=>e.props['aria-label']==='閉じる')[0].props.onClick();else if(kind==='escape')listeners.get('keydown')({key:'Escape'});else button(render(),'閉じる').props.onClick()}}
}
;(async()=>{
 let h=harness();h.closeVia('footer');assert.equal(h.closed(),1,'No draft closes without prompting')
 h=harness();await h.load();h.closeVia('x');assert.equal(h.closed(),1,'Reading alone is not a manual edit')
 for(const kind of ['footer','x','background','escape']){
  h=harness();await h.load();field(h.render(),'PDFのFIT（税抜・円）').props.onChange({target:{value:'19'}});checkbox(h.render(),'FIT（税抜・円）').props.onChange();
  h.closeVia(kind);assert.equal(h.closed(),0);assert.match(h.render().props.title,/保存せずに閉じ/)
  h.body.scrollTop=0;h.doc.activeElement=null;button(h.render(),'編集を続ける').props.onClick();const t=h.render()
  assert.equal(field(t,'PDFのFIT（税抜・円）').props.value,'19');assert.equal(checkbox(t,'FIT（税抜・円）').props.checked,true);assert.equal(h.body.scrollTop,150);assert.equal(h.doc.activeElement,h.input,'Return restores the input focus');assert.equal(h.writes.length,0)
  h.closeVia(kind);h.closeVia('escape');assert.equal(h.closed(),0);assert.equal(field(h.render(),'PDFのFIT（税抜・円）').props.value,'19','Escape dismisses the confirmation, not the draft')
  h.closeVia(kind);button(h.render(),'保存せずに閉じる').props.onClick();assert.equal(h.closed(),1);assert.equal(h.writes.length,0)
 }
 h=harness();await h.load();field(h.render(),'PDFのFIT（税抜・円）').props.onChange({target:{value:'19'}});field(h.render(),'PDFのFIT（税抜・円）').props.onChange({target:{value:'18'}});h.closeVia('footer');assert.equal(h.closed(),1,'Restoring the original value without selections is not dirty')
 h=harness();await h.load();checkbox(h.render(),'FIT（税抜・円）').props.onChange();h.closeVia('footer');assert.equal(h.closed(),0,'A selection alone is retained too')
 let rejectSave,finishSave
 h=harness((_,SaveError)=>new Promise((resolve,reject)=>{rejectSave=()=>reject(new SaveError('結果未確認',true));finishSave=resolve}));await h.load()
 checkbox(h.render(),'FIT（税抜・円）').props.onChange();const confirm=walk(h.render(),e=>e.type==='input'&&e.props.type==='checkbox').at(-1);confirm.props.onChange({target:{checked:true}})
 const old=h.render(),first=button(old,'選んだ1項目を反映する').props.onClick();old.props.onClose();assert.equal(h.closed(),0,'Synchronous save lock blocks closing before React rerenders');assert.equal(h.render().props.closeDisabled,true)
 rejectSave();await new Promise(resolve=>setImmediate(resolve));h.closeVia('footer');assert.match(h.render().props.title,/保存結果を確認せず/);button(h.render(),'画面に戻る').props.onClick();h.render()
 const retry=button(h.render(),'同じ内容で保存を再確認').props.onClick();finishSave();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.saved(),1);assert.equal(h.writes.length,2);assert.equal(h.writes[0],h.writes[1],'Confirmation cancellation preserves the exact pending retry request')
 console.log('PASS: all four close paths, keep edits/selections/focus/scroll, safe Escape, explicit discard, unchanged read/revert, save lock, and uncertain-save retry preserved')
})().catch(e=>{console.error(e);process.exitCode=1})
