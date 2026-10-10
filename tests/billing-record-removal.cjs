// Synthetic pure/SSR regression test. No live data, credentials or network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..'),cache=new Map()
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports
 const module={exports:{}};cache.set(file,module)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {module,exports:module.exports,Date,structuredClone,require:n=>{if(['react','react/jsx-runtime'].includes(n))return require(n);if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'))}})
 return module.exports}
const {billingRecordRemovalRequest}=load('src/lib/billing-record-removal.ts')
const {summarizeBillingHistory,customerBillingHistory}=load('src/lib/billing-history.ts')
const {buildBillingOverview}=load('src/lib/billing-overview.ts'),{buildBillingUnitCsv}=load('src/lib/billing-unit-csv.ts')
const {detailPlanCandidate,validateDetailPlan}=load('src/lib/billing-detail-plan.ts'),{inspectCandidatePeriod}=load('src/lib/billing-period-coverage.ts')
const {legacyScheduleSetupItems}=load('src/lib/billing-cutover-coverage.ts'),{routineInvoiceContext}=load('src/lib/routine-invoice.ts')
const {InvoiceLedgerDetail}=load('src/components/InvoiceLedgerDetail.tsx'),{BillingRecordRemovalEditor}=load('src/components/BillingRecordRemovalEditor.tsx')
const {buildChangeHistory}=load('src/lib/change-history-display.ts')
const paid={id:'1',projectId:1,serviceYear:2026,roundLabel:'第1回',method:'請求書',recipientId:1,lifecycle:'received',scheduledDate:'2026-12-01',issuedOn:'2026-09-16',receivedOn:'2026-09-17',frozenAmount:187000,frozenLineItems:[{name:'保守料',amount:187000}],frozenAt:'2026-09-16T00:00:00Z',revision:0,periodStart:'2026-10-27',periodEnd:'2027-12-31'}
const removed={...paid,revision:1,removedAt:'2026-10-10T00:00:00Z',removalReason:'同じ請求を重複登録したため'}
const regular={...paid,id:'2',roundLabel:'第2回',frozenAmount:82500,frozenLineItems:[{name:'保守料',amount:82500}],periodEnd:'2027-10-26'}
const units=[removed,regular],before=JSON.stringify(units),name=id=>'検証顧客'+id
const plain=v=>JSON.parse(JSON.stringify(v))
assert.deepEqual(plain(billingRecordRemovalRequest(paid,'remove',' 重複登録 ',true)),{unitId:1,revision:0,mode:'remove',reason:'重複登録'})
assert.equal(billingRecordRemovalRequest(removed,'restore','復元確認',true).mode,'restore')
for(const [u,m,r,c] of [[paid,'remove','',true],[paid,'remove','理由',false],[removed,'remove','理由',true],[paid,'restore','理由',true],[{...paid,lifecycle:'planned'},'remove','理由',true]])assert.throws(()=>billingRecordRemovalRequest(u,m,r,c))
assert.equal(summarizeBillingHistory(units).receivedAmount,82500);assert.deepEqual(plain(customerBillingHistory(units,1).map(u=>u.id)),['2'])
assert.deepEqual(plain(buildBillingOverview(units,'2026-10-10').received.map(u=>u.id)),['2'])
const csv=buildBillingUnitCsv(units,name,name);assert.ok(!csv.includes('187000'));assert.ok(csv.includes('82500'))
const contract={id:1,project_id:1,maintenance_start_date:'2023-10-27',billing_method:'請求書',billing_count:1,billing_schedule_days:['12月1日'],annual_maintenance_inc:187000}
const rules=[{id:1,project_id:1,effective_year:2028,mode:'calendar_prepaid'}]
assert.equal(inspectCandidatePeriod(contract,2027,{periodStart:'2027-10-27',periodEnd:'2028-10-26'},[removed],rules).superseded,false,'Deleted long range cannot claim another period was paid')
const candidate=detailPlanCandidate(contract,1,[removed],'2026-10-28',[],rules);assert.equal(candidate.year,2027,'Do not re-create deleted identity, but do show a legitimate later year')
const row={project_id:1,project_name:'検証発電所',customer_name:'検証顧客',contract,records:[],contract_count:1}
assert.deepEqual(plain(legacyScheduleSetupItems([row],new Map([[1,1]]),[removed],'2026-10-28')),[],'Removed exact identity must not reappear as an unsaved December alert')
const debitRow={...row,contract:{...contract,billing_method:'口座振替',billing_count:12,billing_schedule_days:['25日']}}
const removedDebit={...removed,serviceYear:2026,roundLabel:'10月分',method:'口座振替',scheduledDate:'2026-10-25',issuedOn:null,receivedOn:'2026-10-25',periodStart:null,periodEnd:null}
assert.deepEqual(plain(legacyScheduleSetupItems([debitRow],new Map([[1,1]]),[removedDebit],'2026-10-28')),[],'Deleted debit month must not reappear as a missing bank check')
assert.deepEqual(plain(legacyScheduleSetupItems([debitRow],new Map([[1,1]]),[{...removedDebit,serviceYear:2025,roundLabel:'第12回',scheduledDate:'2026-10-24'}],'2026-10-28')),[],'Anniversary debit identity survives a moved day')
const unknown={...removed,roundLabel:'保存済み単回記録',periodStart:'2026-01-01',periodEnd:'2026-12-31',scheduledDate:'2026-06-01'}
const twice={...row,contract:{...contract,maintenance_start_date:'2020-01-01',billing_count:2,billing_schedule_days:['6月1日','12月1日']}}
const unknownReview=legacyScheduleSetupItems([twice],new Map([[1,1]]),[unknown],'2026-10-10')
assert.equal(unknownReview.length,1);assert.equal(unknownReview[0].round,2);assert.equal(unknownReview[0].status,'review');assert.match(unknownReview[0].reason,/削除済み/)
assert.match(detailPlanCandidate(twice.contract,1,[unknown],'2026-10-10').reviewReason,/削除済み/,'An unknown removed round cannot hide all rounds or authorize duplicate creation')
assert.throws(()=>validateDetailPlan({...candidate,year:2026,date:'2026-12-01',periodStart:'2026-10-27',periodEnd:'2027-10-26'},[removed],1,'確認',contract.maintenance_start_date),/保存済み/)
const ctx=routineInvoiceContext(contract,candidate,{units:[removed],recipients:[{id:1,name:'検証顧客'}],recipientName:name,projectName:name,plannedAmount:()=>null},'2026-10-10')
assert.equal(ctx.versions['1'],1,'CAS must include the deleted row')
const data={units,recordRemovalReady:true,recipientName:name,projectName:name,plannedAmount:()=>null,recipients:[{id:1,name:'検証顧客1'}]}
const noSave=()=>{throw Error('SSR must not save')},render=(C,p)=>renderToStaticMarkup(React.createElement(C,p))
const html=render(InvoiceLedgerDetail,{data,projectId:1,onSave:noSave,onRecordRemoval:noSave,maintenanceStartDate:'2023-10-27'})
assert.match(html,/1期間・1件/);assert.match(html,/削除済みの記録（1件）/);assert.match(html,/内容を確認して復元/);assert.match(html,/この記録を削除/)
assert.ok(!html.slice(0,html.indexOf('invoice-removed-records')).includes('187,000'),'Deleted amount must not be the selected/default record')
const beforeDB=render(InvoiceLedgerDetail,{data:{...data,recordRemovalReady:false},projectId:1,onSave:noSave,onRecordRemoval:noSave})
assert.ok(!beforeDB.includes('この記録を削除')&&!beforeDB.includes('内容を確認して復元'),'Hide unavailable writers before migration')
const form=render(BillingRecordRemovalEditor,{unit:paid,mode:'remove',recipientName:name,periodLabel:'2026-10-27 ～ 2027-12-31',onSave:noSave,onClose:noSave,onBusyChange:noSave})
assert.match(form,/請求書取消・返金・銀行処理は行いません/);assert.match(form,/削除理由/);assert.match(form,/type="checkbox" required/);assert.match(form,/type="submit"[^>]*disabled/)
const deletionEvent={id:1,event_type:'corrected',before_value:{removed_at:null},after_value:{removed_at:removed.removedAt},reason:'重複'}
assert.equal(buildChangeHistory([], [deletionEvent],[])[0].title,'請求・入金記録を削除')
assert.equal(buildChangeHistory([], [{...deletionEvent,before_value:deletionEvent.after_value,after_value:deletionEvent.before_value}],[])[0].title,'請求・入金記録を復元')
assert.equal(JSON.stringify(units),before,'Readers never mutate original financial data')
console.log('PASS: removal confirmation, actual-only gate, aggregate/history/CSV exclusion, deleted archive & restore, capability gate, no candidate resurrection, other-period evidence, full CAS, readable audit and immutable data')
