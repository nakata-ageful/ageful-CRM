// Synthetic defaults and React callbacks. No DB writes/network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
const root=path.resolve(__dirname,'..')
function load(file,hooks){file=path.resolve(root,file);const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Date,require:n=>{if(n==='react')return hooks??React;if(n==='react/jsx-runtime')return require(n);if(!n.startsWith('.'))throw Error('External dependency forbidden');const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'),hooks)}});return m.exports}
const cycle=load('src/lib/billing-cycle.ts'),{detailPlanCandidate:candidate}=load('src/lib/billing-detail-plan.ts'),{maintenanceSchedule}=load('src/lib/maintenance-schedule.ts'),{billingDetailPeriods}=load('src/lib/billing-detail-periods.ts'),{inspectFutureBillingCoverage:coverage}=load('src/lib/billing-cutover-coverage.ts')
const c={project_id:1,maintenance_start_date:'2023-08-01',billing_method:'請求書',billing_count:1,billing_schedule_days:['8月1日'],annual_maintenance_inc:165000}
const units=[{id:'old',projectId:1,serviceYear:2025,roundLabel:'保存済み単回記録',lifecycle:'received',frozenAmount:165000},{id:'transition',projectId:1,serviceYear:2026,roundLabel:'保存済み単回記録',periodStart:'2026-08-01',periodEnd:'2026-12-31',lifecycle:'received',frozenAmount:68750}]
const rules=[{id:1,project_id:1,effective_year:2027,mode:'calendar_prepaid',recorded_at:'2026-10-03T00:00:00Z',reason:'架空検証'}],original=JSON.stringify({c,units,rules})
cycle.validateCycleRule(c,units,2027,'calendar_prepaid','確認')
assert.throws(()=>cycle.validateCycleRule(c,[{...units[1],periodEnd:'2027-07-31'}],2027,'calendar_prepaid','確認'),/重な/)
assert.throws(()=>cycle.validateCycleRule({...c,billing_count:2},units,2027,'calendar_prepaid','確認'),/年1回/)
assert.throws(()=>cycle.validateCycleRule(c,[...units,{...units[1],serviceYear:2027}],2027,'calendar_prepaid','確認'),/先に確認/)
let p=candidate(c,1,units,'2026-10-03',[],rules)
assert.equal(p.periodStart,'2027-01-01');assert.equal(p.periodEnd,'2027-12-31');assert.equal(p.date,'2026-12-01');assert.equal(p.year,2027)
assert.equal(maintenanceSchedule(c,2028,1,units,[],undefined,rules)[0].date,'2027-12-01')
assert.equal(maintenanceSchedule(c,2028,1,units,[],undefined,rules)[0].periodStart,'2028-01-01')
const added={...p,id:'new',projectId:1,serviceYear:2027,roundLabel:'第1回',lifecycle:'planned',scheduledDate:p.date,plannedAmount:165000}
p=candidate(c,1,[...units,added],'2026-10-03',[],rules);assert.equal(p.year,2028);assert.equal(p.date,'2027-12-01')
const row={project_id:1,contract:c,records:[]},pay=new Map([[1,1]])
let review=coverage([row],pay,[],'2026-10',3,[],rules)
assert.equal(review.candidates.length,1);assert.equal(review.candidates[0].date,'2026-12-01');assert.equal(review.candidates[0].serviceYear,2027)
assert.equal(coverage([row],pay,[],'2027-08',1,[],rules).candidates.length,0,'No anniversary-month reminder after switching')
const stored={project_id:1,service_year:2027,recipient_customer_id:1,collection_method:'invoice',round_number:1,scheduled_date:'2026-12-01',lifecycle:'planned',planned_amount:165000}
assert.equal(coverage([row],pay,[stored],'2026-12',1,[],rules).candidates[0].status,'matches')
assert.equal(coverage([row],pay,[{...stored,service_year:2026}],'2026-12',1,[],rules).candidates[0].status,'review','A same-day previous-period record cannot hide the next year')
assert.equal(coverage([row],pay,[{...stored,lifecycle:'received'}],'2026-12',1,[],rules).candidates[0].status,'handled')
assert.ok(coverage([{...row,contract:{...c,billing_count:2}}],pay,[],'2026-12',1,[],rules).issues[0].reason.includes('年1回'))
assert.equal(billingDetailPeriods(units,c.maintenance_start_date)[1].start,'2025-08-01','Old unconfirmed history never consults new rules')
assert.equal(cycle.cycleRuleForYear([...rules,{...rules[0],id:2,effective_year:2029,mode:'anniversary'}],1,2028).mode,'calendar_prepaid')
assert.equal(cycle.cycleRuleForYear([...rules,{...rules[0],id:2,effective_year:2027,mode:'anniversary'}],1,2027).mode,'anniversary')
assert.equal(cycle.futureMaintenancePeriod(c,2027,[]).periodStart,'2027-08-01','Unconfigured projects keep original behavior')
assert.throws(()=>cycle.validateCycleOccurrence(c,2026,'2027-07-31',rules),/次の保守期間と重な/)
assert.doesNotThrow(()=>cycle.validateCycleOccurrence(c,2026,'2026-12-31',rules))
assert.equal(JSON.stringify({c,units,rules}),original)
const {BillingCycleSettings}=load('src/components/BillingCycleSettings.tsx')
const html=renderToStaticMarkup(React.createElement(BillingCycleSettings,{contract:c,units,rules,onSave:()=>{throw Error('Render must not save')}}))
assert.ok(html.includes('前年12月1日に翌年分を請求'));assert.ok(html.includes('繰り返し設定を変更'));assert.ok(!html.includes('<details'))
const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
const state=[];let cursor=0;const hooks={useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v]},useRef(initial){const i=cursor++;return state[i]??(state[i]={current:initial})}}
const C=load('src/components/BillingCycleSettings.tsx',hooks).BillingCycleSettings
let reject=true,writes=[];const props={contract:c,units,rules:[],onSave:async v=>{writes.push(v);if(reject)throw Error('保存結果未確認')}}
const render=()=>{cursor=0;return C(props)},button=(t,label)=>nodes(t,e=>e.type==='button'&&e.props.children===label)[0]
;(async()=>{let tree=render();button(tree,'繰り返し設定を変更').props.onClick();tree=render()
  nodes(tree,e=>e.type==='input'&&e.props.type==='number')[0].props.onChange({target:{value:'2027'}});nodes(tree,e=>e.type==='textarea')[0].props.onChange({target:{value:'移行期間確認'}});tree=render()
  button(tree,'設定内容を確認').props.onClick();tree=render();assert.ok(button(tree,'確認した繰り返し設定を保存'))
  button(tree,'確認した繰り返し設定を保存').props.onClick();await new Promise(r=>setImmediate(r));tree=render();assert.ok(nodes(tree,e=>typeof e.type==='function'&&e.type.name==='Modal').length);assert.equal(nodes(tree,e=>e.type==='textarea')[0].props.value,'移行期間確認')
  reject=false;button(tree,'確認した繰り返し設定を保存').props.onClick();await new Promise(r=>setImmediate(r));tree=render();assert.ok(!nodes(tree,e=>typeof e.type==='function'&&e.type.name==='Modal').length)
  assert.equal(writes[0].year,2027);assert.equal(writes[0].mode,'calendar_prepaid');assert.equal(JSON.stringify({c,units,rules}),original)
  console.log('PASS: recurring January coverage and prior December prepayment, next-year defaults, exact period matching, transition blockers, immutable old history, untouched other projects and safe UI save')
})().catch(e=>{console.error(e);process.exitCode=1})
