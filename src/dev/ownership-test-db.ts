import { PGlite } from '@electric-sql/pglite'
import foundation from '../../database/drafts/20260907_billing_ownership_foundation.sql?raw'
import invoice from '../../database/drafts/20260907_invoice_write_rpc.sql?raw'
import recipients from '../../database/drafts/20260907_invoice_recipient_plan_rpc.sql?raw'
import fields from '../../database/drafts/20260907_transfer_detail_choices.sql?raw'
import schedule from '../../database/drafts/20260907_invoice_schedule_rpc.sql?raw'
import transfer from '../../database/drafts/20260907_transfer_ownership_inherit_rpc.sql?raw'

/** In-memory synthetic fixtures only. Never import the application Supabase client. */
export async function createOwnershipTestDb() {
  const db=new PGlite()
  try {
    await db.exec(`create table customers(id bigint primary key,name text);
      create table projects(id bigint primary key,customer_id bigint references customers(id),old_owner text);
      create table contracts(id bigint primary key,project_id bigint references projects(id),billing_method text,
        billing_count integer,billing_schedule_days jsonb,billing_amount_overrides jsonb,annual_maintenance_inc bigint,
        billing_item_flags jsonb,has_issuance_fee boolean,issuance_fee_inc bigint,notes text,ownership_transfer_date date);
      create table annual_records(id bigint primary key,contract_id bigint references contracts(id));
      create schema auth;
      create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
      insert into customers values(1,'顧客A'),(2,'顧客B');
      insert into projects values(1,1,null);
      insert into contracts values(1,1,'請求書',2,'["6月1日","12月1日"]',null,165000,null,false,null,'引き継ぐ契約備考',null);`)
    await db.transaction(async tx=>{
      await tx.exec("set local ageful.allow_draft_migration='yes'")
      for (const sql of [foundation,invoice,recipients,fields,schedule,transfer]) await tx.exec(sql)
      await tx.exec(`insert into billing_recipient_plans(project_id,default_recipient_customer_id,effective_from)
          values(1,1,make_date(extract(year from current_date)::int+1,1,1));
        insert into billing_units(project_id,contract_id,recipient_plan_id,recipient_customer_id,recipient_source,occurrence_key,
          service_year,round_number,scheduled_date,original_method,collection_method)
        select 1,1,1,1,'default','demo-next-'||n,(extract(year from current_date)::int+1),n,
          make_date(extract(year from current_date)::int+1,case n when 1 then 6 else 12 end,1),'invoice','invoice'
          from generate_series(1,2) n;
        insert into billing_units(project_id,contract_id,recipient_customer_id,recipient_source,occurrence_key,service_year,round_number,
          original_method,collection_method,lifecycle,issued_on,received_on,collection_state,frozen_amount,frozen_line_items,frozen_at,amount_basis)
        values(1,1,1,'confirmed','demo-paid',extract(year from current_date)::int-1,1,'invoice','invoice','received',
          make_date(extract(year from current_date)::int-1,6,1),make_date(extract(year from current_date)::int-1,6,10),
          'succeeded',82500,'[{"name":"保守料","amount":82500}]',now(),'operator_confirmed');`)
    })
    return db
  } catch(error) {await db.close();throw error}
}
