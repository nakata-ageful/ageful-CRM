// Isolated synthetic Postgres. Never connects to a real project.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {PGlite} from '@electric-sql/pglite'
const db=new PGlite(),actor='11111111-1111-4111-8111-111111111111'
const read=f=>readFileSync(new URL('../database/'+f,import.meta.url),'utf8')
let sequence=0;const key=()=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(++sequence).padStart(12,'0')}`
const rows=async t=>(await db.query(`select to_jsonb(x) value from ${t} x order by to_jsonb(x)::text`)).rows.map(r=>r.value)
const one=async(t,id)=>(await db.query(`select to_jsonb(x) value from ${t} x where id=$1`,[id])).rows[0]?.value
const snap=async()=>Object.fromEntries(await Promise.all(['customers','projects','contracts','prospects','billing_units','annual_records','billing_recipient_plans','ownership_transfers','new_prospect_events'].map(async t=>[t,await rows(t)])))
const write=(id,r)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');return (await tx.query('select new_prospect_write($1,$2::jsonb) value',[id,JSON.stringify(r)])).rows[0].value})
try{
 await db.exec(`create role authenticated;create role anon;create schema auth;
  grant usage on schema public,auth to authenticated,anon;
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
  set test.actor='${actor}';set request.headers='{"x-ageful-client":"ledger-v1"}';`)
 await db.exec(read('schema.sql'))
 await db.exec('alter table contracts add column ownership_transfer_date date,add column billing_schedule_days text[],add column maintenance_contractor text')
 await db.transaction(async tx=>{await tx.exec("set local ageful.allow_draft_migration='yes'");
  for(const f of ['20260907_billing_ownership_foundation.sql','20260907_invoice_write_rpc.sql','20260907_invoice_import_rpc.sql',
   '20260907_preserve_maintenance_source.sql','20260907_invoice_recipient_initialization.sql','20260907_invoice_initialization_inspection.sql',
   '20260907_imported_invoice_source_guard.sql','20260907_legacy_invoice_creation_guard.sql','20260907_transfer_detail_choices.sql',
   '20260907_manual_billing_plan.sql','20260907_transfer_ownership_manual.sql','20260907_manual_debit_result.sql','20260907_create_manual_debit_plan.sql',
   '20260914_management_lifecycle.sql','20260914_future_schedule.sql','20260909_billing_runtime.sql','20260914_confirm_imported_round.sql',
   '20260924_transfer_selected_next.sql'])await tx.exec(read('drafts/'+f))})
 await db.exec(`create table ageful_migration_target(project_ref text);insert into ageful_migration_target values('ufawaiddntqqbjhycbxn');
  insert into customers(id,name,company_name,is_corporate) values(1,'A',null,false),(2,'B','架空株式会社',true),(3,'未定',null,false);
  select setval(pg_get_serial_sequence('customers','id'),3);
  insert into projects(id,customer_id,project_name) values(1,1,'過去記録の発電所');
  select setval(pg_get_serial_sequence('projects','id'),1);
  insert into contracts(id,project_id,billing_method) values(1,1,'請求書');
  select setval(pg_get_serial_sequence('contracts','id'),1);
  insert into billing_units(project_id,contract_id,occurrence_key,service_year,round_number,recipient_customer_id,original_method,collection_method,lifecycle,issued_on,frozen_amount,frozen_line_items,frozen_at)
   values(1,1,'paid',2025,1,1,'invoice','invoice','issued','2025-01-01',165000,'[{"name":"保守料","amount":165000}]',now());
  insert into billing_recipient_plans(project_id,default_recipient_customer_id,effective_from) values(1,1,'2025-01-01');
  insert into billing_migration_acceptances(project_id,report,actor_user_id) values(1,'{"synthetic":true}','${actor}');
  insert into billing_runtime_control(owner_user_id,enabled,future_schedule_coverage_verified,cutover_on) values('${actor}',true,true,'2026-09-01');`)
 for(const f of ['20261003_billing_cycle_rules.sql','20261010083859_billing_record_removal.sql','20261015031506_customer_company_kana.sql','20261015025017_ownership_workflow.sql'])await db.exec(read('migrations/'+f))
 await db.exec("update customers set company_name_kana='カクウ' where id=2")
 const before={customers:await rows('customers'),bills:await rows('billing_units'),contracts:await rows('contracts'),plans:await rows('billing_recipient_plans')}
 const sql=read('migrations/20261015052352_new_prospect_pending_customer.sql')
 await db.exec("update ageful_migration_target set project_ref='wrong'")
 await assert.rejects(db.exec(sql),/Wrong project/);await db.exec('rollback')
 await db.exec("update ageful_migration_target set project_ref='ufawaiddntqqbjhycbxn'")
 await db.exec(sql)
 const request={action:'create',value:{project_name:'新規・顧客未定',customer_undecided:true,loan_company:'アプラス',equipment:'300000',land_cost:'100000',panel_kw:'50'}}
 const id=key(),created=await write(id,request),createdState=await snap()
 assert.equal(createdState.customers.length,3);assert.equal(createdState.projects.length,2);assert.equal(createdState.contracts.length,2);assert.equal(createdState.prospects.length,1)
 const project=await one('projects',created.projectId),prospect=await one('prospects',created.prospectId)
 assert.equal(project.customer_id,null);assert.equal(project.customer_pending,true);assert.equal(project.previous_owner_customer_id,null);assert.equal(project.owner_unconfirmed_on,null)
 assert.equal(prospect.new_project_id,created.projectId);assert.equal(prospect.customer_name,'顧客未定');assert.equal(prospect.converted_customer_id,null)
 await write(id,request);assert.deepEqual(await snap(),createdState,'retry creates no duplicates')
 await assert.rejects(write(id,{action:'create',value:{project_name:'別'}}),/別の内容/)
 await assert.rejects(write(key(),{action:'create',value:{project_name:'空',existing_customer_id:2}}),/入力項目/)
 await assert.rejects(write(key(),{action:'create',value:{project_name:'指定なし'}}),/入力項目/)
 await assert.rejects(write(key(),{action:'create',value:{project_name:'別名',customer_undecided:true,customer_name:'実名'}}),/入力項目/)
 await assert.rejects(write(key(),{action:'create',value:{project_name:'不正tasks',customer_undecided:true,apply_tasks:[]}}),/形式/)
 await assert.rejects(db.exec(`update projects set customer_id=2,customer_pending=false where id=${project.id}`),/専用/)
 await assert.rejects(db.exec(`update prospects set customer_name='B' where id=${prospect.id}`),/顧客を設定/)
 await assert.rejects(db.exec(`delete from prospects where id=${prospect.id}`),/削除/)
 await db.exec(`update prospects set apply_memo='保留メモ',equipment=400000 where id=${prospect.id}`)
 assert.equal((await one('projects',project.id)).sales_price,300000,'Metadata edit never synchronizes to project/contract')
 const assign=async(customerId=2)=>({action:'assign',value:{project:await one('projects',project.id),prospect:await one('prospects',prospect.id),customerId}})
 await assert.rejects(write(key(),await assign(3)),/実際の顧客/)
 const stale=await assign();await db.exec(`update prospects set apply_memo='更新' where id=${prospect.id}`)
 await assert.rejects(write(key(),stale),/更新されています/)
 const assignment=await assign(),assignKey=key(),beforeAssign=await snap()
 await db.exec(`create function fail_new_audit() returns trigger language plpgsql as $$begin raise exception 'synthetic audit failure';end$$;
 create trigger fail_audit before insert on new_prospect_events for each row execute function fail_new_audit()`)
 await assert.rejects(write(assignKey,assignment),/synthetic audit failure/);assert.deepEqual(await snap(),beforeAssign,'Audit failure rolls back assignment')
 await assert.rejects(write(key(),{action:'create',value:{project_name:'失敗',customer_undecided:true}}),/synthetic audit failure/);assert.deepEqual(await snap(),beforeAssign,'Audit failure rolls back all created records')
 await db.exec('drop trigger fail_audit on new_prospect_events')
 await write(assignKey,assignment);const assigned=await snap();await write(assignKey,assignment);assert.deepEqual(await snap(),assigned)
 assert.equal((await one('projects',project.id)).customer_id,2);assert.equal((await one('projects',project.id)).customer_pending,false)
 assert.equal((await one('prospects',prospect.id)).customer_name,'架空株式会社');assert.equal((await one('prospects',prospect.id)).customer_name_kana,'カクウ')
 assert.equal((await one('prospects',prospect.id)).new_project_id,project.id);assert.equal((await one('prospects',prospect.id)).apply_memo,'更新')
 assert.deepEqual(await rows('customers'),before.customers);assert.deepEqual(await rows('billing_units'),before.bills);assert.deepEqual(await rows('billing_recipient_plans'),before.plans)
 assert.deepEqual((await rows('contracts')).find(c=>c.id===1),before.contracts[0]);assert.equal((await rows('ownership_transfers')).length,0,'First assignment is not an ownership transfer')
 assert.equal((await db.query('select billing_runtime_snapshot() value')).rows[0].value.new_prospect_ready,true)
 assert.equal((await db.query('select billing_runtime_backup() value')).rows[0].value.new_prospect_events.length,2)
 assert.equal((await db.query('select billing_runtime_has_transfer(2) value')).rows[0].value,true,'Assigned new-style customer is excluded from legacy two-way sync')
 assert.equal((await db.query('select billing_runtime_has_transfer(1) value')).rows[0].value,false,'Unrelated customer legacy sync remains unchanged')
 // Exact three-row operator-approved repair; no real DB or real contact details.
 await db.exec(`insert into customers(id,name) values(282,'未定'),(286,'未定'),(307,'未定');
  insert into projects(id,customer_id,project_name,plant_name) values(90,282,'東広島市黒瀬（上地）','東広島市黒瀬（上地）'),(95,286,'三次市高杉（佐脇）','三次市高杉（佐脇）'),(125,307,'出水（フィネスコ）','出水（フィネスコ）');
  insert into contracts(id,project_id) values(80,90),(75,95),(100,125),(101,125);
  insert into prospects(id,customer_name,project_name,converted_customer_id,updated_at,apply_memo,apply_tasks) values
  (25,'未定','東広島市黒瀬（上地）',282,'2026-07-11T07:46:06.253271Z','維持1','{"申込":true}'),
  (27,'未定','三次市高杉（佐脇）',286,'2026-07-11T07:44:38.037707Z','維持2','{"申込":false}'),
  (52,'未定','出水（フィネスコ）',307,'2026-09-08T04:00:13.301509Z','維持3','{"申込":true}');`)
 const classify=read('drafts/20261015_classify_three_legacy_undecided.sql'),preClassify=await snap()
 await db.exec('create trigger fail_audit before insert on new_prospect_events for each row execute function fail_new_audit()')
 await assert.rejects(db.exec(classify),/synthetic audit failure/);await db.exec('rollback')
 assert.deepEqual(await snap(),preClassify,'Classification audit failure rolls back all three records')
 await db.exec('drop trigger fail_audit on new_prospect_events')
 await db.exec(classify);const classified=await snap();await db.exec(classify);assert.deepEqual(await snap(),classified,'Repair replay is a no-op')
 for(const [pid,prid] of [[90,25],[95,27]]){
  assert.equal((await one('projects',pid)).customer_pending,true);assert.equal((await one('projects',pid)).customer_id,null)
  assert.equal((await one('prospects',prid)).new_project_id,pid);assert.equal((await one('prospects',prid)).converted_customer_id,null)
 }
 assert.equal((await one('projects',125)).customer_id,307,'Unknown former identity/date are not invented')
 assert.equal((await one('prospects',52)).ownership_project_id,125);assert.equal((await one('prospects',52)).candidate_customer_id,null)
 assert.equal((await one('prospects',27)).apply_memo,'維持2');assert.deepEqual((await one('prospects',27)).apply_tasks,{'申込':false})
 for(const t of ['customers','contracts','billing_units','annual_records','billing_recipient_plans','ownership_transfers'])assert.deepEqual(classified[t],preClassify[t],`${t} is protected during repair`)
 assert.equal(classified.contracts.filter(c=>c.project_id===125).length,2,'Duplicate contracts are deliberately not merged')
 // Relink only: existing 出水, not the separately registered placeholder listing.
 await db.exec(`insert into customers(id,name,company_name,is_corporate) values(306,'架空担当者','フィネスコ㈱',true);
  insert into projects(id,customer_id,project_name,plant_name) values(124,306,'出水','出水');
  insert into contracts(id,project_id) values(98,124),(99,124);
  insert into billing_units(project_id,contract_id,occurrence_key,service_year,round_number,recipient_customer_id,original_method,collection_method,lifecycle,issued_on,frozen_amount,frozen_line_items,frozen_at)
   values(124,98,'existing-izumi-invoice',2025,1,306,'invoice','invoice','issued','2025-12-01',82500,'[{"name":"保守料","amount":82500}]',now());`)
 const relink=read('drafts/20261015_relink_izumi_prospect.sql')
 const updateCandidate=async id=>db.transaction(async tx=>{
  await tx.exec("set local ageful.ownership_workflow_write='yes'")
  await tx.query('update prospects set candidate_customer_id=$1 where id=52',[id])
 })
 await updateCandidate(2)
 const candidateState=await snap()
 await assert.rejects(db.exec(relink),/見込みが変更/);await db.exec('rollback')
 assert.deepEqual(await snap(),candidateState,'A changed candidate blocks relink without side effects')
 await updateCandidate(null)
 await db.transaction(async tx=>{
  await tx.exec("set local ageful.ownership_workflow_write='yes'")
  await tx.exec(`insert into prospects(id,customer_name,project_name,ownership_project_id,ownership_state)
   values(8888,'引継ぎ先未定','出水',124,'open')`)
 })
 const duplicateState=await snap()
 await assert.rejects(db.exec(relink),/既にあります/);await db.exec('rollback')
 assert.deepEqual(await snap(),duplicateState,'Existing target undecided workflow blocks relink')
 await db.transaction(async tx=>{await tx.exec("set local ageful.ownership_workflow_write='yes'");await tx.exec('delete from prospects where id=8888')})
 const beforeRelink=await snap()
 await db.exec('create trigger fail_audit before insert on new_prospect_events for each row execute function fail_new_audit()')
 await assert.rejects(db.exec(relink),/synthetic audit failure/);await db.exec('rollback')
 assert.deepEqual(await snap(),beforeRelink,'Relink audit failure rolls back prospect identity and all protected records')
 await db.exec('drop trigger fail_audit on new_prospect_events')
 await db.exec(relink);const afterRelink=await snap()
 await db.exec(relink);assert.deepEqual(await snap(),afterRelink,'Relink replay creates no second audit or changes')
 const corrected=await one('prospects',52),before52=beforeRelink.prospects.find(p=>p.id===52)
 assert.equal(corrected.ownership_project_id,124);assert.equal(corrected.project_name,'出水')
 const stripRelink=({ownership_project_id,project_name,updated_at,...rest})=>rest
 assert.deepEqual(stripRelink(corrected),stripRelink(before52),'All memo/task/finance/status metadata is preserved')
 assert.deepEqual(afterRelink.prospects.filter(p=>p.id!==52),beforeRelink.prospects.filter(p=>p.id!==52),'Other prospects unchanged')
 for(const t of ['customers','projects','contracts','billing_units','annual_records','billing_recipient_plans','ownership_transfers'])assert.deepEqual(afterRelink[t],beforeRelink[t],`${t} is unchanged by relink`)
 const relinkAudit=afterRelink.new_prospect_events.find(e=>e.operation_key==='24102410-1515-4515-8515-000000000052')
 assert.equal(afterRelink.new_prospect_events.length,beforeRelink.new_prospect_events.length+1)
 assert.equal(relinkAudit.project_id,124);assert.equal(relinkAudit.prospect_id,52)
 assert.equal(relinkAudit.before_snapshot.from_project.id,125);assert.equal(relinkAudit.before_snapshot.to_project.id,124)
 assert.equal(relinkAudit.before_snapshot.prospect.ownership_project_id,125);assert.equal(relinkAudit.after_snapshot.prospect.ownership_project_id,124)
 assert.deepEqual(afterRelink.new_prospect_events.filter(e=>e!==relinkAudit),beforeRelink.new_prospect_events,'Previous classification audit retained unchanged')
 assert.deepEqual(relinkAudit.before_snapshot.from_project,relinkAudit.after_snapshot.from_project)
 assert.deepEqual(relinkAudit.before_snapshot.to_project,relinkAudit.after_snapshot.to_project)
 // Additive archive layer keeps all physical evidence but removes unused
 // duplicates from operational contract selection and blocks fresh duplicates.
 await db.exec("update contracts set maintenance_contractor='HUGエナジー' where id=100")
 await db.exec("insert into projects(id,customer_id,project_name) values(123,1,'今回対象外の既存案件');insert into contracts(id,project_id) values(96,123),(97,123)")
 await db.exec(read('migrations/20261015063227_archive_unused_duplicates.sql'))
 await assert.rejects(db.exec('insert into contracts(project_id) values(124)'),/登録済み/)
 await assert.rejects(db.exec("update contracts set archived_at=now(),archive_reason='重複',canonical_contract_id=98 where id=99"),/専用/)
 const archiveSql=read('drafts/20261015_archive_izumi_duplicates.sql'),preArchive=await snap()
 await db.exec('create trigger fail_archive before insert on duplicate_archive_events for each row execute function fail_new_audit()')
 await assert.rejects(db.exec(archiveSql),/synthetic audit failure/);await db.exec('rollback')
 assert.deepEqual(await snap(),preArchive,'Archive audit failure rolls back HUG copy and every archive flag')
 await db.exec('drop trigger fail_archive on duplicate_archive_events')
 await db.exec(archiveSql);const afterArchive=await snap(),archiveAudit=await rows('duplicate_archive_events')
 assert.equal((await db.query('select count(*) n from active_contracts where project_id=123')).rows[0].n,2,'Unapproved duplicate contracts elsewhere are not silently archived')
 await assert.rejects(db.exec('insert into contracts(project_id) values(123)'),/登録済み/)
 await db.exec(archiveSql);assert.deepEqual(await snap(),afterArchive);assert.deepEqual(await rows('duplicate_archive_events'),archiveAudit)
 assert.equal(archiveAudit.length,1);assert.equal((await one('contracts',98)).maintenance_contractor,'HUGエナジー')
 assert.equal((await one('contracts',100)).maintenance_contractor,'HUGエナジー','The original HUG field is retained in archived source')
 assert.equal((await db.query('select count(*) n from contracts where project_id=124')).rows[0].n,2)
 assert.equal((await db.query('select count(*) n from active_contracts where project_id=124')).rows[0].n,1)
 assert.equal((await db.query('select count(*) n from contracts where project_id=125')).rows[0].n,2)
 assert.equal((await db.query('select count(*) n from active_contracts where project_id=125')).rows[0].n,0)
 await assert.rejects(db.exec("update contracts set notes='保管後編集' where id=100"),/保管済み/)
 await assert.rejects(db.exec("update projects set notes='保管後編集' where id=125"),/保管済み/)
 await assert.rejects(db.exec('insert into contracts(project_id) values(125)'),/保管済み/)
 await assert.rejects(db.exec("insert into maintenance_responses(project_id) values(125)"),/保管済み/)
 const archiveWorkflow={action:'ownership_workflow',value:{action:'start',value:{projectId:125,project:await one('projects',125),customerId:null,reason:'保管後の登録テスト'}}}
 await assert.rejects(db.query('select billing_runtime_write($1,$2::jsonb)',[key(),JSON.stringify(archiveWorkflow)]),/保管済み/)
 await assert.rejects(db.transaction(async tx=>{await tx.exec("set local ageful.archive_unused_write='yes'");await tx.exec("update contracts set archived_at=now(),archive_reason='請求あり',canonical_contract_id=80 where id=98")}),/請求記録/)
 const patches=(await db.query('select * from archive_function_patches')).rows
 assert.ok(patches.some(p=>p.signature.includes('transfer_ownership_manual(')))
 for(const p of patches.filter(p=>!p.signature.includes('prepare_transfer_detail_choices('))){assert.ok(p.after_definition.includes('public.active_contracts'));assert.ok(!p.after_definition.match(/(?:FROM|JOIN|UPDATE)\s+public\.contracts\s/i))}
 await assert.rejects(db.query('select prepare_transfer_detail_choices($1,$2,$3)',[JSON.stringify(await one('projects',124)),JSON.stringify(await one('contracts',98)),JSON.stringify({contract:{archived_at:{mode:'keep'}}})]),/選択できない/)
 assert.equal((await db.query('select billing_runtime_snapshot() value')).rows[0].value.duplicate_archive_ready,true)
 const archivedBackup=(await db.query('select billing_runtime_backup() value')).rows[0].value
 assert.equal(archivedBackup.contracts.filter(c=>c.project_id===125).length,2)
 assert.equal(archivedBackup.projects.find(p=>p.id===125).canonical_project_id,124)
 assert.deepEqual(await rows('billing_units'),afterRelink.billing_units,'Archive never changes actual invoices')
 const workflowWrite=async(action,value)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');return tx.query('select billing_runtime_write($1,$2::jsonb)',[key(),JSON.stringify({action:'ownership_workflow',value:{action,value}})])})
 await workflowWrite('candidate',{projectId:124,project:await one('projects',124),prospectId:52,prospect:await one('prospects',52),customerId:2,reason:'実行経路の合成確認'})
 const archived99=await one('contracts',99),archived100=await one('contracts',100),archived101=await one('contracts',101)
 const transferProject=await one('projects',124),transferContract=await one('contracts',98)
 await workflowWrite('complete',{projectId:124,project:transferProject,prospectId:52,prospect:await one('prospects',52),reason:'重複を保管した後の引継ぎテスト',
  transfer:{project:transferProject,contract:transferContract,newOwner:2,futureRecipient:2,date:'2026-01-01',fields:{contract:{}},choices:[],reason:'合成確認',procedureConfirmed:true}})
 assert.equal((await one('projects',124)).customer_id,2,'Real workflow/transfer RPC succeeds with one active and one archived contract')
 assert.deepEqual(await one('contracts',99),archived99);assert.deepEqual(await one('contracts',100),archived100);assert.deepEqual(await one('contracts',101),archived101)
 assert.deepEqual(await rows('billing_units'),afterRelink.billing_units,'Real transfer still preserves previous customer invoice exactly')
 // Ownership/workflow explanations are amended in a separate append-only log.
 // Original transfer and workflow rows, including their reason/snapshots, never change.
 const historyProtectedTables=(await db.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(r=>r.tablename)
 const historyProtected=async()=>Object.fromEntries(await Promise.all(historyProtectedTables.map(async t=>[t,await rows(t)])))
 const originalHistoryProtected=await historyProtected(),historySql=read('migrations/20261017012032_ownership_history_notes.sql')
 await db.exec("update ageful_migration_target set project_ref='wrong'");await assert.rejects(db.exec(historySql),/Wrong project/);await db.exec('rollback')
 await db.exec("update ageful_migration_target set project_ref='ufawaiddntqqbjhycbxn'")
 await db.exec(historySql);assert.deepEqual(await historyProtected(),originalHistoryProtected,'History-note schema changes no existing business/audit row')
 const historyWrite=(operationKey,value)=>db.transaction(async tx=>{await tx.exec('set local role authenticated');return (await tx.query('select billing_runtime_write($1,$2::jsonb) value',[operationKey,JSON.stringify({action:'history_note',value})])).rows[0].value})
 const transferHistory=(await rows('ownership_transfers')).find(t=>t.project_id===124)
 const workflowHistory=(await rows('ownership_workflow_events')).find(t=>t.project_id===124&&t.action==='complete')
 const ownershipNote={projectId:124,kind:'ownership',targetId:String(transferHistory.id),expectedRevision:0,text:'  正しい引継ぎの説明\n補足  '}
 const historyKey=key(),historyResult=await historyWrite(historyKey,ownershipNote)
 assert.equal(historyResult.revision,1)
 let historyNotes=await rows('ownership_history_notes'),note=historyNotes.find(n=>n.operation_key===historyKey)
 assert.equal(note.text,'正しい引継ぎの説明\n補足');assert.equal(note.original_text,transferHistory.field_decisions.reason)
 assert.equal(note.previous_text,transferHistory.field_decisions.reason);assert.equal(note.actor_user_id,actor)
 await historyWrite(historyKey,ownershipNote);assert.deepEqual(await rows('ownership_history_notes'),historyNotes,'Exact note retry creates no extra revision')
 await assert.rejects(historyWrite(historyKey,{...ownershipNote,text:'同じキーで別の文'}),/別の内容/)
 await assert.rejects(historyWrite(transferHistory.operation_key,ownershipNote),/別の処理/)
 await assert.rejects(historyWrite(workflowHistory.operation_key,ownershipNote),/別の処理/)
 await assert.rejects(db.query('select billing_runtime_write($1,$2::jsonb)',[historyKey,JSON.stringify({action:'invoice',value:{}})]),/メモに使われています/)
 await assert.rejects(historyWrite(key(),{...ownershipNote,text:'古い画面の文'}),/更新されています/)
 const secondNote={...ownershipNote,expectedRevision:1,text:'二回目の訂正文'}
 await historyWrite(key(),secondNote);historyNotes=await rows('ownership_history_notes')
 note=historyNotes.find(n=>n.kind==='ownership'&&n.revision===2)
 assert.equal(note.previous_text,'正しい引継ぎの説明\n補足');assert.equal(note.original_text,transferHistory.field_decisions.reason)
 const workflowNote={projectId:124,kind:'workflow',targetId:workflowHistory.operation_key,expectedRevision:0,text:'手続き完了の補足を訂正'}
 await historyWrite(key(),workflowNote)
 note=(await rows('ownership_history_notes')).find(n=>n.kind==='workflow')
 assert.equal(note.original_text,workflowHistory.reason);assert.equal(note.previous_text,workflowHistory.reason);assert.equal(note.revision,1)
 const savedNotes=await rows('ownership_history_notes')
 for(const value of [
  {...ownershipNote,expectedRevision:2,text:''},{...ownershipNote,expectedRevision:2,text:'\n\t　 '},
  {...ownershipNote,expectedRevision:2,text:'a'.repeat(4001)},
  {...ownershipNote,expectedRevision:2,text:'二回目の訂正文'},
  {...ownershipNote,projectId:1,expectedRevision:0,text:'別案件の履歴'},
  {...ownershipNote,projectId:125,expectedRevision:0,text:'保管済み案件'},
  {...ownershipNote,projectId:999999,expectedRevision:0,text:'存在しない発電所'},
  {...ownershipNote,extra:'不正な追加キー'}, {...ownershipNote,kind:'invoice'},
  {...ownershipNote,targetId:transferHistory.id}, {...ownershipNote,expectedRevision:-1},
  {...workflowNote,targetId:'not-a-uuid'}, {...workflowNote,targetId:'11111111-1111-4111-8111-111111111111'},
 ])await assert.rejects(historyWrite(key(),value),/メモ|履歴|発電所|変更されていません/)
 assert.deepEqual(await rows('ownership_history_notes'),savedNotes,'Rejected notes leave the whole note log unchanged')
 await db.exec('create trigger fail_history_note before insert on ownership_history_notes for each row execute function fail_new_audit()')
 await assert.rejects(historyWrite(key(),{...ownershipNote,expectedRevision:2,text:'失敗する更新'}),/synthetic audit failure/)
 assert.deepEqual(await rows('ownership_history_notes'),savedNotes,'Failed note save consumes neither revision nor receipt')
 await db.exec('drop trigger fail_history_note on ownership_history_notes')
 await assert.rejects(db.exec("update ownership_history_notes set text='原本を上書き'"),/audit|immutable|変更|追記/i)
 await assert.rejects(db.exec('delete from ownership_history_notes'),/audit|immutable|削除|追記/i)
 await assert.rejects(db.exec('truncate ownership_history_notes'),/audit|immutable|削除|追記/i)
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.exec('select * from ownership_history_notes')}),/permission denied/)
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("insert into ownership_history_notes(operation_key,project_id,kind,target_id,revision,original_text,previous_text,text,request_hash,actor_user_id) values($1,124,'ownership',$2,3,'','','不正直接書込','x',$3)",[key(),String(transferHistory.id),actor])}),/permission denied/)
 await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query('select write_ownership_history_note($1,$2)',[key(),JSON.stringify({...ownershipNote,expectedRevision:2,text:'private helper'})])}),/permission denied/)
 const historySnapshot=(await db.query('select billing_runtime_snapshot() value')).rows[0].value
 const historyBackup=(await db.query('select billing_runtime_backup() value')).rows[0].value
 assert.equal(historySnapshot.history_notes_ready,true);assert.equal(historyBackup.history_notes_ready,true)
 assert.deepEqual(historySnapshot.history_notes,historyBackup.history_notes);assert.equal(historySnapshot.history_notes.length,3)
 assert.deepEqual(await historyProtected(),originalHistoryProtected,'All original parents, transfers, workflow events, bills and audit logs remain exactly unchanged')
 const beforeHostedNotes=await rows('ownership_history_notes')
 await db.exec(read('drafts/20261017_verify_ownership_history_notes_rollback.sql'))
 assert.deepEqual(await rows('ownership_history_notes'),beforeHostedNotes,'The exact hosted smoke script rolls back every test note')
 assert.deepEqual(await historyProtected(),originalHistoryProtected,'Rollback smoke preserves every original table')
 await db.exec("set test.actor='22222222-2222-4222-8222-222222222222'");await assert.rejects(write(key(),request),/権限|利用/)
 await assert.rejects(historyWrite(historyKey,ownershipNote),/権限|利用/)
 await db.exec("set test.actor='';set role anon");await assert.rejects(db.query('select new_prospect_write($1,$2)',[key(),JSON.stringify(request)]),/permission denied/)
 await assert.rejects(db.query('select billing_runtime_write($1,$2)',[key(),JSON.stringify({action:'history_note',value:ownershipNote})]),/permission denied/)
 await db.exec('reset role')
 console.log('PASS: pending prospect/archive flows plus append-only ownership/workflow note revisions, same-key retry, stale/schema/text/target/archive rejection, owner/RLS/private-helper protection, rollback, snapshot/backup, every original business/audit row unchanged.')
}finally{await db.close()}
