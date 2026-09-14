import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();
try{
 await db.exec(`create table public.preflight_fixture(id bigserial primary key, note text);
 insert into preflight_fixture(note) values ('unchanged');
 alter table preflight_fixture enable row level security;
 create policy fixture_read on preflight_fixture for select using (true);`);
 const sql=readFileSync(new URL('../database/drafts/20260914_readonly_preflight.sql',import.meta.url),'utf8');
 const results=await db.exec(sql),report=results.find(r=>r.rows?.[0]?.preflight)?.rows[0].preflight;
 assert.ok(report);
 assert.equal(report.tables.find(t=>t.table_name==='preflight_fixture').rls,true);
 assert.ok(report.columns.some(c=>c.column_name==='note'));
 assert.ok(report.policies.some(p=>p.policyname==='fixture_read'));
 assert.equal((await db.query('select note from preflight_fixture')).rows[0].note,'unchanged');
 assert.equal((await db.query('show transaction_read_only')).rows[0].transaction_read_only,'off');
 console.log('PASS: read-only catalog inventory executes, includes columns/RLS/policies, preserves rows, ends transaction');
}finally{await db.close()}
