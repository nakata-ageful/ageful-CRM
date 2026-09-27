// Offline rehearsal: adapt only the host fingerprint to this older private archive.
const fs=require('node:fs'),assert=require('node:assert/strict');
const {tables,ledger}=require('../scripts/prepare-migrated-notes-delta.cjs');
async function main(){
 const archive=process.argv[2];if(!archive?.startsWith('/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups/'))throw Error('Private archive required');
 const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite({loadDataDir:new Blob([fs.readFileSync(archive)])});
 try{
  await db.exec("CREATE TABLE ageful_migration_target(project_ref text);INSERT INTO ageful_migration_target VALUES('ufawaiddntqqbjhycbxn');CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY,email text);INSERT INTO auth.users(id,email)VALUES('9a4b877c-d73d-4c37-a902-40c521240d06','admin@ageful.co.jp') ON CONFLICT DO NOTHING;CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$");
  const names=[...tables,...ledger],expr=`jsonb_build_object(${names.map(t=>`'${t}',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.${t} t)`).join(',')})`;
  const read=async()=>(await db.query(`SELECT ${expr} AS v`)).rows[0].v;
  const before=await read(),hash=(await db.query(`SELECT encode(sha256(convert_to((${expr})::text,'UTF8')),'hex') AS h`)).rows[0].h;
  const hostSql=fs.readFileSync(require('node:path').join(__dirname,'../database/drafts/20260927_enable_new_runtime.sql'),'utf8');
  const sql=hostSql.replace('aeb7f0ae0b80cebf64bd794ef786500a06d40de5b46a89625b9b0a3f8223a487',hash);
  await assert.rejects(db.exec(sql.replace(hash,'0'.repeat(64))),/baseline/);await db.exec('ROLLBACK');
  assert.deepEqual(await read(),before);
  await db.exec(sql);const after=await read(),control=after.billing_runtime_control;delete before.billing_runtime_control;delete after.billing_runtime_control;
  assert.deepEqual(after,before);assert.equal(control.length,1);assert.equal(control[0].enabled,true);assert.equal(control[0].future_schedule_coverage_verified,true);assert.equal(control[0].cutover_on,'2026-09-27');
  console.log(JSON.stringify({activationLocalRehearsal:true,wrongBaselineRejected:true,businessAndAuditTablesUnchanged:18,runtimeReady:true,hostWritten:false}));
 }finally{await db.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
