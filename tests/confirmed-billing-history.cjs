const assert=require('node:assert/strict')
const {hash}=require('../scripts/review-billing-backup.cjs')
const {confirmedBillingHistory:check}=require('../scripts/confirmed-billing-history.cjs')
const data={annual_records:[{id:1,year:2024,payments:null}]}
const entry={recordId:1,sourceHash:hash(data.annual_records[0]),method:'invoice',round:1,basis:'explicit user confirmation'}
const approval={datasetHash:hash(data),confirmations:[entry]}
assert.equal(check(data,approval).get(1).method,'invoice')
assert.throws(()=>check({...data,changed:true},approval),/バックアップ/)
assert.throws(()=>check(data,{...approval,confirmations:[{...entry,sourceHash:'stale'}]}),/元記録/)
assert.throws(()=>check(data,{...approval,confirmations:[entry,entry]}),/元記録/)
assert.throws(()=>check(data,{...approval,confirmations:[{...entry,round:0}]}),/回番号/)
assert.equal(data.annual_records[0].payments,null)
console.log('PASS: explicit method/round confirmations bind to exact backup and record; changed sources and duplicate approvals rejected')
