// Preparation only. No network/DB connection; output contains private source rows.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const tables=['customers','projects','contracts','annual_records','maintenance_responses','periodic_maintenance','prospects','attachments'];
const ledger=['billing_units','billing_operations','billing_recipient_plans','billing_recipient_plan_overrides','billing_unit_events','ownership_transfers','invoice_import_evidence','invoice_recipient_initializations','billing_migration_acceptances','billing_runtime_control','project_management_events'];
const allowed={customers:['postal_code','address','notes','updated_at'],projects:['power_company_notes','updated_at'],contracts:['maintenance_content_notes','updated_at'],periodic_maintenance:['content','updated_at']};
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const q=v=>`'${String(v).replaceAll("'","''")}'`;
const snapshot=names=>`jsonb_build_object(${names.map(t=>`${q(t)},(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) FROM public.${t} t)`).join(',')})`;
function build(before,after,target='ufawaiddntqqbjhycbxn'){
 if(target!=='ufawaiddntqqbjhycbxn')throw Error('Only the isolated new DB is allowed');
 const changes={},edits={};
 for(const t of tables){
  for(const data of [before,after])if(!Array.isArray(data[t])||data[t].some(r=>!Number.isSafeInteger(r.id)||r.id<=0||Object.keys(r).some(k=>!/^[a-z][a-z0-9_]*$/.test(k)))||new Set(data[t].map(r=>r.id)).size!==data[t].length)throw Error(`Invalid rows: ${t}`);
  const old=new Map(before[t].map(r=>[r.id,r])),now=new Map(after[t].map(r=>[r.id,r]));
  if(before[t].some(r=>!now.has(r.id)))throw Error(`Deletion forbidden: ${t}`);
  edits[t]=[];
  for(const row of after[t]){
   const prior=old.get(row.id);
   if(!prior){if(!['maintenance_responses','periodic_maintenance'].includes(t))throw Error(`Addition forbidden: ${t}`);edits[t].push({row,added:true});continue;}
   const fields=[...new Set([...Object.keys(prior),...Object.keys(row)])].filter(k=>canonical(prior[k])!==canonical(row[k]));
   if(fields.some(k=>!(allowed[t]||[]).includes(k)))throw Error(`Unapproved/billing field changed: ${t}/${row.id}`);
   if(fields.length)edits[t].push({row,fields});
  }
  changes[t]={before:before[t].length,after:after[t].length,added:edits[t].filter(e=>e.added).length,updated:edits[t].filter(e=>!e.added).length};
 }
 const sql=['BEGIN',"SET LOCAL timezone='UTC'","SET LOCAL statement_timeout='60s'","SET LOCAL lock_timeout='5s'",`LOCK TABLE ${[...tables,...ledger,'ageful_migration_target'].map(t=>'public.'+t).join(',')} IN SHARE ROW EXCLUSIVE MODE`,
 `DO $$ BEGIN IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR (SELECT count(*) FROM public.ageful_migration_target WHERE project_ref=${q(target)})<>1
 OR EXISTS(SELECT 1 FROM public.billing_runtime_control) OR EXISTS(SELECT 1 FROM public.ownership_transfers)
 OR (SELECT count(*) FROM public.billing_units)<>32 OR (SELECT coalesce(sum(frozen_amount),0) FROM public.billing_units)<>4177465
 OR (SELECT coalesce(sum(planned_amount),0) FROM public.billing_units)<>165000 THEN RAISE EXCEPTION 'Target/runtime/billing baseline mismatch'; END IF; END $$`,
 `CREATE TEMP TABLE ageful_delta_ledger ON COMMIT DROP AS SELECT ${snapshot(ledger)} AS value`];
 function verify(data,label){for(const t of tables)sql.push(`DO $$ BEGIN IF EXISTS(
 (SELECT to_jsonb(t) FROM public.${t} t EXCEPT SELECT to_jsonb(s) FROM jsonb_populate_recordset(NULL::public.${t},${q(JSON.stringify(data[t]))}::jsonb) s)
 UNION ALL (SELECT to_jsonb(s) FROM jsonb_populate_recordset(NULL::public.${t},${q(JSON.stringify(data[t]))}::jsonb) s EXCEPT SELECT to_jsonb(t) FROM public.${t} t)
 ) THEN RAISE EXCEPTION '${label} source mismatch: ${t}'; END IF; END $$`);}
 verify(before,'Before');
 for(const t of tables){if(!edits[t].length)continue;
  sql.push(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.${t}'::regclass AND NOT tgisinternal AND tgenabled<>'O') THEN RAISE EXCEPTION 'Unexpected trigger state: ${t}'; END IF; END $$`, `ALTER TABLE public.${t} DISABLE TRIGGER USER`);
  for(const e of edits[t]){
   const record=`jsonb_populate_record(NULL::public.${t},${q(JSON.stringify(e.row))}::jsonb)`;
   sql.push(e.added?`INSERT INTO public.${t} SELECT * FROM ${record}`:`UPDATE public.${t} AS t SET ${e.fields.map(k=>`"${k}"=s."${k}"`).join(',')} FROM ${record} s WHERE t.id=s.id`);
  }
  sql.push(`ALTER TABLE public.${t} ENABLE TRIGGER USER`);
 }
 verify(after,'After');
 sql.push(`DO $$ BEGIN IF ${snapshot(ledger)} IS DISTINCT FROM (SELECT value FROM ageful_delta_ledger) THEN RAISE EXCEPTION 'Billing/audit data changed'; END IF; END $$`);
 for(const t of ['maintenance_responses','periodic_maintenance'])if(edits[t].some(e=>e.added))sql.push(`DO $$ DECLARE seq text; last_id bigint; BEGIN seq:=pg_get_serial_sequence('public.${t}','id'); IF seq IS NOT NULL THEN SELECT max(id) INTO last_id FROM public.${t}; PERFORM setval(seq::regclass,greatest(last_id,coalesce(pg_sequence_last_value(seq::regclass),1)),true); END IF; END $$`);
 sql.push('COMMIT');
 const hash=data=>crypto.createHash('sha256').update(canonical(Object.fromEntries(tables.map(t=>[t,data[t]])))).digest('hex');
 return {sql:sql.join(';\n')+';\n',changes,beforeHash:hash(before),afterHash:hash(after)};
}
module.exports={build,tables,ledger};
if(require.main===module){
 const [beforeFile,afterFile,outFile]=process.argv.slice(2),privateDir='/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups';
 if(![beforeFile,afterFile].every(f=>f&&path.resolve(f).startsWith(privateDir+'/'))||!outFile||path.dirname(path.resolve(outFile))!==privateDir||!/^[-\w]+\.sql$/.test(path.basename(outFile)))throw Error('Private input/output paths required');
 const result=build(JSON.parse(fs.readFileSync(beforeFile,'utf8')),JSON.parse(fs.readFileSync(afterFile,'utf8')));
 fs.writeFileSync(outFile,result.sql,{flag:'wx',mode:0o600});
 console.log(JSON.stringify({preparedOnly:true,output:path.basename(outFile),changes:result.changes,beforeHash:result.beforeHash,afterHash:result.afterHash}));
}
