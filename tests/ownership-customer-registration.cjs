// Actual form/parent callbacks with synthetic data. No credentials or business writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..')
function load(file,hooks){file=path.resolve(root,file);const m={exports:{}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {module:m,exports:m.exports,Date,structuredClone,require:n=>{if(n==='react')return hooks??React;if(n==='react/jsx-runtime')return require(n);if(n.endsWith('.css'))return {};if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);if(/\/(actions|data|supabase)$/.test(p))throw Error('Business access forbidden');return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'),hooks)}});return m.exports}
const plain=v=>JSON.parse(JSON.stringify(v)),nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
const {emptyCustomerInput:empty,validateCustomerRegistration:validate,registrationMatches:matches}=load('src/lib/customer-registration.ts')
const customers=[{id:1,name:'旧 顧客',phone:'090-1111-2222'},{id:2,name:'同名 顧客',company_name:'株式会社検証',email:'test@example.com'}]
assert.throws(()=>validate(empty),/顧客名/);assert.throws(()=>validate({...empty,is_corporate:true,name:'担当者'}),/会社名/)
assert.throws(()=>validate({...empty,name:'新顧客',email:'invalid'}),/メール/)
assert.equal(validate({...empty,name:' 新顧客 ',company_name:'無視'}).company_name,'')
assert.deepEqual(plain(matches({...empty,name:'同名　顧客'},customers)).map(c=>c.id),[2])
assert.deepEqual(plain(matches({...empty,phone:'09011112222'},customers)).map(c=>c.id),[1])
assert.deepEqual(plain(matches({...empty,phone:'０９０１１１１２２２２'},customers)).map(c=>c.id),[1])
assert.deepEqual(plain(matches({...empty,is_corporate:true,company_name:'株式会社検証'},customers)).map(c=>c.id),[2])
function harness(file,props){const slots=[],refs=[];let pos=0,rpos=0
 const hooks={useId:()=> 'test-id',useEffect:()=>{},useRef(initial){const i=rpos++;return refs[i]??(refs[i]={current:initial})},useState(initial){const i=pos++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]}}
 const exports=load(file,hooks),Component=Object.values(exports)[0]
 return {render(){pos=0;rpos=0;return Component(props)}}
}
const button=(tree,text)=>nodes(tree,e=>e.type==='button'&&e.props.children===text)[0]
const fill=(tree,label,value)=>nodes(tree,e=>e.type==='label'&&e.props.children?.[0]===label)[0].props.children[1].props.onChange({target:{value}})
const submit=tree=>nodes(tree,e=>e.type==='form')[0].props.onSubmit({preventDefault(){}})
;(async()=>{
 let creates=0,selected=[],busy=[],resolveCreate
 const newCustomer={id:3,name:'新顧客'}
 const props={customers,currentOwnerId:1,onCreate:async input=>{creates++;assert.equal(input.name,'新顧客');return new Promise(resolve=>resolveCreate=resolve)},onReload:async()=>customers,onSelect:(c,created)=>selected.push({c,created}),onCancel:()=>{},onBusyChange:v=>busy.push(v)}
 const h=harness('src/components/CustomerRegistration.tsx',props)
 let t=h.render();await submit(t);assert.equal(creates,0);fill(h.render(),'顧客名（個人名）',' 新顧客 ')
 const first=submit(h.render());await submit(h.render());assert.equal(creates,1,'Synchronous lock prevents double insert before rerender')
 assert.equal(nodes(h.render(),e=>e.type==='fieldset')[0].props.disabled,true)
 resolveCreate(newCustomer);await first;assert.equal(selected.length,1);assert.equal(selected[0].c.id,3);assert.equal(selected[0].created,true);assert.deepEqual(busy,[true,false])
 // Do not reinsert if a post-save callback ever fails; retain the successful ID.
 props.onSelect=()=>{throw Error('synthetic UI failure')};await submit(h.render());assert.equal(creates,1)
 assert.ok(renderToStaticMarkup(h.render()).includes('登録結果が未確認'))
 const dupe=harness('src/components/CustomerRegistration.tsx',{...props,onSelect:(c,created)=>selected.push({c,created})})
 fill(dupe.render(),'顧客名（個人名）','同名 顧客');assert.equal(button(dupe.render(),'顧客を登録して選択').props.disabled,true)
 button(dupe.render(),'この顧客を選択').props.onClick();assert.equal(selected.at(-1).c.id,2);assert.equal(selected.at(-1).created,false);assert.equal(creates,1)
 // Reply lost after commit: reload is read-only and requires an explicit selection.
 let lostCreates=0,reloads=0,lostSelections=[]
 let pending=null
 const lostProps={...props,onPendingChange:input=>pending=input,onCreate:async()=>{lostCreates++;throw Error('network response lost')},onReload:async()=>{reloads++;return [...customers,newCustomer]},onSelect:(c,created)=>lostSelections.push({c,created})}
 const lost=harness('src/components/CustomerRegistration.tsx',lostProps)
 fill(lost.render(),'顧客名（個人名）','新顧客');await submit(lost.render());await submit(lost.render());assert.equal(lostCreates,1)
 assert.equal(pending.name,'新顧客')
 const reopened=harness('src/components/CustomerRegistration.tsx',{...lostProps,pendingInput:pending})
 assert.ok(renderToStaticMarkup(reopened.render()).includes('登録結果が未確認'));await submit(reopened.render());assert.equal(lostCreates,1,'Modal reopen restores pending input and refuses another insert')
 button(lost.render(),'登録結果を確認').props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(reloads,1);assert.equal(lostSelections.length,0);assert.equal(lostCreates,1)
 button(lost.render(),'この顧客を選択').props.onClick();assert.equal(lostSelections[0].c.id,3);assert.equal(lostSelections[0].created,false)
 // Parent remains mounted: date/contract/future/unsaved occurrence drafts survive.
 const {contractFieldKinds,projectFieldKinds}=load('src/lib/ownership-field-selection.ts')
 const project={...Object.fromEntries(Object.keys(projectFieldKinds).map(k=>[k,null])),id:1,customer_id:1,project_name:'合成発電所'}
 const contract={...Object.fromEntries(Object.keys(contractFieldKinds).map(k=>[k,null])),id:1,project_id:1,billing_method:'請求書',billing_count:1,billing_schedule_days:['12月1日'],maintenance_start_date:'2020-01-01',annual_maintenance_inc:82500}
 let transferSaves=[]
 const p=harness('src/components/OwnershipTransferEditor.tsx',{project,contract,customers,units:[],onCreateCustomer:props.onCreate,onReloadCustomers:props.onReload,onSave:async input=>transferSaves.push(input),testOnly:true})
 t=p.render();fill(t,'変更日','2026-11-15')
 nodes(t,e=>typeof e.type==='function'&&e.type.name==='ContractTransferFields')[0].props.onChange({notes:{mode:'change',value:'変更条件'}})
 button(p.render(),'＋ 新規顧客を登録').props.onClick()
 let registration=nodes(p.render(),e=>typeof e.type==='function'&&e.type.name==='CustomerRegistration')[0]
 registration.props.onCancel();assert.equal(transferSaves.length,0,'Customer cancellation never transfers the project')
 button(p.render(),'＋ 新規顧客を登録').props.onClick();registration=nodes(p.render(),e=>typeof e.type==='function'&&e.type.name==='CustomerRegistration')[0]
 registration.props.onSelect(newCustomer,true);t=p.render()
 const picker=nodes(t,e=>typeof e.type==='function'&&e.type.name==='CustomerPicker')[0]
 assert.equal(picker.props.value,'3');assert.ok(picker.props.customers.some(c=>c.id===3))
 const plan=nodes(t,e=>typeof e.type==='function'&&e.type.name==='OwnershipBillingPlanEditor')[0]
 const context=JSON.parse(plan.props.reviewContext);assert.equal(context.date,'2026-11-15');assert.equal(context.fields.notes.value,'変更条件')
 assert.equal(transferSaves.length,0,'Customer registration/selection alone is not an ownership transfer')
 await plan.props.onSave([],'所有者変更を確認');assert.equal(transferSaves[0].newOwner,3);assert.equal(transferSaves[0].futureRecipient,3);assert.equal(transferSaves[0].date,'2026-11-15')
 assert.equal(transferSaves[0].fields.contract.notes.value,'変更条件');assert.equal(project.customer_id,1)
 // The unsaved occurrence has its own uniform grid, not the owner's 34px arrow column.
 const toggle=(tree,id,checked)=>nodes(tree,e=>e.type==='input'&&e.props['aria-controls']===id)[0].props.onChange({target:{checked}})
 toggle(p.render(),'ownership-next-occurrence',true)
 t=p.render();const occurrence=nodes(t,e=>e.props.id==='ownership-next-occurrence')[0]
 assert.ok(occurrence);assert.equal(nodes(occurrence,e=>e.props.className==='ownership-transfer-grid').length,0)
 const grids=nodes(occurrence,e=>e.props.className==='ownership-occurrence-grid')
 assert.equal(grids.length,1);assert.equal(nodes(grids[0],e=>e.type==='label').length,6)
 fill(t,'保守期間の開始年','2027');fill(t,'第何回','1');fill(t,'請求・振替予定日','2026-12-01');fill(t,'予定額（税込）','0')
 toggle(p.render(),'ownership-occurrence-period-dates',true)
 t=p.render();fill(t,'保守期間の開始日','2027-01-01');fill(t,'保守期間の終了日','2027-12-31')
 assert.equal(nodes(t,e=>e.props.id==='ownership-occurrence-period-dates')[0].props.className,'ownership-occurrence-grid')
 let occurrencePlan=nodes(p.render(),e=>typeof e.type==='function'&&e.type.name==='OwnershipBillingPlanEditor')[0]
 occurrencePlan.props.onReview();assert.equal(transferSaves.length,1,'Layout changes never save during review')
 await occurrencePlan.props.onSave([],'確認した1回を追加')
 const added=transferSaves.at(-1).choices[0].newOccurrence
 assert.equal(added.year,2027);assert.equal(added.round,1);assert.equal(added.date,'2026-12-01');assert.equal(added.amount,0)
 assert.equal(added.recipientId,1);assert.equal(added.method,'invoice');assert.equal(added.periodStart,'2027-01-01');assert.equal(added.periodEnd,'2027-12-31')
 toggle(p.render(),'ownership-next-occurrence',false)
 assert.equal(nodes(p.render(),e=>e.props.id==='ownership-next-occurrence').length,0)
 toggle(p.render(),'ownership-next-occurrence',true)
 occurrencePlan=nodes(p.render(),e=>typeof e.type==='function'&&e.type.name==='OwnershipBillingPlanEditor')[0]
 assert.equal(JSON.parse(occurrencePlan.props.reviewContext).nextDate,'2026-12-01','Toggling keeps the entered draft')
 const css=fs.readFileSync(path.join(root,'src/components/OwnershipTransferEditor.css'),'utf8')
 assert.match(css,/\.ownership-occurrence-grid\s*\{[^}]*repeat\(2,minmax\(0,1fr\)\)/)
 assert.match(css,/@media\(max-width:620px\)[^{]*\{\s*\.ownership-occurrence-grid\s*\{\s*grid-template-columns:minmax\(0,1fr\)/)
 // Contract fields use a separate scope; flag labels remain checkboxes, not text controls.
 const {ContractTransferFields}=load('src/components/ContractTransferFields.tsx')
 let contractPatches=[]
 const contractTree=ContractTransferFields({contract,choices:{billing_item_flags:{mode:'change',value:{}},annual_maintenance_inc:{mode:'change',value:82500}},onChange:v=>contractPatches.push(v)})
 assert.ok(contractTree.props.className.includes('ownership-contract-fields'))
 assert.equal(nodes(contractTree,e=>e.type==='fieldset')[0].props.style.minWidth,0)
 const flagBox=nodes(contractTree,e=>e.props.className==='ownership-contract-flags')[0]
 nodes(flagBox,e=>e.type==='input')[0].props.onChange({target:{checked:false}})
 assert.ok(Object.values(contractPatches.at(-1).billing_item_flags.value).includes(false),'Flag layout preserves boolean callback')
 nodes(contractTree,e=>e.type==='input'&&e.props['aria-label']==='年次保守料（税込）（変更後）')[0].props.onChange({target:{value:'90000'}})
 assert.equal(contractPatches.at(-1).annual_maintenance_inc.value,90000,'Numeric layout preserves typed callback')
 assert.match(css,/\.ownership-transfer-shell \.ownership-contract-field \.form-input\s*\{[^}]*width:100%;[^}]*min-width:0/)
 assert.match(css,/\.ownership-new-customer \.editor-footer\s*\{[^}]*flex-wrap:wrap;[^}]*gap:8px/)
 assert.match(css,/\.ownership-customer-matches :is\(button,small\)\s*\{\s*flex-shrink:0/)
 const billingCss=fs.readFileSync(path.join(root,'src/components/OwnershipBillingPlanEditor.css'),'utf8')
 assert.match(billingCss,/@media\(max-width:980px\)[^{]*\{\s*\.ownership-billing-fields\s*\{[^}]*repeat\(2,minmax\(0,1fr\)\)/)
 assert.match(billingCss,/@media\(max-width:620px\)\s*\{\s*\.ownership-billing-fields\s*\{[^}]*minmax\(0,1fr\)/)
 // Existing saved plans still review without saving and forward the exact occurrence and revision.
 const savedUnit={id:'planned',projectId:1,serviceYear:2027,roundLabel:'第1回',method:'請求書',scheduledDate:'2026-12-01',recipientId:1,lifecycle:'planned',issuedOn:null,receivedOn:null,frozenAt:null,frozenAmount:null,frozenLineItems:null,plannedAmount:82500,revision:7,collectionState:'pending',periodStart:'2027-01-01',periodEnd:'2027-12-31',planNote:'元の備考'}
 const planWrites=[]
 const savedPlan=harness('src/components/OwnershipBillingPlanEditor.tsx',{projectId:1,oldOwner:customers[0],newOwner:customers[1],units:[savedUnit],onSave:async(...args)=>planWrites.push(plain(args))})
 let savedTree=savedPlan.render();fill(savedTree,'予定額（税込）','0');fill(savedPlan.render(),'備考','長い備考を保持')
 submit(savedPlan.render());assert.equal(planWrites.length,0)
 fill(savedPlan.render(),'確認内容・変更理由','確認済み')
 await button(savedPlan.render(),'検証用DBで予定と履歴を保存').props.onClick()
 assert.deepEqual(planWrites[0],[ [{unitId:'planned',expectedRevision:7,recipientId:1,method:'請求書',scheduledDate:'2026-12-01',plannedAmount:0,periodStart:'2027-01-01',periodEnd:'2027-12-31',note:'長い備考を保持'}], '確認済み' ])
 const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8')
 assert.ok(app.includes('closeDisabled={transferBusy}')&&app.includes('onBusyChange={setTransferBusy}'))
 assert.ok(app.includes('pendingCustomerInput={pendingCustomerInput} onPendingCustomerChange={setPendingCustomerInput}'))
 assert.ok(app.includes('const customer=await createCustomer(input);setCustomers('),'Successful creation goes directly into the customer list, without a fallible reload')
 console.log('PASS: customer registration/recovery, preserved transfer drafts, contract typed callbacks, responsive layout guards and saved plan payload/revision preservation without premature saves')
})().catch(e=>{console.error(e);process.exitCode=1})
