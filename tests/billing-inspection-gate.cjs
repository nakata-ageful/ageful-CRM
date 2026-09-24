// Local PGlite only. No network, credentials, or Supabase writes.
const assert=require('node:assert/strict')
const fs=require('node:fs')
const path=require('node:path')
const sql=fs.readFileSync(path.join(__dirname,'../database/drafts/20260924_read_only_billing_inspection.sql'),'utf8')
const owner='9a4b877c-d73d-4c37-a902-40c521240d06'

async function main(){
  const {PGlite}=await import('@electric-sql/pglite')
  const db=new PGlite()
  try{
    await db.exec(`
      create role authenticated; create role anon; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('test.actor',true),'')::uuid $$;
      grant usage on schema auth,public to authenticated,anon;
      create table ageful_migration_target(project_ref text);
      create table billing_runtime_control(enabled boolean);
      create table billing_migration_acceptances(project_id bigint);
      create table customers(id bigint primary key,name text,company_name text);
      create table projects(id bigint primary key,customer_id bigint,project_name text);
      create table contracts(
        id bigint primary key,project_id bigint,billing_method text,billing_count integer,
        billing_schedule_days jsonb,billing_item_flags jsonb,billing_amount_overrides jsonb,
        annual_maintenance_inc bigint,land_cost_monthly bigint,insurance_fee bigint,
        local_association_fee bigint,communication_fee bigint,other_fee bigint,
        has_issuance_fee boolean,issuance_fee_inc bigint,has_transfer_fee boolean,
        transfer_fee_inc bigint,maintenance_start_date date);
      create table annual_records(id bigint primary key,contract_id bigint,year integer,
        billing_scheduled_date date,billing_date date,received_date date,transfer_failed boolean,payments jsonb);
      create table billing_units(id bigint primary key,project_id bigint,recipient_customer_id bigint,lifecycle text);
      create table project_management_events(id bigint primary key);
      insert into ageful_migration_target values('ufawaiddntqqbjhycbxn');
      insert into customers values(1,'確認者A',null);
      insert into projects values(1,1,'検証発電所');
      insert into billing_migration_acceptances values(1);
      insert into contracts(id,project_id,billing_method,billing_count,billing_schedule_days,annual_maintenance_inc)
        values(1,1,'請求書',1,'["6月15日"]',165000);
      insert into billing_units values(1,1,1,'received');
    `)
    await assert.rejects(db.exec(sql),/Inspection draft blocked/)
    await db.transaction(async tx=>{
      await tx.exec("set local ageful.allow_inspection_draft='yes'")
      await tx.exec(sql)
    })
    const read=async()=> (await db.query('select public.billing_runtime_inspection_snapshot() as value')).rows[0].value
    await assert.rejects(read(),/Inspection is not authorized/)
    await db.exec("set test.actor='11111111-1111-4111-8111-111111111111'")
    await assert.rejects(read(),/Inspection is not authorized/)
    await db.exec(`set test.actor='${owner}'`)
    await db.exec('set role anon')
    await assert.rejects(read(),/permission denied/i)
    await db.exec('reset role')
    await db.exec('set role authenticated')
    const allowed=await read()
    await db.exec('reset role')
    assert.equal(allowed.version,1)
    assert.equal(allowed.mode,'read_only_inspection')
    assert.equal(allowed.future_schedule_coverage_verified,false)
    assert.equal(allowed.customers.length,1)
    assert.equal(allowed.projects.length,1)
    assert.equal(allowed.units.length,1)
    assert.equal(allowed.projects[0].project_name,'検証発電所')
    assert.equal((await db.query('select count(*)::int as n from billing_runtime_control')).rows[0].n,0)
    await db.exec('insert into billing_runtime_control values(true)')
    await assert.rejects(read(),/Inspection preconditions changed/)
    await db.exec('delete from billing_runtime_control;update ageful_migration_target set project_ref=\'wrong\'')
    await assert.rejects(read(),/Inspection preconditions changed/)
    console.log('read-only inspection gate: owner only, false coverage, no activation, target guard OK')
  }finally{await db.close()}
}
main().catch(error=>{console.error(error);process.exitCode=1})
