// Real rendered event handlers, with all business writers denied.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),React=require('react'),cache=new Map()
const hooks={...React,useState:init=>[typeof init==='function'?init():init,()=>{}],useMemo:fn=>fn()}
function load(file){
 file=path.resolve(root,file)
 if(cache.has(file))return cache.get(file).exports
 if(file.endsWith('/components/Toast.tsx'))return {useToast:()=>()=>{throw Error('Unexpected mutation toast')}}
 if(file.endsWith('/lib/actions.ts'))return new Proxy({},{get:()=>()=>{throw Error('Business writes forbidden')}})
 const m={exports:{}};cache.set(file,m)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
  {module:m,exports:m.exports,sessionStorage:{getItem:()=>null,setItem:()=>{throw Error('Unexpected storage write')}},require:n=>{
   if(n==='react')return hooks
   if(n==='react/jsx-runtime')return require(n)
   if(!n.startsWith('.'))throw Error('External access forbidden')
   const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'))
  }})
 return m.exports
}
const {Prospects}=load('src/views/Prospects.tsx')
const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
const prospects=[{id:17,customer_name:'検証顧客',project_name:'検証発電所',converted_customer_id:23,apply_status:'未',contract_status:'未'},
 {id:18,customer_name:'未登録顧客',project_name:'未登録発電所',converted_customer_id:null,apply_status:'未',contract_status:'未'}]
const before=JSON.stringify(prospects),calls=[]
const tree=Prospects({prospects,customers:[],onReload:()=>{throw Error('No reload expected')},
 onViewDetail:id=>calls.push(['prospect',id]),onViewProject:id=>calls.push(['project',id]),onViewCustomer:id=>calls.push(['customer',id])})
const rows=nodes(tree,e=>e.type==='tr'&&e.props.className==='clickable-row')
assert.equal(rows.length,2)
for(const [i,row] of rows.entries()){
 const button=nodes(row,e=>e.type==='button'&&e.props.className.includes('prospect-detail-button'))[0]
 assert.equal(button.props.type,'button');assert.equal(button.props.children,'見込み詳細')
 assert.equal(button.props['aria-label'],`${prospects[i].project_name}の見込み詳細を開く`)
 let stopped=false
 button.props.onClick({stopPropagation(){stopped=true}})
 // Model real bubbling only when the child handler did not stop it.
 const cells=nodes(row,e=>e.type==='td')
 assert.ok(nodes(cells[1],e=>e===button).length,'Button must be beside the project name, not in the far-right action column')
 if(!stopped){cells[1].props.onClick({stopPropagation(){stopped=true}});if(!stopped)row.props.onClick()}
 assert.equal(stopped,true)
 assert.deepEqual(calls.pop(),['prospect',prospects[i].id]);assert.equal(calls.length,0,'No duplicate or project navigation')
 row.props.onClick();assert.deepEqual(calls.pop(),['prospect',prospects[i].id])
 for(const [column,kind] of [[0,'customer'],[1,'project']]){
  stopped=false;cells[column].props.onClick({stopPropagation(){stopped=true}})
  if(prospects[i].converted_customer_id){assert.equal(stopped,true);assert.deepEqual(calls.pop(),[kind,23])}
  else {assert.equal(stopped,false);row.props.onClick();assert.deepEqual(calls.pop(),['prospect',18])}
 }
}
assert.equal(JSON.stringify(prospects),before);assert.equal(calls.length,0)
const css=fs.readFileSync(path.join(root,'src/styles.css'),'utf8')
assert.match(css,/\.prospect-detail-button\s*\{[^}]*min-height:\s*44px;[^}]*white-space:\s*nowrap;/s)
assert.match(css,/\.prospect-detail-button:focus-visible/)
console.log('PASS: explicit prospect detail button by plant name, one correct-ID navigation, stopped bubbling, unchanged customer/project/row routes, touch target and no business writes')
