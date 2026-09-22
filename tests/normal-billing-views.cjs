// Render the actual normal views with isolated fixtures. All data/action imports are denied.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..'),cache=new Map();
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;
 if(/\/(actions|data|supabase|mock-store)\.ts$/.test(file))return new Proxy({},{get:()=>()=>{throw Error('Real data access forbidden')}});
 const module={exports:{}};cache.set(file,module);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {module,exports:module.exports,Date,require:name=>{if(['react','react/jsx-runtime'].includes(name))return require(name);if(!name.startsWith('.'))throw Error('External dependency forbidden');const p=path.resolve(path.dirname(file),name);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'))}});return module.exports;}
const {Billing}=load('src/views/Billing.tsx'),{Dashboard}=load('src/views/Dashboard.tsx'),{CustomerDetailView}=load('src/views/CustomerDetail.tsx'),{InvoiceLedgerDetail}=load('src/components/InvoiceLedgerDetail.tsx');
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const noAction=()=>{throw Error('SSR must not execute actions')};
const base={projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',scheduledDate:'2026-12-01',issuedOn:null,receivedOn:null,frozenAmount:null,frozenLineItems:null,frozenAt:null,revision:0};
const old={...base,id:'old',recipientId:1,lifecycle:'received',receivedOn:'2026-07-24',issuedOn:'2026-07-15',frozenAmount:165000,frozenLineItems:[{name:'保守料',amount:165000}],frozenAt:'2026-07-15T00:00:00Z'};
for(const state of ['planned','issued','received']){
 const next={...base,id:'next',roundLabel:'第2回',recipientId:2,lifecycle:state,plannedAmount:82500,
 ...(state==='planned'?{}:{issuedOn:'2026-12-01',frozenAmount:82500,frozenLineItems:[{name:'保守料',amount:82500}],frozenAt:'2026-12-01T00:00:00Z'}),...(state==='received'?{receivedOn:'2026-12-10'}:{})};
 const history={units:[old,next],recipientName:id=>id===1?'旧所有者A':'新所有者B',projectName:()=> '検証発電所',plannedAmount:()=>999999};
 const before=JSON.stringify(history.units);
 const billing=render(Billing,{rows:[],onReload:noAction,onViewDetail:noAction,billingHistory:history,billingToday:'2026-12-15'});
 const dashboard=render(Dashboard,{stats:{totalCustomers:2,totalProjects:1,activeMaintenanceCount:0},maintenanceList:[],billingRows:[],onNavigate:noAction,onViewMaintenance:noAction,onViewBilling:noAction,billingHistory:history,billingToday:'2026-12-15'});
 for(const html of [billing,dashboard]){assert.ok(html.includes('82,500'));assert.ok(html.includes('165,000'));assert.ok(!html.includes('999,999'));assert.ok(html.includes('新所有者B'));assert.ok(html.includes('旧所有者A'));}
 for(const id of [1,2]){
  const html=render(CustomerDetailView,{detail:{customer:{id,name:id===1?'旧所有者A':'新所有者B'},projects:[],attachments:[]},onBack:noAction,onReload:noAction,onViewProject:noAction,billingHistory:history});
  assert.ok(html.includes('検証発電所'),'old owner has history even without a currently owned project');
  assert.ok(html.includes(id===1?'165,000':'82,500'));assert.ok(!html.includes(id===1?'82,500':'165,000'),'other payer amount leaked');
 }
 assert.equal(JSON.stringify(history.units),before);
}
const detailHistory={units:[old,{...base,id:'current',roundLabel:'第2回',recipientId:2,lifecycle:'issued',scheduledDate:'2026-12-01',issuedOn:'2026-12-03',paymentDueOn:'2026-12-31',frozenAmount:82500,frozenLineItems:[{name:'保守料',amount:82500}],frozenAt:'2026-12-03T00:00:00Z'}],
 recipientName:id=>id===1?'旧所有者A':'新所有者B',projectName:()=> '検証発電所',plannedAmount:()=>999999,recipients:[{id:1,name:'旧所有者A'},{id:2,name:'新所有者B'}]};
const detailHtml=render(InvoiceLedgerDetail,{data:detailHistory,projectId:1,onSave:async()=>{}});
for(const text of ['今回・次回の請求','82,500','新所有者B','請求予定日','2026-12-01','請求日','2026-12-03','入金予定日','2026-12-31','請求明細','保守料','過去の請求・入金記録','旧所有者A','165,000','入金日を記録'])assert.ok(detailHtml.includes(text),`billing detail missing ${text}`);
assert.ok(!detailHtml.includes('この発電所の操作'),'old all-actions block must not return');
const setupRow={project_id:1,project_name:'設定待ち発電所',customer_name:'現在の顧客',company_name:null,currentYear:2026,
 currentYearRecord:null,currentYearRecords:[],records:[],contract:{project_id:1,billing_method:'請求書',billing_schedule_days:['12月1日'],annual_maintenance_inc:165000,
  billing_item_flags:{annual_maintenance:true,land_cost:false,insurance:false,local_association:false,communication:false,other:false}}};
const emptyHistory={units:[],recipientName:()=>'',projectName:()=>'',plannedAmount:()=>null};
for(const html of [
 render(Billing,{rows:[setupRow],onReload:noAction,onViewDetail:noAction,billingHistory:emptyHistory,billingToday:'2026-11-15',projectRecipients:new Map([[1,2]])}),
 render(Dashboard,{stats:{totalCustomers:1,totalProjects:1,activeMaintenanceCount:0},maintenanceList:[],billingRows:[setupRow],onNavigate:noAction,onViewMaintenance:noAction,onViewBilling:noAction,billingHistory:emptyHistory,billingToday:'2026-11-15',projectRecipients:new Map([[1,2]])}),
]){assert.ok(html.includes('未保存・要確認の請求予定'));assert.ok(html.includes('2026-12-01'));assert.ok(html.includes('新しい請求回としてまだ保存していません'));}
const supabaseSource=fs.readFileSync(path.join(root,'src/lib/supabase.ts'),'utf8');
const runtimeSource=fs.readFileSync(path.join(root,'src/lib/billing-runtime.ts'),'utf8');
const appSource=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8');
assert.ok(supabaseSource.includes("import.meta.env.DEV&&import.meta.env.VITE_BILLING_LEDGER_PREVIEW==='true'"),'preview must be development-only');
assert.ok(supabaseSource.includes("import.meta.env.DEV&&import.meta.env.VITE_BILLING_AUTH_CHECK==='true'"),'auth-only check must be development-only');
assert.ok(supabaseSource.includes('!!(url && key)&&!billingRuntimePreview'),'preview must disconnect Supabase even when env credentials exist');
assert.ok(runtimeSource.indexOf('if(billingRuntimePreview)return previewSnapshot()')<runtimeSource.indexOf("if(!supabase||!billingRuntimeEnabled)throw Error('新しい請求機能はまだ有効化されていません')"));
assert.ok(runtimeSource.indexOf("if(billingRuntimePreview)throw Error('確認用モードでは保存しません')")<runtimeSource.indexOf("if(!navigator.locks)throw Error('安全な保存に対応するブラウザーで開いてください')"),'preview save must fail before any persistence path');
assert.ok(appSource.includes('billingRuntimeEnabled&&!billingRuntimePreview?<BillingAccessGate>'),'preview must not invoke the production access probe');
assert.ok(appSource.includes('if(billingAuthCheck)return <BillingAccessGate>'),'auth-only check must use the real login gate without mounting MainApp');
console.log('PASS: normal Billing/Dashboard/CustomerDetail render all three invoice states with saved amounts and payer-based history, including old owner without projects; the development-only UI preview disconnects Supabase and rejects saves.');
