const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript')
function load(file){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:m.exports,require:n=>load(path.resolve(path.dirname(file),n)+'.ts')});return m.exports}
const {maintenanceSchedule:build,selectedMaintenanceScheduleItems:selected}=load(path.resolve(__dirname,'../src/lib/maintenance-schedule.ts'))
const c={project_id:1,maintenance_start_date:'2022-07-14',billing_method:'請求書',billing_count:2,annual_maintenance_inc:165000}
const u={projectId:1,serviceYear:2026,roundLabel:'第2回',scheduledDate:null,lifecycle:'planned'}
let items=build(c,2026,1,[u],[])
assert.equal(items[0].periodStart,'2026-07-14');assert.equal(items[0].periodEnd,'2027-07-13')
assert.equal(items[0].date,'');assert.equal(items[0].amount,82500)
assert.match(items[1].exclusion,/第2回は保存済み/)
assert.equal(build(c,2027,1,[u],[])[1].exclusion,undefined,'An undated older period must not block next period')
assert.match(build(c,2026,1,[{...u,lifecycle:'cancelled'}],[])[1].exclusion,/取りやめ/)
const paid={...u,roundLabel:'第1回',scheduledDate:'2025-12-01',lifecycle:'received'}
assert.match(build(c,2026,1,[paid],[])[0].exclusion,/保存済み/)
assert.equal(build(c,2025,1,[paid],[])[0].exclusion,undefined)
assert.match(build(c,2026,1,[{...u,roundLabel:'保存済み単回記録'}],[])[0].exclusion,/対応確認/)
const end={id:1,project_id:1,scope:'all',action:'end',effective_date:'2025-01-01',reason:'終了'}
assert.match(build(c,2026,1,[],[end])[0].exclusion,/全取引終了/)
items=build(c,2026,1,[],[end,{...end,id:2,action:'resume',effective_date:'2026-09-01'}])
assert.equal(items[0].exclusion,undefined);assert.equal(items[0].amount,null)
assert.equal(build({...c,billing_method:'口座振替',billing_count:12},2026,1,[],[]).length,12)
assert.equal(build({...c,billing_method:'口座振替'},2026,1,[],[])[0].amount,null)
assert.throws(()=>build({...c,maintenance_start_date:null},2026,1,[],[]),/保守開始日/)
console.log('PASS: period-and-round identity, prepayment, undated existing rounds, cancellation, next period and mid-period restart review')
const long={periodStart:'2026-10-27',periodEnd:'2027-12-31'}
assert.equal(build(c,2026,1,[],[],long)[0].periodEnd,long.periodEnd)
const saved={...u,roundLabel:'第1回',...long}
assert.throws(()=>build(c,2027,1,[saved],[]),/重複/)
assert.equal(build(c,2028,1,[saved],[],{periodStart:'2028-01-01',periodEnd:'2028-12-31'})[0].periodStart,'2028-01-01')
assert.throws(()=>build(c,2026,1,[saved],[]),/異なります/)
assert.throws(()=>build(c,2026,1,[],[],{periodStart:'2026-02-30',periodEnd:'2027-12-31'}),/確認/)
const selectedItems=selected([{...items[0],include:true,exclusion:undefined},{...items[1],include:false}])
assert.equal(selectedItems.length,1);assert.equal(Object.hasOwn(selectedItems[0],'exclusion'),false)
assert.doesNotThrow(()=>JSON.stringify(selectedItems))
console.log('PASS: explicit extended initial period, next January period, overlap and inconsistent same-year rejection')
