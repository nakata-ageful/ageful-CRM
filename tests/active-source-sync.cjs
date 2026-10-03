// Offline merge review, no network, credentials or live DB writes.
const assert=require('node:assert/strict'),{buildPlan,tables,sourceTables}=require('../scripts/prepare-active-source-sync.cjs')
const base=Object.fromEntries(sourceTables.map(t=>[t,[]]))
base.projects=[{id:1,customer_id:1}];base.customers=[{id:1}]
base.contracts=[{id:1,project_id:1,notes:'元備考',billing_method:'請求書',billing_count:1,billing_schedule_days:['7月1日'],maintenance_start_date:'2023-08-01'}]
base.maintenance_responses=[{id:1,project_id:1,status:'対応中',report:null}]
const old=structuredClone(base),current={version:2,...Object.fromEntries(tables.map(t=>[t,[]])),...structuredClone(base)}
old.contracts[0].notes='旧で追記';old.contracts[0].billing_schedule_days=['12月1日'];old.maintenance_responses[0].status='完了'
old.maintenance_responses.push({id:2,project_id:1,status:'対応中'})
current.contracts[0].billing_schedule_days=['12月1日'];current.contracts[0].maintenance_start_date='2023-09-01'
current.billing_cycle_rules=[{id:1,project_id:1,effective_year:2027,mode:'calendar_prepaid'}]
const before=JSON.stringify({base,old,current}),plan=buildPlan(base,old,current)
assert.equal(plan.conflicts.length,0);assert.deepEqual(plan.updates[0].fields,{notes:'旧で追記'})
assert.equal(plan.inserts.length,1);assert.equal(plan.already.length,1)
assert.equal(JSON.stringify({base,old,current}),before,'Planning cannot mutate source, today’s periods or cycle rules')
const concurrent=structuredClone(current);concurrent.contracts[0].notes='新で変更'
assert.equal(buildPlan(base,old,concurrent).conflicts[0].reason,'Changed in both databases')
const collision=structuredClone(current);collision.maintenance_responses.push({id:2,project_id:1,status:'別対応'})
assert.ok(buildPlan(base,old,collision).conflicts.some(c=>c.reason.includes('collision')))
const deletion=structuredClone(old);deletion.projects=[]
assert.ok(buildPlan(base,deletion,current).conflicts.some(c=>c.reason.includes('deletion')))
const moneyChange=structuredClone(old);moneyChange.contracts[0].annual_maintenance_inc=100
assert.ok(buildPlan(base,moneyChange,current).conflicts.some(c=>c.reason==='Unreviewed field'))
console.log('PASS: field-wise three-way merge, today’s settings untouched, same changes recognized, concurrent conflicts/deletions/ID collisions and unreviewed financial fields rejected')
