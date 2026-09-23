// Emits the pinned SQL schema bundle for a new Supabase project. Never connects to a DB.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'..')
const manifest=JSON.parse(fs.readFileSync(path.join(root,'database/drafts/PRODUCTION_CUTOVER_MANIFEST_2026-09-21.json'),'utf8'))
const output=process.argv[2],privateDir='/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups'
if(!output||path.dirname(path.resolve(output))!==privateDir||!/^[-\w]+\.sql$/.test(path.basename(output)))throw Error('Output must be a new private-backups/*.sql file')
if(manifest.files.length!==17||manifest.productionCutoverReady!==false)throw Error('Unexpected cutover manifest')
const bodies=manifest.files.map(file=>{
 const body=fs.readFileSync(path.join(root,file.path),'utf8')
 if(crypto.createHash('sha256').update(body).digest('hex')!==file.sha256)throw Error(`Pinned SQL changed: ${file.path}`)
 return body
})
const sql=['BEGIN',"SET LOCAL ageful.allow_draft_migration='yes'",...bodies,'COMMIT'].join(';\n')+';\n'
fs.writeFileSync(output,sql,{flag:'wx',mode:0o600})
console.log(JSON.stringify({prepared:true,scope:'private SQL; not executed',files:bodies.length,output:path.basename(output)}))
