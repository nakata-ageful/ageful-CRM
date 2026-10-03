// PRIVATE-input explicit isolated rehearsal. Never connects to a hosted database.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict')
const {compile,tables,canonical,buildPlan}=require('./prepare-active-source-sync.cjs')
;(async()=>{
 const [archive,baseFile,oldFile,newFile,outFile]=process.argv.slice(2),dir='/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups/'
 assert.ok([archive,baseFile,oldFile,newFile,outFile].every(f=>f&&path.resolve(f).startsWith(dir)),'Explicit private paths required')
 assert.ok(outFile.endsWith('.sql'));const read=f=>JSON.parse(fs.readFileSync(f)),base=read(baseFile),old=read(oldFile),current=read(newFile)
 const plan=buildPlan(base,old,current);assert.equal(plan.conflicts.length,0,JSON.stringify(plan.conflicts))
 const {PGlite}=await import('@electric-sql/pglite'),db=new PGlite({loadDataDir:new Blob([fs.readFileSync(archive)])})
 try{
  await db.exec("SET timezone='UTC'")
  await db.exec(`CREATE TABLE IF NOT EXISTS public.ageful_migration_target(project_ref text);INSERT INTO public.ageful_migration_target VALUES('ufawaiddntqqbjhycbxn');
   CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$`)
  for(const f of ['20260930_atomic_project_create.sql','20261003_billing_cycle_rules.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../database/migrations',f),'utf8'))
  // Only the disposable local copy bypasses triggers while restoring an exact backup.
  await db.exec('SET session_replication_role=replica');await db.exec(`TRUNCATE ${tables.map(t=>'public.'+t).join(',')} CASCADE`)
  for(const t of tables){await db.query(`INSERT INTO public.${t} OVERRIDING SYSTEM VALUE SELECT * FROM jsonb_populate_recordset(NULL::public.${t},$1::jsonb)`,[JSON.stringify(current[t])]);
   const hasId=(await db.query('SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3',['public',t,'id'])).rows.length
   if(hasId){const seq=(await db.query('SELECT pg_get_serial_sequence($1,$2) s',['public.'+t,'id'])).rows[0].s
    if(seq)await db.query(`SELECT setval($1::regclass,greatest(coalesce((SELECT max(id) FROM public.${t}),1),1),true)`,[seq])}
  }
  await db.exec('SET session_replication_role=origin')
  const snapshot=async()=>{const v={};for(const t of tables)v[t]=(await db.query(`SELECT to_jsonb(r) v FROM public.${t} r ORDER BY to_jsonb(r)::text`)).rows.map(r=>r.v);return v}
  const baseline=await snapshot(),result=await compile(db,base,old,current)
  assert.ok(!result.sql.includes('DISABLE TRIGGER')&&!result.sql.includes('session_replication_role')&&!result.sql.includes('GRANT '),'Live SQL must not weaken guards or access')
  const fail=result.sql.replace('SET CONSTRAINTS ALL IMMEDIATE;',()=>"DO $$ BEGIN RAISE EXCEPTION 'Injected final failure'; END $$;\nSET CONSTRAINTS ALL IMMEDIATE;")
  await assert.rejects(db.exec(fail),/Injected final failure/);await db.exec('ROLLBACK')
  assert.ok(canonical(await snapshot())===canonical(baseline),'Late failure must roll back all business, invoice and audit changes')
  const guardedBaseline=await snapshot();await db.exec("SET request.headers='{\"x-ageful-client\":\"ledger-v1\"}'")
  const owner=current.billing_runtime_control[0].owner_user_id;await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[owner])
  await db.exec("UPDATE contracts SET notes=coalesce(notes,'')||' concurrent test' WHERE id="+plan.updates[0].id)
  await assert.rejects(db.exec(result.sql),/Before snapshot changed: contracts/);await db.exec('ROLLBACK')
  await db.exec('SET session_replication_role=replica');await db.query('UPDATE contracts SET notes=s.notes,updated_at=s.updated_at FROM jsonb_populate_recordset(NULL::contracts,$1::jsonb) s WHERE contracts.id=s.id',[JSON.stringify(guardedBaseline.contracts)]);await db.exec('SET session_replication_role=origin')
  await db.exec(result.sql);const after=await snapshot()
  assert.ok(canonical(after.billing_cycle_rules)===canonical(baseline.billing_cycle_rules),'Today’s cycle rules remain exact')
  assert.ok(canonical(after.annual_records)===canonical(baseline.annual_records),'Immutable original sources remain exact')
  for(const e of plan.receipts){const u=after.billing_units.find(u=>u.id===e.unit.id);assert.equal(u.received_on,e.source.received_date);assert.equal(u.frozen_amount,e.unit.frozen_amount);assert.equal(u.period_start,e.unit.period_start);assert.equal(u.period_end,e.unit.period_end)}
  for(const e of plan.external){const u=after.billing_units.find(u=>u.occurrence_key===e.occurrence);assert.equal(u.frozen_amount,e.amount);assert.equal(u.received_on,e.source.received_date);assert.equal(u.period_start,null);assert.equal(u.period_end,null)}
  await assert.rejects(db.exec(result.sql),/Before snapshot changed/);await db.exec('ROLLBACK')
  assert.ok(canonical(await snapshot())===canonical(after),'Repeat execution must not duplicate financial records')
  const decimals=(await db.query(`SELECT pg_temp.ageful_sync_normalize('{"nested":[1.2000,{"money":0.00}],"nil":null}'::jsonb)=pg_temp.ageful_sync_normalize('{"nested":[1.2,{"money":0}],"nil":null}'::jsonb) same,
   pg_temp.ageful_sync_normalize('{"money":1.20}'::jsonb)<>pg_temp.ageful_sync_normalize('{"money":1.21}'::jsonb) changed`)).rows[0]
  assert.ok(decimals.same&&decimals.changed,'Nested numeric formatting must compare equal without hiding real value changes')
  fs.writeFileSync(outFile,result.sql,{flag:'wx',mode:0o600})
  const metadata={preparedOnly:true,realDataIsolatedRehearsal:true,output:path.basename(outFile),bytes:Buffer.byteLength(result.sql),
   updates:plan.updates.map(e=>({table:e.table,id:e.id,fields:Object.keys(e.fields)})),inserts:plan.inserts.map(e=>({table:e.table,id:e.row.id})),
   receipts:plan.receipts.map(e=>({sourceId:e.source.id,unitId:e.unit.id})),external:plan.external.map(e=>({sourceId:e.source.id,projectId:e.projectId,amount:e.amount})),
   preservedCycleRules:after.billing_cycle_rules.length,checks:['three-way merge','20-table stale snapshot guard','late failure full rollback','immutable sources unchanged','all existing audit retained','same replay rejected without duplicates','frozen money and periods retained']}
  fs.writeFileSync(outFile+'.verification.json',JSON.stringify(metadata,null,2),{flag:'wx',mode:0o600});console.log(JSON.stringify(metadata))
 }finally{await db.close()}
})().catch(e=>{console.error(e.message);process.exitCode=1})
