// Read-only verification of the NEW Supabase clone. Use only after the user
// enters its DB password into a terminal; this file never stores credentials.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process')
const psql='/Volumes/Postgres-2.9.6-18/Postgres.app/Contents/Versions/18/bin/psql'
const privateDir='/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups'
const target='ufawaiddntqqbjhycbxn'
const host='aws-0-ap-northeast-1.pooler.supabase.com'
const user=`postgres.${target}`
const owner='9a4b877c-d73d-4c37-a902-40c521240d06'
const sourceFile=process.argv[2]
if(!sourceFile||!path.resolve(sourceFile).startsWith(privateDir+'/')||!process.env.PGPASSWORD)
  throw Error('Private source snapshot and terminal-provided DB password are required')
const source=JSON.parse(fs.readFileSync(sourceFile,'utf8'))
const tables=['customers','projects','contracts','annual_records','maintenance_responses','periodic_maintenance','prospects','attachments']
function query(sql){
  return execFileSync(psql,[`--host=${host}`,'--port=5432',`--username=${user}`,'--dbname=postgres',
    '--no-psqlrc','--set=ON_ERROR_STOP=1','--tuples-only','--no-align','--command',sql],
    {encoding:'utf8',maxBuffer:20_000_000,env:{...process.env,PGSSLMODE:'require',PGCONNECT_TIMEOUT:'15'}}).trim()
}
const marker=query('select project_ref from public.ageful_migration_target')
if(marker!==target)throw Error('Wrong Supabase target')
const canonical=value=>JSON.stringify(value,(_,v)=>{
  if(typeof v==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(v))return new Date(v).toISOString()
  return v&&typeof v==='object'&&!Array.isArray(v)
    ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v
})
for(const table of tables){
  if(!Array.isArray(source[table]))throw Error(`Source table missing: ${table}`)
  const rows=JSON.parse(query(`select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]'::jsonb)::text from public.${table} t`))
  if(canonical(source[table])!==canonical(rows)){
    const base=new Map(source[table].map(row=>[row.id,row])),fresh=new Map(rows.map(row=>[row.id,row]))
    const mismatched=[...new Set([...base.keys(),...fresh.keys()])].flatMap(id=>{
      const before=base.get(id),after=fresh.get(id)
      if(!before||!after)return [{id,kind:before?'missing':'extra'}]
      const fields=[...new Set([...Object.keys(before),...Object.keys(after)])]
        .filter(key=>canonical(before[key])!==canonical(after[key]))
      return fields.length?[{id,fields}]:[]
    })
    console.error(JSON.stringify({table,mismatched:mismatched.slice(0,10)}))
    throw Error(`Source table differs: ${table}`)
  }
}
const stats=JSON.parse(query(`select jsonb_build_object(
  'units',(select count(*) from public.billing_units),
  'source_units',(select count(*) from public.billing_units where source_annual_record_id is not null),
  'actual_amount',(select coalesce(sum(frozen_amount),0) from public.billing_units),
  'planned_amount',(select coalesce(sum(planned_amount),0) from public.billing_units where lifecycle='planned'),
  'evidence',(select count(*) from public.invoice_import_evidence),
  'accepted',(select count(*) from public.billing_migration_acceptances),
  'owner_exists',(select exists(select 1 from auth.users where id='${owner}'::uuid and email='admin@ageful.co.jp')),
  'anon_select_grants',(select count(*) from (values ${tables.map(t=>`('${t}')`).join(',')}) names(table_name)
    where has_table_privilege('anon','public.'||table_name,'SELECT')),
  'tables_without_rls',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and not c.relrowsecurity)
)::text`))
const expected={units:32,source_units:31,actual_amount:4177465,planned_amount:165000,evidence:26,accepted:87,
  owner_exists:true,anon_select_grants:0,tables_without_rls:0}
for(const [key,value] of Object.entries(expected))if(stats[key]!==value)throw Error(`New DB verification failed: ${key} ${stats[key]}`)
console.log(JSON.stringify({verified:true,target,sourceCounts:Object.fromEntries(tables.map(t=>[t,source[t].length])),...stats}))
