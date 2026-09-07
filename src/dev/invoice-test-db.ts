import { PGlite } from '@electric-sql/pglite'
import foundation from '../../database/drafts/20260907_billing_ownership_foundation.sql?raw'
import rpc from '../../database/drafts/20260907_invoice_write_rpc.sql?raw'
import debit from '../../database/drafts/20260907_manual_debit_result.sql?raw'

/** Browser-only, in-memory synthetic database. Never reads Supabase settings. */
export async function createInvoiceTestDb() {
  const db = new PGlite()
  try {
    await db.exec(`create table customers(id bigint primary key);
      create table projects(id bigint primary key);
      create table contracts(id bigint primary key, project_id bigint references projects(id));
      create table annual_records(id bigint primary key);
      create schema auth;
      create function auth.uid() returns uuid language sql as $$select '11111111-1111-4111-8111-111111111111'::uuid$$;
      insert into customers values (1),(2);
      insert into projects values (1);
      insert into contracts values (1,1);`)
    await db.transaction(async tx => {
      await tx.exec("set local ageful.allow_draft_migration='yes'")
      await tx.exec(foundation)
      await tx.exec(rpc)
      await tx.exec(debit)
      await tx.exec(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,service_month,original_method,collection_method,recipient_customer_id,recipient_source,scheduled_date,planned_amount)
        values(1,1,'demo-debit-2026-11',2026,11,'direct_debit','direct_debit',1,'confirmed','2026-11-27',82500);`)
      await tx.exec(`insert into billing_units(project_id,contract_id,occurrence_key,service_year,round_number,
        original_method,collection_method,recipient_customer_id,recipient_source,scheduled_date)
        values (1,1,'demo-2026-1',2026,1,'invoice','invoice',1,'confirmed','2026-12-01'),
          (1,1,'demo-2027-1',2027,1,'invoice','invoice',2,'confirmed','2027-06-01');`)
    })
    return db
  } catch (error) { await db.close(); throw error }
}
