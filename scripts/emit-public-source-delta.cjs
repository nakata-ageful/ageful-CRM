// Generates a guarded SQL delta for the NEW, not-yet-enabled Supabase database.
// Never connects to a database. Source JSON and generated SQL stay outside git.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto')
const tables=['customers','projects','contracts','annual_records','maintenance_responses','periodic_maintenance','prospects','attachments']
const [beforeFile,afterFile,targetRef,outputFile]=process.argv.slice(2)
const privateDir='/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups'
if(!beforeFile||!afterFile||!targetRef||!outputFile||
  ![beforeFile,afterFile].every(file=>path.resolve(file).startsWith(privateDir+'/'))||
  path.dirname(path.resolve(outputFile))!==privateDir||
  !/^[a-z]{20}$/.test(targetRef)||!/^[-\w]+\.sql$/.test(path.basename(outputFile)))
  throw Error('Usage: node scripts/emit-public-source-delta.cjs PRIVATE_BASE_JSON PRIVATE_LATEST_JSON NEW_PROJECT_REF PRIVATE_OUTPUT_SQL')
if(['duoibibtuamilpneysnl','uyzpmksghwjngqylkwbk'].includes(targetRef))throw Error('Old production and verification projects are forbidden targets')
const before=JSON.parse(fs.readFileSync(beforeFile,'utf8')),after=JSON.parse(fs.readFileSync(afterFile,'utf8'))
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)
  ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v)
const q=value=>`'${String(value).replaceAll("'","''")}'`
const id=value=>{if(!/^[a-z][a-z0-9_]*$/.test(value))throw Error('Invalid SQL identifier');return `"${value}"`}
const sql=['BEGIN',"SET LOCAL statement_timeout='60s'",`DO $$ BEGIN
  IF to_regclass('public.ageful_migration_target') IS NULL OR to_regclass('public.billing_units') IS NOT NULL THEN
    RAISE EXCEPTION 'Not an untouched new migration target'; END IF;
  IF (SELECT count(*) FROM public.ageful_migration_target WHERE project_ref=${q(targetRef)})<>1 THEN
    RAISE EXCEPTION 'Wrong Supabase project target'; END IF; END $$`]
const changes={}
for(const table of tables){
  const oldRows=before[table],newRows=after[table]
  if(!Array.isArray(oldRows)||!Array.isArray(newRows)||new Set(oldRows.map(row=>row.id)).size!==oldRows.length||
    new Set(newRows.map(row=>row.id)).size!==newRows.length)throw Error(`Invalid or duplicate source rows: ${table}`)
  const oldById=new Map(oldRows.map(row=>[row.id,row]))
  const newById=new Map(newRows.map(row=>[row.id,row]))
  const removed=oldRows.filter(row=>!newById.has(row.id))
  if(removed.length)throw Error(`Source deletions need manual review: ${table} (${removed.length})`)
  const changed=newRows.filter(row=>!oldById.has(row.id)||canonical(oldById.get(row.id))!==canonical(row))
  changes[table]={before:oldRows.length,after:newRows.length,added:changed.filter(row=>!oldById.has(row.id)).length,
    updated:changed.filter(row=>oldById.has(row.id)).length}
  sql.push(`DO $$ BEGIN IF (SELECT count(*) FROM public.${id(table)})<>${oldRows.length} THEN
    RAISE EXCEPTION 'Unexpected baseline count for ${table}'; END IF; END $$`)
  if(!changed.length)continue
  sql.push(`ALTER TABLE public.${id(table)} DISABLE TRIGGER USER`)
  for(const row of changed){
    if(!Number.isSafeInteger(row.id)||row.id<=0)throw Error(`Invalid row ID: ${table}`)
    const columns=Object.keys(row)
    if(!columns.includes('id')||columns.some(column=>!/^[a-z][a-z0-9_]*$/.test(column)))throw Error(`Invalid columns: ${table}`)
    const updates=columns.filter(column=>column!=='id').map(column=>`${id(column)}=EXCLUDED.${id(column)}`).join(',')
    sql.push(`INSERT INTO public.${id(table)} SELECT * FROM jsonb_populate_record(NULL::public.${id(table)},${q(JSON.stringify(row))}::jsonb)
      ON CONFLICT (id) ${updates?`DO UPDATE SET ${updates}`:'DO NOTHING'}`)
  }
  sql.push(`ALTER TABLE public.${id(table)} ENABLE TRIGGER USER`)
  sql.push(`SELECT setval(pg_get_serial_sequence('public.${table}','id'),
    greatest((SELECT coalesce(max(id),1) FROM public.${id(table)}),(SELECT last_value FROM public.${id(table+'_id_seq')})),true)`)
}
for(const table of tables)sql.push(`DO $$ BEGIN IF (SELECT count(*) FROM public.${id(table)})<>${after[table].length} THEN
  RAISE EXCEPTION 'Unexpected result count for ${table}'; END IF; END $$`)
sql.push('COMMIT')
fs.writeFileSync(outputFile,sql.join(';\n')+';\n',{flag:'wx',mode:0o600})
console.log(JSON.stringify({prepared:true,scope:'private SQL; not executed',targetRef,changes,
  sourceHash:crypto.createHash('sha256').update(canonical(after)).digest('hex'),output:path.basename(outputFile)}))
