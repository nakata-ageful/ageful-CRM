// No network or business writes. Test actual components plus metadata-only request validation.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..')
function load(file,hookReact){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:m.exports,module:m,Date,require:n=>{if(n==='react')return hookReact??require(n);if(n==='react/jsx-runtime')return require(n);if(!n.startsWith('.'))throw Error('External access denied');const base=path.resolve(path.dirname(file),n);return load(base+(fs.existsSync(base+'.ts')?'.ts':'.tsx'),hookReact)}});return m.exports}
const {savedMaintenancePeriodChange:prepare}=load(path.join(root,'src/lib/saved-maintenance-period.ts'))
const {maintenancePeriod}=load(path.join(root,'src/lib/maintenance-period-label.ts'))
const {SavedMaintenancePeriodEditor}=load(path.join(root,'src/components/SavedMaintenancePeriodEditor.tsx'))
const {MaintenancePeriodReview}=load(path.join(root,'src/components/MaintenancePeriodReview.tsx'))
const paid={id:'paid',projectId:1,serviceYear:2026,roundLabel:'第1回',lifecycle:'received',issuedOn:'2025-12-02',receivedOn:'2025-12-21',scheduledDate:'2025-12-01',recipientId:7,frozenAmount:165000,frozenLineItems:[{name:'保守料',amount:165000}],revision:2,periodStart:null,periodEnd:null}
const next={...paid,id:'next',serviceYear:2027,roundLabel:'第1回',lifecycle:'planned',scheduledDate:'2026-12-01',issuedOn:null,receivedOn:null,frozenAmount:null,plannedAmount:165000}
const units=[paid,next],before=JSON.stringify(units),period=maintenancePeriod('2022-07-14',2026)
assert.deepEqual(JSON.parse(JSON.stringify(period)),{periodStart:'2026-07-14',periodEnd:'2027-07-13'})
const request=prepare(1,2026,period,'  契約と備考を確認  ',units,'2022-07-14')
assert.deepEqual(Object.keys(request).sort(),['periodEnd','periodStart','reason','year'].sort(),'Only metadata may be submitted')
assert.equal(request.reason,'契約と備考を確認')
assert.throws(()=>prepare(1,2026,period,'',units,'2022-07-14'),/理由/)
assert.throws(()=>prepare(1,2026,period,'確認',units,null),/保守開始日/)
assert.throws(()=>prepare(2,2026,period,'確認',units,'2022-07-14'),/対象/)
assert.throws(()=>prepare(1,2026,{periodStart:'2025-07-14',periodEnd:'2026-07-13'},'確認',units,'2022-07-14'),/開始年/)
assert.throws(()=>prepare(1,2026,{periodStart:'2026-02-30',periodEnd:'2027-02-28'},'確認',units,'2022-07-14'),/確認/)
assert.throws(()=>prepare(1,2026,{...period,periodEnd:'2027-07-14'},'確認',units,'2022-07-14'),/重複/)
assert.throws(()=>prepare(1,2026,{...period,periodEnd:'2201-01-01'},'確認',units,'2022-07-14'),/終了日/)
assert.doesNotThrow(()=>prepare(1,2026,period,'確認',[paid,{...next,projectId:2}],'2022-07-14'),'Other project must not block a correction')
const noAction=()=>{throw Error('SSR may not save')}
const editor=renderToStaticMarkup(React.createElement(SavedMaintenancePeriodEditor,{startDate:'2022-07-14',year:2026,units,onSave:noAction,onClose:noAction}))
assert.ok(editor.includes('value="2026-07-14"')&&editor.includes('value="2027-07-13"'))
assert.ok(editor.includes('1件すべてを修正'))
assert.ok(editor.includes('請求先・金額・請求予定日・請求日・入金日は変更しません'))
assert.ok(!editor.includes('確認した保守期間だけを保存'),'Save must require review first')
const stored={...paid,periodStart:'2026-10-27',periodEnd:'2027-12-31'}
const preserved=renderToStaticMarkup(React.createElement(SavedMaintenancePeriodEditor,{startDate:'2022-07-14',year:2026,units:[stored],onSave:noAction,onClose:noAction}))
assert.ok(preserved.includes('value="2027-12-31"'),'Do not replace explicitly saved exceptions when opening editor')
const html=renderToStaticMarkup(React.createElement(MaintenancePeriodReview,{startDate:'2022-07-14',units,onSave:noAction}))
assert.ok(html.includes('参考表示・保守期間はまだ保存されていません'))
assert.equal((html.match(/この期間の保存記録を修正/g)||[]).length,2)
assert.ok(html.includes('2025-12-02')&&html.includes('2026-12-01'),'Prepayment dates and separate next period remain visible')
const readOnly=renderToStaticMarkup(React.createElement(MaintenancePeriodReview,{startDate:'2022-07-14',units}))
assert.ok(!readOnly.includes('この期間の保存記録を修正'))
assert.equal(JSON.stringify(units),before,'No financial/source mutation')
console.log('PASS: one-year defaults, preserved exceptions/prepayments, explicit review, metadata-only corrections, overlap/project/year safety and read-only UI')

// Exercise the real event handlers with isolated hook state, without a browser or DB.
;(async()=>{
 const state=[],writes=[];let cursor=0,closed=false
 const hooks={useState(initial){const slot=cursor++;if(!(slot in state))state[slot]=typeof initial==='function'?initial():initial;return [state[slot],value=>{state[slot]=typeof value==='function'?value(state[slot]):value}]}}
 const {SavedMaintenancePeriodEditor:Interactive}=load(path.join(root,'src/components/SavedMaintenancePeriodEditor.tsx'),hooks)
 const props={startDate:'2022-07-14',year:2026,units,onSave:async c=>writes.push(c),onClose:()=>{closed=true}}
 const render=()=>{cursor=0;return Interactive(props)}
 function nodes(element,predicate){if(Array.isArray(element))return element.flatMap(e=>nodes(e,predicate));if(!element?.props)return [];return [...(predicate(element)?[element]:[]),...nodes(element.props.children,predicate)]}
 const button=(tree,text)=>nodes(tree,e=>e.type==='button'&&e.props.children===text)[0]
 let tree=render()
 button(tree,'修正内容を確認').props.onClick();tree=render()
 assert.ok(!button(tree,'確認した保守期間だけを保存'),'Missing reason cannot enable saving')
 nodes(tree,e=>e.type==='input'&&e.props.placeholder)[0].props.onChange({target:{value:'契約を確認'}});tree=render()
 button(tree,'修正内容を確認').props.onClick();tree=render()
 assert.ok(button(tree,'確認した保守期間だけを保存'));assert.equal(writes.length,0)
 nodes(tree,e=>e.type==='input'&&e.props.type==='date')[0].props.onChange({target:{value:'2026-08-01'}});tree=render()
 assert.equal(nodes(tree,e=>e.type==='input'&&e.props.type==='date')[1].props.value,'2027-07-31')
 assert.ok(!button(tree,'確認した保守期間だけを保存'),'Changing dates invalidates prior confirmation')
 button(tree,'修正内容を確認').props.onClick();tree=render()
 assert.ok(!button(tree,'確認した保守期間だけを保存'),'Overlap cannot enable saving')
 button(tree,'保守開始日から1年間を入力').props.onClick();tree=render()
 button(tree,'修正内容を確認').props.onClick();tree=render()
 await button(tree,'確認した保守期間だけを保存').props.onClick()
 await new Promise(resolve=>setImmediate(resolve))
 assert.equal(writes.length,1);assert.equal(closed,true)
 assert.deepEqual(JSON.parse(JSON.stringify(writes[0])),{year:2026,periodStart:'2026-07-14',periodEnd:'2027-07-13',reason:'契約を確認'})
 assert.equal(JSON.stringify(units),before)
 console.log('PASS: real editor handlers require reason/reconfirmation, auto-fill one year, reject overlap and send no financial fields')
})().catch(e=>{console.error(e);process.exitCode=1})
