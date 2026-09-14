const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),path=require('node:path')
const root=path.resolve(__dirname,'..'),subject={exports:{}}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/future-schedule-review.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:subject.exports})
const review=subject.exports.reviewFutureSchedule
const candidate={projectId:1,recipientId:1,method:'invoice',date:'2028-06-15',round:1,amount:100,status:'missing'}
const unit={projectId:1,serviceYear:2028,roundLabel:'第1回',scheduledDate:'2028-07-01',lifecycle:'planned'}
assert.equal(review([candidate],[])[0].exclusion,undefined)
assert.match(review([candidate],[unit])[0].exclusion,/対応確認/)
assert.match(review([candidate],[{...unit,lifecycle:'cancelled'}])[0].exclusion,/取りやめ/)
assert.match(review([candidate],[{...unit,scheduledDate:null}])[0].exclusion,/日付未設定/)
assert.equal(review([candidate],[{...unit,projectId:2}])[0].exclusion,undefined)
assert.match(review([candidate,{...candidate,round:2}],[])[0].exclusion,/同じ日に複数回/)
assert.match(review([candidate],[{...unit,roundLabel:'1月分'}])[0].exclusion,/対応確認/)
assert.match(review([{...candidate,method:'direct_debit',round:6}],[unit])[0].exclusion,/対応確認/)
const before=JSON.stringify({candidate,unit});review([candidate],[unit]);assert.equal(JSON.stringify({candidate,unit}),before)
const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8')
assert.ok(app.includes('row={{...row,contract:projectDetail.contract}}'),'Pass plain contract, not joined annual_records, to snapshot comparison')
console.log('PASS: duplicate dates, moved/cancelled rounds, cross-method ambiguity, undated plans, project isolation and unjoined contract payload')
