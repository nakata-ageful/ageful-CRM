const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react');
const root=path.resolve(__dirname,'..');
function load(file,hooks){file=path.resolve(root,file);const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Date,structuredClone,require:n=>n==='react'?(hooks??React):n==='react/jsx-runtime'?require(n):n.endsWith('.css')?{}:n.startsWith('.')?load(path.resolve(path.dirname(file),n)+(fs.existsSync(path.resolve(path.dirname(file),n)+'.ts')?'.ts':'.tsx'),hooks):(()=>{throw Error('No external access')})()});return m.exports;}
const plain=x=>JSON.parse(JSON.stringify(x)),nodes=(e,p)=>Array.isArray(e)?e.flatMap(x=>nodes(x,p)):e?.props?[...(p(e)?[e]:[]),...nodes(e.props.children,p)]:[];
const {reviewScheduleDateChanges:review,scheduleDateRequest:request,saveScheduleDateChanges:save,ScheduleChangeSaveError}=load('src/lib/billing-schedule-change.ts');
const before={id:1,project_id:1,billing_method:'請求書',billing_count:2,maintenance_start_date:'2020-06-27',billing_schedule_days:['7月1日','12月1日']},after={...before,billing_schedule_days:['5月1日','11月1日']};
const unit={id:'123',projectId:1,serviceYear:2026,roundLabel:'第2回',method:'請求書',scheduledDate:'2026-12-01',recipientId:10,lifecycle:'planned',issuedOn:null,receivedOn:null,frozenAt:null,frozenAmount:null,frozenLineItems:null,plannedAmount:165000,revision:9,periodStart:null,periodEnd:null};
const paid={...unit,id:'124',roundLabel:'第1回',lifecycle:'received',issuedOn:'2026-07-15',receivedOn:'2026-07-24',frozenAmount:165000};
const original=plain([unit,paid]);let r=review(before,after,[unit,paid],'2026-10-14');assert.equal(r.changes.length,1);assert.equal(r.changes[0].date,'2026-11-01');assert.equal(r.preserved,1);assert.deepEqual(plain([unit,paid]),original);
assert.deepEqual(plain(request(r.changes[0])),{unitId:123,revision:9,mode:'plan',value:{recipient_customer_id:10,scheduled_date:'2026-11-01',planned_amount:165000},reason:null});
assert.equal(review(before,{...before,billing_schedule_days:['7月01日','12月1日']},[unit],'2026-10-14'),null);
const yearLater={...unit,id:'125',serviceYear:2027,scheduledDate:'2027-12-01'};assert.equal(review(before,after,[unit,yearLater],'2026-10-14').changes.length,2);
const first={...unit,roundLabel:'第1回',scheduledDate:'2026-07-01'};assert.equal(review(before,after,[first],'2026-01-01').changes[0].date,'2027-05-01','Anchor to maintenance period, not calendar year');
for(const patch of [{scheduledDate:'2026-12-15'},{periodStart:'2026-08-01',periodEnd:'2026-12-31'},{scheduledDate:'2025-12-01'},{roundLabel:'保存済み単回記録'},{method:'口座振替'},{paymentDueOn:'2026-10-31'}])assert.equal(review(before,after,[{...unit,...patch}],'2026-10-14').changes.length,0);
assert.equal(review(before,{...after,billing_count:1},[unit],'2026-10-14').editable.length,1);
const rule={id:1,project_id:1,effective_year:2026,mode:'calendar_prepaid'};assert.equal(review(before,after,[unit],'2026-10-14',[rule]).changes.length,0);
assert.equal(review(before,after,[{...unit,removedAt:'2026-10-01'}],'2026-10-14').changes.length,0);
assert.equal(review(before,after,[{...unit,projectId:2}],'2026-10-14').changes.length,0);
assert.equal(request({...r.changes[0],unit:{...unit,plannedAmount:0}}).value.planned_amount,0);
assert.equal(request({...r.changes[0],unit:{...unit,plannedAmount:null,recipientId:null}}).value.recipient_customer_id,null);
// Existing mismatch / missing date must be fixable even with no change to the basic settings.
const mismatch=review(after,after,[unit,paid],'2026-10-15');assert.equal(mismatch.editable.length,1);assert.equal(mismatch.editable[0].date,'');assert.equal(mismatch.preserved,1);
const missing=review(after,after,[{...unit,scheduledDate:null}],'2026-10-15');assert.equal(missing.editable.length,1);assert.equal(missing.editable[0].date,'');
const noBasic={...before,billing_schedule_days:null};assert.equal(review(noBasic,noBasic,[unit],'2026-10-15').editable.length,1);
const prepaid={...before,billing_count:1,billing_schedule_days:['12月1日']};assert.equal(review(prepaid,prepaid,[{...unit,serviceYear:2027,roundLabel:'第1回'}],'2026-10-15',[rule]),null,'Correct prepaid schedule does not create unnecessary confirmation');
assert.equal(review(after,after,[{...unit,scheduledDate:'2026-11-01'}],'2026-10-15'),null);
for(const patch of [{lifecycle:'issued',issuedOn:'2026-10-01'},{lifecycle:'received',receivedOn:'2026-10-01'},{frozenAmount:165000},{frozenLineItems:[]},{removedAt:'2026-10-01'},{method:'口座振替'}])assert.equal(review(after,after,[{...unit,...patch}],'2026-10-15')?.editable?.length??0,0);
assert.throws(()=>request({...mismatch.editable[0],date:''}),/予定日/);assert.throws(()=>request({...mismatch.editable[0],date:'2026-02-30'}),/予定日/);
assert.throws(()=>request({...mismatch.editable[0],date:'2026-12-01'}),/同じ/);
assert.throws(()=>request({...mismatch.editable[0],unit:{...unit,paymentDueOn:'2026-10-31'},date:'2026-11-01'}),/入金予定日/);
(async()=>{
 let calls=[];await save(async()=>calls.push('settings'),async q=>calls.push(q.unitId),[request(r.changes[0])]);assert.deepEqual(calls,['settings',123]);
 calls=[];await save(async()=>calls.push('settings'),async()=>calls.push('unexpected'),[]);assert.deepEqual(calls,['settings']);
 await assert.rejects(save(async()=>{throw Error('lost')},async()=>{throw Error('must not run')},[request(r.changes[0])]),e=>e instanceof ScheduleChangeSaveError&&!e.settingsSaved&&e.completed===0);
 calls=[];await assert.rejects(save(async()=>calls.push('settings'),async q=>{calls.push(q.unitId);if(q.unitId===125)throw Error('uncertain')},[request(r.changes[0]),request({unit:yearLater,date:'2027-11-01'}),{unitId:999}]),e=>e.settingsSaved&&e.completed===1&&e.failed.unitId===125);assert.deepEqual(calls,['settings',123,125]);
 // Explicit selection only; back/settings-only do not alter or write a plan.
 const slots=[];let pos=0;const hooks={...React,useState(initial){const i=pos++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]}};
 const {BillingScheduleChangeReview}=load('src/components/BillingScheduleChangeReview.tsx',hooks);let requests,back=0;
 const render=()=>{pos=0;return BillingScheduleChangeReview({review:r,name:'合成発電所',recipientName:()=> '合成顧客',busy:false,onSave:q=>requests=q,onBack:()=>back++})};
 let t=render();const primary=()=>nodes(render(),e=>e.type==='button'&&e.props.className==='btn btn-main')[0];assert.equal(primary().props.disabled,true);
 nodes(t,e=>e.type==='input')[0].props.onChange({target:{checked:true}});assert.equal(primary().props.disabled,false);primary().props.onClick();assert.deepEqual(plain(requests),[plain(request(r.changes[0]))]);
 nodes(render(),e=>e.type==='button'&&e.props.children==='請求情報だけ保存')[0].props.onClick();assert.deepEqual(plain(requests),[]);
 nodes(render(),e=>e.type==='button'&&e.props.children==='編集に戻る')[0].props.onClick();assert.equal(back,1);
 // Manual selection requires explicit valid date. Invalid input never calls the API, even if invoked directly.
 const manualSlots=[];let manualPos=0,manualWrites=[];const mhooks={...React,useState(initial){const i=manualPos++;if(!(i in manualSlots))manualSlots[i]=initial;return[manualSlots[i],v=>manualSlots[i]=typeof v==='function'?v(manualSlots[i]):v]}};
 const ManualReview=load('src/components/BillingScheduleChangeReview.tsx',mhooks).BillingScheduleChangeReview;
 const mr=()=>{manualPos=0;return ManualReview({review:missing,name:'合成',recipientName:()=> '合成顧客',busy:false,onSave:q=>manualWrites.push(plain(q)),onBack(){}})};
 const mb=()=>nodes(mr(),e=>e.type==='button'&&e.props.className==='btn btn-main')[0];
 const input=()=>nodes(mr(),e=>e.type==='input'&&e.props.type==='date')[0];assert.equal(input().props.value,'');assert.equal(input().props.disabled,true);
 nodes(mr(),e=>e.type==='input'&&e.props.type==='checkbox')[0].props.onChange({target:{checked:true}});assert.equal(mb().props.disabled,true);mb().props.onClick();assert.equal(manualWrites.length,0);
 input().props.onChange({target:{value:'2026-11-01'}});assert.equal(mb().props.disabled,false);mb().props.onClick();assert.equal(manualWrites[0][0].value.scheduled_date,'2026-11-01');assert.equal(manualWrites[0][0].value.planned_amount,165000);assert.equal(manualWrites[0][0].value.recipient_customer_id,10);assert.deepEqual(Object.keys(manualWrites[0][0].value).sort(),['planned_amount','recipient_customer_id','scheduled_date']);
 const source=fs.readFileSync(path.join(root,'src/views/ProjectDetail.tsx'),'utf8');assert(source.includes("editSection==='billing'&&await onCheckBillingPending?.()"));assert(source.includes('closeDisabled={saving}'));assert(source.includes('setScheduleFailure(e.message);setScheduleOutcome(e)'));
 // Execute the real parent handler: confirmation is read-only; pending saves block even settings-only.
 const parsed=ts.createSourceFile('ProjectDetail.tsx',source,ts.ScriptTarget.Latest,true);let handler;function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='handleSaveSection')handler=n;ts.forEachChild(n,visit)}visit(parsed);
 let captured=null,errors=[],settings=0,planCalls=0,pending=false,failPlan=false,failure='',outcome=null;
 const context={Date:class extends Date{constructor(){super('2026-10-14T12:00:00Z')}},editSection:'billing',contract:before,project:{id:1},billingHistory:{units:[unit,paid]},contractForm:new Proxy({...after,billing_count:'2'},{get:(t,k)=>k in t?t[k]:''}),PROJECT_SECTIONS:[],CONTRACT_SECTIONS:['billing'],projForm:{},sectionSaveLock:{current:false},scheduleFailure:'',
  reviewScheduleDateChanges:review,saveScheduleDateChanges:save,ScheduleChangeSaveError,contractSectionPatch:load('src/lib/contract-section-patch.ts').contractSectionPatch,setScheduleReview:r=>captured=r,setSaving(){},setErr:e=>errors.push(e),setEditSection(){},onReload(){},toast(){},setScheduleFailure:s=>failure=s,setScheduleOutcome:e=>outcome=e,
  onCheckBillingPending:async()=>pending,updateContract:async(id,patch,checked)=>{settings++;assert.equal(id,1);assert.equal(checked,true);assert.deepEqual(plain(patch.billing_schedule_days),['5月1日','11月1日'])},onSaveInvoice:async q=>{planCalls++;assert.equal(q.value.planned_amount,165000);if(failPlan)throw Error('response lost')}};
 vm.createContext(context);vm.runInContext(ts.transpileModule(handler.getText(parsed),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText+';globalThis.run=handleSaveSection',context);
 await context.run();assert.equal(settings,0);assert.equal(planCalls,0);assert.equal(captured.changes.length,1);
 const originalContract=context.contract;context.contract=after;await context.run();assert.equal(settings,0);assert.equal(captured.editable.length,1,'Parent opens the review for already-saved settings mismatch');context.contract=originalContract;
 pending=true;await context.run([]);assert.equal(settings,0,'Pending journal blocks settings-only before changing contract');assert(errors.at(-1).includes('前回'));
 pending=false;await context.run([request(r.changes[0])]);assert.equal(settings,1);assert.equal(planCalls,1);
 failPlan=true;await context.run([request(r.changes[0])]);assert(failure.includes('保存済み'));assert.equal(outcome.failed.unitId,123);context.scheduleFailure=failure;await context.run([request(r.changes[0])]);assert.equal(settings,2,'Uncertain save disables all further writes');assert.equal(planCalls,2);
 console.log('PASS: exact old schedule correspondence, multi-year/round periods, manual exceptions, untouched actuals/payer/amount, explicit selection, settings-only and stop-on-uncertain sequential saves');
})().catch(e=>{console.error(e);process.exitCode=1});
