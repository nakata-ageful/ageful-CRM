const assert=require('node:assert/strict');
const {build,tables,ledger}=require('../scripts/prepare-migrated-notes-delta.cjs');
const before={customers:[{id:1,name:'A',notes:'old'}],projects:[{id:1,customer_id:1,power_company_notes:'old'}],contracts:[{id:1,project_id:1,annual_maintenance_inc:100,maintenance_content_notes:'old'}],annual_records:[{id:1,contract_id:1,status:'paid'}],maintenance_responses:[],periodic_maintenance:[{id:1,project_id:1,content:'old'}],prospects:[],attachments:[]};
const after=structuredClone(before);after.customers[0].notes='new';after.projects[0].power_company_notes='new';after.contracts[0].maintenance_content_notes='new';after.periodic_maintenance[0].content='new';after.maintenance_responses.push({id:1,project_id:1,notes:'added'});after.periodic_maintenance.push({id:2,project_id:1,content:'added'});
async function create(){
 const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite();
 await db.exec(`CREATE TABLE ageful_migration_target(project_ref text); INSERT INTO ageful_migration_target VALUES('ufawaiddntqqbjhycbxn');`);
 for(const t of tables){const rows=[...before[t],...after[t]],keys=[...new Set(rows.flatMap(Object.keys))];if(!keys.includes('id'))keys.push('id');
  await db.exec(`CREATE TABLE ${t}(${keys.map(k=>`"${k}" ${k==='id'||k.endsWith('_id')||k.endsWith('_inc')?'bigint':'text'}${k==='id'?' primary key':''}`).join(',')})`);
  for(const row of before[t])await db.query(`INSERT INTO ${t} SELECT * FROM jsonb_populate_record(NULL::${t},$1::jsonb)`,[JSON.stringify(row)]);
 }
 for(const t of ledger)await db.exec(`CREATE TABLE ${t}(id bigint${t==='billing_units'?',frozen_amount bigint,planned_amount bigint':''})`);
 await db.exec(`INSERT INTO billing_units SELECT i,CASE WHEN i=1 THEN 4177465 ELSE 0 END,CASE WHEN i=1 THEN 165000 ELSE 0 END FROM generate_series(1,32) i;`);
 return db;
}
async function state(db){const result={};for(const t of [...tables,...ledger])result[t]=(await db.query(`SELECT to_jsonb(t) value FROM ${t} t ORDER BY id`)).rows.map(r=>r.value);return result;}
async function main(){
 const generated=build(before,after);const db=await create();try{
  const original=await state(db);await db.exec(generated.sql);const saved=await state(db);
  for(const t of tables)assert.deepEqual(saved[t],after[t]);for(const t of ledger)assert.deepEqual(saved[t],original[t]);
 }finally{await db.close();}
 for(const [label,change] of [['wrong target',"UPDATE ageful_migration_target SET project_ref='duoibibtuamilpneysnl'"],['active runtime','INSERT INTO billing_runtime_control VALUES(1)'],['stale source',"UPDATE customers SET notes='concurrent'"],['billing drift','UPDATE billing_units SET frozen_amount=1 WHERE id=1']]){
  const db=await create();try{await db.exec(change);const snapshot=await state(db);await assert.rejects(db.exec(generated.sql));await db.exec('ROLLBACK');assert.deepEqual(await state(db),snapshot,label);}finally{await db.close();}
 }
 const invalid=structuredClone(after);invalid.contracts[0].annual_maintenance_inc=999;assert.throws(()=>build(before,invalid),/Unapproved/);
 const removed=structuredClone(after);removed.customers=[];assert.throws(()=>build(before,removed),/Deletion/);
 assert.throws(()=>build(before,after,'duoibibtuamilpneysnl'),/isolated/);
 console.log('PASS: metadata/maintenance-only delta, exact source guards, billing immutability, old-target rejection, stale/runtime rejection and full rollback');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
