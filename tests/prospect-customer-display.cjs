// Synthetic identities only. All business writers are denied.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports
 const m={exports:{}};cache.set(file,m)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Intl,sessionStorage:{getItem:()=>null},require:n=>{
  if(n==='react')return React;if(n==='react/jsx-runtime')return require(n);if(n.endsWith('.css'))return {}
  if(n.endsWith('/actions'))return new Proxy({},{get:()=>()=>{throw Error('Business write forbidden')}})
  if(n.endsWith('/Toast'))return {useToast:()=>()=>{throw Error('Unexpected toast')}}
  if(!n.startsWith('.'))throw Error('External access forbidden')
  const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'))
 }});return m.exports}
const {prospectCustomerDisplay:display}=load('src/lib/prospect-customer-display.ts')
const customers=[{id:1,is_corporate:true,name:'同名担当',name_kana:'タントウ',company_name:'合成会社A'},{id:2,is_corporate:true,name:'同名担当',company_name:'合成会社B'},{id:3,is_corporate:false,name:'合成個人',company_name:'古い会社欄'}]
const p={id:11,customer_name:'同名担当',converted_customer_id:1,project_name:'合成発電所',apply_status:'未',contract_status:'未',apply_tasks:{},contract_tasks:{},apply_sub_tasks:{},contract_sub_tasks:{}}
const before=JSON.stringify({customers,p})
assert.equal(display(p,customers).name,'合成会社A')
assert.equal(display({...p,converted_customer_id:2},customers).name,'合成会社B','Match IDs, never identical contacts')
assert.equal(display({...p,converted_customer_id:3},customers).name,'合成個人')
assert.equal(display({...p,ownership_project_id:55,candidate_customer_id:2},customers).name,'合成会社B')
assert.equal(display({...p,new_project_id:55,converted_customer_id:null},customers).name,'顧客未定')
assert.equal(display(p,[]).name,'同名担当','Missing identity must not match by name')
const {renderToStaticMarkup:render}=require('react-dom/server')
const {Prospects}=load('src/views/Prospects.tsx')
const html=render(React.createElement(Prospects,{prospects:[p,{...p,id:12,converted_customer_id:2}],customers,onReload(){},onViewDetail(){},onViewProject(){},onViewCustomer(){}}))
assert.ok(html.includes('合成会社A')&&html.includes('合成会社B'))
const {ProspectDetailView}=load('src/views/ProspectDetail.tsx')
for(const row of [p,{...p,new_project_id:55,customer_name:'合成会社A'}]){
 const detail=render(React.createElement(ProspectDetailView,{prospect:row,customers,onBack(){},onViewCustomer(){},onViewProject(){}}))
 assert.ok(detail.includes('顧客名（会社名）')&&detail.includes('担当者名')&&detail.includes('担当者フリガナ'))
 assert.ok(detail.includes('value="合成会社A"')&&detail.includes('value="同名担当"'))
}
assert.equal(JSON.stringify({customers,p}),before)
console.log('PASS: corporate labels by customer ID, individual/undecided/missing-ID fallback, rendered list/detail, separate unchanged contacts, no writes')
