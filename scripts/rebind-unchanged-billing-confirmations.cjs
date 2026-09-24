// Rebind existing billing confirmations to a newer source capture only when
// billing fields are unchanged. Monitoring notes/password may be updated on
// projects, but ownership, billing records, and contracts must be identical.
// Output is private and new-file-only; never edits approved inputs.
const fs=require('node:fs'),path=require('node:path')
const {hash}=require('./review-billing-backup.cjs')
const privateDir='/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups'
const [beforeFile,afterFile,historyFile,payerFile,historyOut,payerOut]=process.argv.slice(2)
const inputs=[beforeFile,afterFile,historyFile,payerFile]
if(inputs.some(file=>!file||!path.resolve(file).startsWith(privateDir+'/'))||
  [historyOut,payerOut].some(file=>!file||path.dirname(path.resolve(file))!==privateDir)||
  ![historyOut,payerOut].every(file=>/^[-\w]+\.json$/.test(path.basename(file))))
  throw Error('All inputs and outputs must be private-backups files')
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'))
const before=read(beforeFile),after=read(afterFile)
const unchanged=['customers','contracts','annual_records','maintenance_responses','prospects','attachments']
for(const table of unchanged){
  if(hash(before[table])!==hash(after[table]))throw Error(`Billing-relevant source table changed: ${table}`)
}
const projectById=new Map(before.projects.map(project=>[project.id,project]))
if(projectById.size!==before.projects.length||before.projects.length!==after.projects.length)
  throw Error('Project IDs changed')
const allowedProjectChanges=new Set(['monitoring_pw','monitoring_notes','updated_at'])
for(const project of after.projects){
  const old=projectById.get(project.id)
  if(!old)throw Error('Project ID changed')
  const changed=[...new Set([...Object.keys(old),...Object.keys(project)])]
    .filter(key=>hash({value:old[key]})!==hash({value:project[key]}))
  if(changed.some(key=>!allowedProjectChanges.has(key)))
    throw Error(`Billing-relevant project field changed at ID ${project.id}`)
}
const history=read(historyFile),payer=read(payerFile)
if(history.datasetHash!==hash(before)||payer.datasetHash!==hash(before))
  throw Error('Existing confirmations are not bound to the baseline capture')
const nextHash=hash(after)
history.datasetHash=nextHash
payer.datasetHash=nextHash
const audit={reason:'Only periodic_maintenance and project monitoring fields changed; billing-relevant fields match the approved baseline',baselineHash:hash(before)}
history.rebindAudit=audit
payer.rebindAudit=audit
fs.writeFileSync(historyOut,JSON.stringify(history,null,2),{flag:'wx',mode:0o600})
fs.writeFileSync(payerOut,JSON.stringify(payer,null,2),{flag:'wx',mode:0o600})
console.log(JSON.stringify({prepared:true,privateOutput:true,unchangedTables:unchanged.length,
  allowedProjectFields:[...allowedProjectChanges],updatedTable:'periodic_maintenance',historyConfirmations:history.confirmations.length,datasetHash:nextHash}))
