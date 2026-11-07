// Render both real import components with synthetic drafts; never access a DB.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const root=path.resolve(__dirname,'..')
function render(component,data){
 data={businessName:'',businessAddress:'',siteAddress:'',gridId:'',certifiedAt:'',pointId:'',supplyStart:'',changeDate:'',fitPrice:'',fitMonth:'',notes:'',panelMaker:'',panelModel:'',panelCount:'',panelKw:'',...data}
 let index=0
 const hooks={useState(v){return[index++===0?data:typeof v==='function'?v():v,()=>{}]},useRef(v){return{current:v}},useEffect(){},useLayoutEffect(){}}
 function load(file){
  const m={exports:{}}
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Date,Set,Map,Error,require(n){
   if(n==='react')return{...React,...hooks}
   if(n==='react/jsx-runtime')return require(n)
   if(n.endsWith('.css'))return{}
   if(n.endsWith('-save'))return{}
   if(!n.startsWith('.'))throw Error('Unexpected dependency '+n)
   const p=path.resolve(path.dirname(file),n)
   if(/\/(supabase|mock-store|actions)$/.test(p))throw Error('Business access forbidden')
   return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'))
  }})
  return m.exports
 }
 const C=load(path.join(root,'src/components',component+'.tsx'))[component]
 return C({project:{id:1,project_name:'合成発電所'},customer:null,onClose(){},onSaved(){throw Error('No save permitted')}})
}
const walk=e=>Array.isArray(e)?e.flatMap(walk):!e?.props?[]:[e,...walk(e.props.children)]
for(const [component,data,count] of [
 ['PowerContractImport',{provider:'kansai',certifiedAt:'2018-11-03',supplyStart:'2018-11-03',changeDate:'2018-11-03',fitMonth:'2038-12'},4],
 ['PowerContractImport',{provider:'kyushu',changeDate:'2018-11-03',fitMonth:'2038-12'},2],
 ['MetiCertificateImport',{certifiedAt:'2018-11-03'},1]
]){
 const inputs=walk(render(component,data)).filter(e=>e.type==='input'),dates=inputs.filter(e=>['date','month'].includes(e.props.type))
 assert.equal(dates.length,count)
 for(const {props:p} of dates){
  assert.equal(p.max,p.type==='month'?'9999-12':'9999-12-31',p['aria-label'])
  assert.equal(p.min,p.type==='month'?'1900-01':'1900-01-01',p['aria-label'])
  assert.ok(p.value>=p.min&&p.value<=p.max,'Historical date remains editable')
 }
 for(const {props:p} of inputs.filter(e=>!['date','month'].includes(e.props.type))){assert.equal(p.min,undefined);assert.equal(p.max,undefined)}
}
console.log('PASS: both PDF import components constrain every date/month to four-digit years and permit historical dates; no data writes')
