// Offline validation of the exact SQL intended for the approved hosted rollback test.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {tables,ledger}=require('../scripts/prepare-migrated-notes-delta.cjs');
async function main(){
 const archive=process.argv[2],dir='/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups/';
 if(!archive||!path.resolve(archive).startsWith(dir))throw Error('Private archive required');
 const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite({loadDataDir:new Blob([fs.readFileSync(archive)])});
 const read=async()=>{const s={};for(const t of [...tables,...ledger])s[t]=(await db.query(`SELECT to_jsonb(t) value FROM ${t} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.value);return s;};
 try{
  await db.exec("CREATE TABLE ageful_migration_target(project_ref text); INSERT INTO ageful_migration_target VALUES('ufawaiddntqqbjhycbxn'); CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$");
  const before=await read(),sql=fs.readFileSync(path.join(__dirname,'../database/drafts/20260926_hosted_rollback_smoke.sql'),'utf8');
  assert(!/\bCOMMIT\s*;/i.test(sql.replace(/--[^\n]*/g,'')));const result=await db.exec(sql);assert.deepEqual(await read(),before);
  console.log(JSON.stringify({exactSqlLocalTest:true,sourceAndLedgerTablesUnchanged:19,result:result.at(-1).rows?.[0]?.result,productionWritten:false}));
 }finally{await db.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
