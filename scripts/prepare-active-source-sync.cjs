// Offline preparation only. Never connects to Supabase, loads credentials or changes a live DB.
// Field-wise three-way merge after activation; immutable legacy sources are NOT rewritten.
const assert=require('node:assert/strict'),crypto=require('node:crypto')
const sourceTables=['customers','projects','contracts','annual_records','maintenance_responses','periodic_maintenance','prospects','attachments']
const tables=[...sourceTables,'billing_units','billing_operations','billing_recipient_plans','billing_recipient_plan_overrides','billing_unit_events','ownership_transfers',
 'invoice_import_evidence','invoice_recipient_initializations','billing_migration_acceptances','billing_runtime_control','project_management_events','billing_cycle_rules']
const allowed={contracts:['billing_method','billing_count','billing_schedule_days','notes','maintenance_contract_notes','subcontract_billing_day','subcontract_start_date','subcontract_notes'],
 maintenance_responses:['status','report','situation','response_content']}
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x)
const equal=(a,b)=>canonical(a)===canonical(b),q=v=>`'${String(v).replaceAll("'","''")}'`,json=v=>q(JSON.stringify(v))+'::jsonb'
const hash=v=>crypto.createHash('sha256').update(canonical(v)).digest('hex')
const dateSql=v=>v===null?'NULL':q(v)+'::date'
const normalizer=`CREATE OR REPLACE FUNCTION pg_temp.ageful_sync_normalize(j jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
 BEGIN CASE jsonb_typeof(j)
 WHEN 'object' THEN RETURN coalesce((SELECT jsonb_object_agg(k,pg_temp.ageful_sync_normalize(v)) FROM jsonb_each(j) e(k,v)),'{}'::jsonb);
 WHEN 'array' THEN RETURN coalesce((SELECT jsonb_agg(pg_temp.ageful_sync_normalize(v) ORDER BY n) FROM jsonb_array_elements(j) WITH ORDINALITY e(v,n)),'[]'::jsonb);
 WHEN 'number' THEN RETURN to_jsonb(trim_scale((j#>>'{}')::numeric));
 ELSE RETURN j; END CASE; END $$;
 REVOKE ALL ON FUNCTION pg_temp.ageful_sync_normalize(jsonb) FROM PUBLIC,anon,authenticated;`
function rows(data,t){assert.ok(Array.isArray(data[t]),`Missing table: ${t}`);const r=data[t];assert.equal(new Set(r.map(x=>x.id)).size,r.length,`Duplicate IDs: ${t}`);return r}
function buildPlan(base,old,current){
 assert.equal(current.version,2);for(const t of tables)assert.ok(Array.isArray(current[t]),`Incomplete new backup: ${t}`)
 const updates=[],inserts=[],receipts=[],external=[],already=[],conflicts=[]
 for(const t of sourceTables){
  const a=new Map(rows(base,t).map(r=>[r.id,r])),b=new Map(rows(old,t).map(r=>[r.id,r])),n=new Map(rows(current,t).map(r=>[r.id,r]))
  for(const r of a.values())if(!b.has(r.id))conflicts.push({table:t,id:r.id,reason:'Source deletion requires review'})
  for(const r of b.values()){
   const prior=a.get(r.id),now=n.get(r.id)
   if(t==='annual_records')continue
   if(!prior){if(t!=='maintenance_responses'||now){conflicts.push({table:t,id:r.id,reason:'Unsupported addition or ID collision'});continue}
    assert.ok(current.projects.some(p=>p.id===r.project_id));inserts.push({table:t,row:r});continue}
   const changed=Object.keys(r).filter(k=>!['updated_at','created_at','id'].includes(k)&&!equal(prior[k],r[k]))
   if(!changed.length)continue
   if(!now){conflicts.push({table:t,id:r.id,reason:'Target row missing'});continue}
   const fields={}
   for(const k of changed){
    if(!(allowed[t]??[]).includes(k)){conflicts.push({table:t,id:r.id,field:k,reason:'Unreviewed field'});continue}
    if(equal(now[k],r[k])){already.push({table:t,id:r.id,field:k});continue}
    if(!equal(now[k],prior[k])){conflicts.push({table:t,id:r.id,field:k,reason:'Changed in both databases'});continue}
    fields[k]=r[k]
   }
   if(Object.keys(fields).length)updates.push({table:t,id:r.id,fields})
  }
 }
 const oldContracts=new Map(old.contracts.map(c=>[c.id,c])),newContracts=new Map(current.contracts.map(c=>[c.id,c]))
 for(const r of old.annual_records){
  const prior=base.annual_records.find(s=>s.id===r.id)
  if(prior&&equal(prior,r))continue
  const c=oldContracts.get(r.contract_id),nc=newContracts.get(r.contract_id)
  const p=old.projects.find(p=>p.id===c?.project_id),np=current.projects.find(p=>p.id===c?.project_id)
  if(!c||!nc||!p||!np||p.customer_id!==np.customer_id||nc.project_id!==c.project_id||
    current.ownership_transfers.some(t=>t.project_id===p.id)){conflicts.push({table:'annual_records',id:r.id,reason:'Contract/owner correspondence unclear'});continue}
  const own=current.billing_units.filter(u=>u.project_id===p.id)
  if(prior){
   const changed=Object.keys(r).filter(k=>k!=='updated_at'&&!equal(prior[k],r[k]))
   const match=own.filter(u=>u.source_annual_record_id===r.id)
   if(changed.some(k=>!['received_date','status'].includes(k))||r.status!=='入金済'||!r.received_date||prior.received_date||
     r.payments!==null||match.length!==1||match[0].lifecycle!=='issued'||match[0].received_on||match[0].collection_method!=='invoice'||
     !equal(current.annual_records.find(s=>s.id===r.id),prior)||match[0].recipient_customer_id!==p.customer_id||match[0].issued_on!==r.billing_date||
     match[0].payment_due_on!==r.payment_due_date||!equal(match[0].frozen_line_items,r.line_items)||match[0].frozen_amount!==r.line_items?.reduce((s,x)=>s+x.amount,0)){
    conflicts.push({table:'annual_records',id:r.id,reason:'Receipt update needs individual reconciliation'});continue}
   receipts.push({source:r,unit:match[0],key:crypto.randomUUID()})
  }else{
   const occurrence=`external:duoibibtuamilpneysnl:annual:${r.id}`
   if(current.annual_records.some(s=>s.id===r.id)||own.some(u=>u.service_year===r.year)||c.billing_method!=='請求書'||nc.billing_method!=='請求書'||c.billing_count!==1||nc.billing_count!==1||
     r.payments!==null||!r.billing_date||!r.received_date||r.status!=='入金済'||r.transfer_failed||r.maintenance_record||r.escort_record||
     !Array.isArray(r.line_items)||!r.line_items.length||r.line_items.some(x=>typeof x.name!=='string'||!x.name.trim()||!Number.isSafeInteger(x.amount)||x.amount<0)){
    conflicts.push({table:'annual_records',id:r.id,reason:'New source invoice needs individual reconciliation'});continue}
   const amount=r.line_items.reduce((s,x)=>s+x.amount,0);assert.ok(Number.isSafeInteger(amount))
   external.push({source:r,projectId:p.id,recipientId:p.customer_id,amount,occurrence,key:crypto.randomUUID(),sourceHash:hash(r)})
  }
 }
 return {updates,inserts,receipts,external,already,conflicts}
}
// Normalize SQL scalar representations through the target table's actual types.
// Live guards also include all other rows/fields, not merely row counts.
const digest=(from,alias,ignored=[],ids=[])=>{
 const omit=ignored.length?`CASE WHEN ${alias}.id IN (${ids.join(',')}) THEN to_jsonb(${alias})-${q(ignored[0])}${ignored.slice(1).map(k=>'-'+q(k)).join('')} ELSE to_jsonb(${alias}) END`:`to_jsonb(${alias})`
 const normalized=`pg_temp.ageful_sync_normalize(${omit})`
 return `SELECT encode(sha256(convert_to(coalesce(jsonb_agg(${normalized} ORDER BY ${normalized}::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex') FROM ${from} ${alias}`
}
async function compile(db,base,old,current){
 await db.exec("SET timezone='UTC'")
 await db.exec(normalizer)
 const plan=buildPlan(base,old,current);assert.equal(plan.conflicts.length,0,JSON.stringify(plan.conflicts))
 assert.ok(plan.updates.length+plan.inserts.length+plan.receipts.length+plan.external.length>0,'Nothing to synchronize')
 const expected=structuredClone(current)
 for(const e of plan.updates)Object.assign(expected[e.table].find(r=>r.id===e.id),e.fields)
 for(const e of plan.inserts)expected[e.table].push(e.row)
 const beforeHashes={},afterHashes={}
 for(const t of tables){
  // Fail rather than silently dropping a column absent from the rehearsal schema.
  const columns=(await db.query('SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2',['public',t])).rows.map(r=>r.column_name)
  const keys=[...new Set(current[t].flatMap(Object.keys))];assert.ok(keys.every(k=>columns.includes(k)),`Schema mismatch: ${t}`)
  const result=await db.query(digest(`jsonb_populate_recordset(NULL::public.${t},$1::jsonb)`,'r'),[JSON.stringify(current[t])]);beforeHashes[t]=result.rows[0].encode
  if(!['billing_units','billing_operations','billing_unit_events'].includes(t)){
   const ids=plan.updates.filter(e=>e.table===t).map(e=>e.id)
   afterHashes[t]=(await db.query(digest(`jsonb_populate_recordset(NULL::public.${t},$1::jsonb)`,'r',ids.length?['updated_at']:[],ids),[JSON.stringify(expected[t])])).rows[0].encode
  }
 }
 const sql=['BEGIN',"SET LOCAL timezone='UTC'","SET LOCAL statement_timeout='60s'","SET LOCAL lock_timeout='5s'",normalizer,`LOCK TABLE ${tables.map(t=>'public.'+t).join(',')} IN SHARE ROW EXCLUSIVE MODE`,
 `DO $$ BEGIN IF (SELECT count(*) FROM public.ageful_migration_target)<>1 OR NOT EXISTS(SELECT 1 FROM public.ageful_migration_target WHERE project_ref='ufawaiddntqqbjhycbxn')
 OR (SELECT count(*) FROM public.billing_runtime_control WHERE enabled AND owner_user_id IS NOT NULL)<>1 THEN RAISE EXCEPTION 'Wrong target/runtime'; END IF; END $$`]
 for(const t of tables)sql.push(`DO $$ BEGIN IF (${digest('public.'+t,'r')}) IS DISTINCT FROM ${q(beforeHashes[t])} THEN RAISE EXCEPTION 'Before snapshot changed: ${t}'; END IF; END $$`)
 sql.push(`SELECT set_config('request.jwt.claim.sub',(SELECT owner_user_id::text FROM public.billing_runtime_control WHERE enabled),true)`,
  `SELECT set_config('request.jwt.claims',jsonb_build_object('sub',(SELECT owner_user_id::text FROM public.billing_runtime_control WHERE enabled),'role','authenticated')::text,true)`,
  `SELECT set_config('request.headers','{"x-ageful-client":"ledger-v1"}',true)`, 'SELECT public.assert_billing_runtime_access()')
 for(const e of plan.updates)sql.push(`UPDATE public.${e.table} t SET ${Object.keys(e.fields).map(k=>`"${k}"=s."${k}"`).join(',')}
 FROM jsonb_populate_record(NULL::public.${e.table},${json(e.fields)}) s WHERE t.id=${e.id}`)
 for(const e of plan.inserts)sql.push(`INSERT INTO public.${e.table} SELECT * FROM jsonb_populate_record(NULL::public.${e.table},${json(e.row)})`)
 for(const e of plan.receipts){
  const reason=`旧アプリ最終差分同期：annual_records/${e.source.id} の入金日を原記録どおり反映。元データSHA-256 ${hash(e.source)}`
  sql.push(`SELECT public.billing_runtime_write(${q(e.key)}::uuid,${json({action:'invoice',value:{unitId:e.unit.id,revision:e.unit.revision,mode:'collection',value:{received_on:e.source.received_date},reason}})})`)
 }
 for(const e of plan.external){
  const reason=`旧アプリ最終差分同期：annual_records/${e.source.id}。金額・請求日・入金日は保存明細からコピー。保守期間と回番号は未確認のため推測せず未設定。`
  const proof={source_project_ref:'duoibibtuamilpneysnl',source_record:e.source,source_snapshot_hash:e.sourceHash}
  sql.push(`DO $$ DECLARE actor uuid:=auth.uid(); u public.billing_units%ROWTYPE; BEGIN
 IF EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=${e.projectId} AND (service_year=${e.source.year} OR occurrence_key=${q(e.occurrence)})) THEN RAISE EXCEPTION 'New source collides with existing invoice'; END IF;
 INSERT INTO public.billing_operations(operation_key,operation_kind,project_id,request_hash,actor_user_id)
 VALUES(${q(e.key)}::uuid,'issue',${e.projectId},${q(hash(proof))},actor);
 INSERT INTO public.billing_units(project_id,contract_id,recipient_customer_id,recipient_source,occurrence_key,service_year,
 original_method,collection_method,lifecycle,collection_state,scheduled_date,issued_on,payment_due_on,received_on,
 frozen_amount,frozen_line_items,frozen_at,amount_basis,source_snapshot_hash,plan_note)
 VALUES(${e.projectId},${e.source.contract_id},${e.recipientId},'confirmed',${q(e.occurrence)},${e.source.year},'invoice','invoice','received','succeeded',
 ${dateSql(e.source.billing_scheduled_date)},${dateSql(e.source.billing_date)},${dateSql(e.source.payment_due_date)},${dateSql(e.source.received_date)},
 ${e.amount},${json(e.source.line_items)},clock_timestamp(),'source_record',${q(e.sourceHash)},${q(reason)}) RETURNING * INTO u;
 INSERT INTO public.billing_unit_events(project_id,billing_unit_id,operation_key,event_type,reason,before_value,after_value,actor_user_id)
 VALUES(${e.projectId},u.id,${q(e.key)}::uuid,'created',${q(reason)},${json(proof)},to_jsonb(u),actor);
 UPDATE public.billing_operations SET completed_at=clock_timestamp() WHERE operation_key=${q(e.key)}::uuid;
 END $$`)
 }
 for(const [t,h] of Object.entries(afterHashes)){
  const ids=plan.updates.filter(e=>e.table===t).map(e=>e.id)
  sql.push(`DO $$ BEGIN IF (${digest('public.'+t,'r',ids.length?['updated_at']:[],ids)}) IS DISTINCT FROM ${q(h)} THEN RAISE EXCEPTION 'After preservation mismatch: ${t}'; END IF; END $$`)
 }
 // Untouched invoices and ALL frozen amounts/periods of the changed invoice stay exact.
 const ignored=['received_on','lifecycle','collection_state','revision','updated_at'],receiptIds=plan.receipts.map(e=>e.unit.id)
 const unitHash=(await db.query(digest('jsonb_populate_recordset(NULL::public.billing_units,$1::jsonb)','r',ignored,receiptIds),[JSON.stringify(current.billing_units)])).rows[0].encode
 sql.push(`DO $$ BEGIN IF (${digest(`(SELECT * FROM public.billing_units WHERE id IN (${current.billing_units.map(u=>u.id).join(',')}))`,'r',ignored,receiptIds)}) IS DISTINCT FROM ${q(unitHash)}
 OR (SELECT count(*) FROM public.billing_units)<>${current.billing_units.length+plan.external.length} THEN RAISE EXCEPTION 'Existing financial records changed unexpectedly'; END IF; END $$`)
 for(const e of plan.receipts)sql.push(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.billing_units WHERE id=${e.unit.id} AND received_on=${q(e.source.received_date)}::date
 AND lifecycle='received' AND collection_state='succeeded' AND revision=${e.unit.revision+1}) THEN RAISE EXCEPTION 'Receipt mismatch'; END IF; END $$`)
 for(const e of plan.external)sql.push(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.billing_units WHERE project_id=${e.projectId} AND occurrence_key=${q(e.occurrence)}
 AND recipient_customer_id=${e.recipientId} AND service_year=${e.source.year} AND frozen_amount=${e.amount} AND frozen_line_items=${json(e.source.line_items)}
 AND scheduled_date IS NOT DISTINCT FROM ${dateSql(e.source.billing_scheduled_date)} AND issued_on=${dateSql(e.source.billing_date)} AND received_on=${dateSql(e.source.received_date)}
 AND lifecycle='received' AND period_start IS NULL AND period_end IS NULL AND round_number IS NULL AND source_snapshot_hash=${q(e.sourceHash)}) THEN RAISE EXCEPTION 'Imported source mismatch'; END IF; END $$`)
 for(const t of ['billing_operations','billing_unit_events']){
  const key=t==='billing_operations'?'operation_key':'id',values=current[t].map(r=>q(r[key]))
  sql.push(`DO $$ BEGIN IF (${digest(`(SELECT * FROM public.${t} WHERE ${key} IN (${values.join(',')}))`,'r')}) IS DISTINCT FROM ${q(beforeHashes[t])}
  OR (SELECT count(*) FROM public.${t})<>${current[t].length+plan.receipts.length+plan.external.length} THEN RAISE EXCEPTION 'Audit preservation mismatch: ${t}'; END IF; END $$`)
 }
 // Sequence advancement is scoped to added maintenance rows; no trigger is disabled.
 if(plan.inserts.length)sql.push(`DO $$ DECLARE s text; BEGIN s:=pg_get_serial_sequence('public.maintenance_responses','id');IF s IS NOT NULL THEN
 PERFORM setval(s::regclass,greatest((SELECT max(id) FROM public.maintenance_responses),coalesce(pg_sequence_last_value(s::regclass),1)),true); END IF; END $$`)
 sql.push('SET CONSTRAINTS ALL IMMEDIATE','COMMIT')
 return {plan,sql:sql.join(';\n')+';\n',beforeHashes,afterHashes}
}
module.exports={buildPlan,compile,tables,sourceTables,canonical,hash,digest,normalizer}
