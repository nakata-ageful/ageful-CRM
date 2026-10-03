// Isolated UI regression coverage: no network, DB writes or authenticated session.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..'),cache=new Map()
const browser={location:{hash:'#project-detail/1?tab=保守情報'}}
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports
 if(file.endsWith('/supabase.ts'))return {supabase:null,hasSupabaseEnv:false}
 if(/\/(actions|data|mock-store)\.ts$/.test(file))return new Proxy({},{get:()=>()=>{throw Error('Business data access forbidden')}})
 const module={exports:{}};cache.set(file,module)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {module,exports:module.exports,Date,URLSearchParams,window:browser,require:n=>{if(['react','react/jsx-runtime'].includes(n))return require(n);if(n.endsWith('.css'))return {};if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'))}})
 return module.exports}
const noSave=()=>{throw Error('UI rendering must not save')},render=(C,p)=>renderToStaticMarkup(React.createElement(C,p))
const {ProjectDetailView}=load('src/views/ProjectDetail.tsx'),{Modal}=load('src/components/Modal.tsx'),{AccountControls}=load('src/components/BillingAccessGate.tsx')
const detail={project:{id:1,plant_name:'検証発電所',customer_id:1},customer:{id:1,name:'検証顧客'},contract:{id:1,project_id:1},annualRecords:[],maintenanceResponses:[],periodicMaintenance:[],attachments:[]}
const props={detail,onBack:noSave,onReload:noSave,onViewCustomer:noSave,onViewMaintenance:noSave,
 managementTools:React.createElement('p',null,'管理専用の内容'),changeHistory:React.createElement('p',null,'履歴専用の内容')}
const before=JSON.stringify(detail)
for(const [tab,management,history] of [['保守情報',false,false],['管理設定',true,false],['変更履歴',false,true]]){
 browser.location.hash='#project-detail/1?tab='+encodeURIComponent(tab)
 const html=render(ProjectDetailView,props)
 assert.equal(html.includes('管理専用の内容'),management)
 assert.equal(html.includes('履歴専用の内容'),history)
 assert.ok(html.includes('管理設定')&&html.includes('変更履歴'))
 assert.ok(!html.includes('請求に含める項目'),'Billing checkboxes must not become a permanent display panel')
}
assert.equal(JSON.stringify(detail),before)
const modal=render(Modal,{title:'検証用の修正',onClose:noSave,children:React.createElement('p',null,'内容')})
assert.ok(modal.includes('role="dialog"')&&modal.includes('aria-modal="true"')&&modal.includes('aria-label="閉じる"'))
assert.equal(render(AccountControls,{}),'','Development preview must not fabricate a logout/session')
const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8'),project=fs.readFileSync(path.join(root,'src/views/ProjectDetail.tsx'),'utf8'),gate=fs.readFileSync(path.join(root,'src/components/BillingAccessGate.tsx'),'utf8')
assert.ok(app.indexOf('<AccountControls/>')<app.indexOf('</aside>'),'Logout belongs inside sidebar')
assert.ok(!app.includes('管理終了・変更履歴・今後の予定'),'All-tab footer must not return')
assert.ok(project.includes("editSection === 'billing'")&&project.includes('type="checkbox"'),'Existing billing edit controls must remain')
assert.ok(!gate.includes('justifyContent:\'flex-end\''),'Logout must not add a top-level row')
assert.ok(gate.includes('supabase.auth.signOut()')&&gate.includes('onAuthStateChange'),'Original authentication remains in place')
console.log('PASS: management/history tab isolation, no permanent billing selector, sidebar logout, common accessible modal, immutable render fixtures and unchanged authentication hooks')
