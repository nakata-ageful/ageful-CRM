// Isolated-engine rehearsal of the prepared private delta. No network access.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {tables,ledger}=require('../scripts/prepare-migrated-notes-delta.cjs');
const privateDir='/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups/';
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
async function main(){
 const [archive,sql,latest]=process.argv.slice(2);
 if(![archive,sql,latest].every(f=>f&&path.resolve(f).startsWith(privateDir)))throw Error('Private artifact paths required');
 const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite({loadDataDir:new Blob([fs.readFileSync(archive)])});
 const rows=async t=>(await db.query(`SELECT to_jsonb(t) value FROM ${t} t ORDER BY to_jsonb(t)::text`)).rows.map(r=>r.value);
 try{
  const before={};for(const t of ledger)before[t]=await rows(t);
  await db.exec("CREATE TABLE ageful_migration_target(project_ref text); INSERT INTO ageful_migration_target VALUES('ufawaiddntqqbjhycbxn')");
  await db.exec(fs.readFileSync(sql,'utf8'));const data=JSON.parse(fs.readFileSync(latest,'utf8'));
  for(const t of tables){const actual=await rows(t);assert.equal(canonical(actual.sort((a,b)=>a.id-b.id)),canonical([...data[t]].sort((a,b)=>a.id-b.id)),`Source mismatch: ${t}`);}
  for(const t of ledger)assert.equal(canonical(await rows(t)),canonical(before[t]),`Ledger changed: ${t}`);
  console.log(JSON.stringify({scope:'private source delta applied only in isolated PostgreSQL engine',sourceTablesEqual:8,ledgerTablesUnchanged:ledger.length,units:before.billing_units.length,actual:before.billing_units.reduce((n,u)=>n+Number(u.frozen_amount||0),0),runtimeRows:before.billing_runtime_control.length,productionWritten:false}));
 }finally{await db.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
