// Explicit source-bound user confirmations, never derived from the current contract.
const {hash}=require('./review-billing-backup.cjs')
function confirmedBillingHistory(data,approval){
 if(!approval||approval.datasetHash!==hash(data)||!Array.isArray(approval.confirmations))throw Error('確認内容とバックアップが一致しません')
 const result=new Map()
 for(const entry of approval.confirmations){
  const record=data.annual_records.find(r=>r.id===entry.recordId)
  if(!record||entry.sourceHash!==hash(record)||result.has(entry.recordId)||typeof entry.basis!=='string'||!entry.basis.trim())throw Error('元記録と確認根拠を確認してください')
  if(entry.method!==undefined&&entry.method!=='invoice')throw Error('未対応の過去方法です')
  if(entry.round!==undefined&&(!Number.isSafeInteger(entry.round)||entry.round<1||record.payments?.length))throw Error('単回記録の回番号確認が不正です')
  if(entry.method===undefined&&entry.round===undefined)throw Error('確認対象がありません')
  result.set(entry.recordId,Object.freeze({...entry}))
 }
 return result
}
module.exports={confirmedBillingHistory}
