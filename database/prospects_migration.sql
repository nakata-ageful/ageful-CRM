-- ── 見込み管理テーブル ────────────────────────────────────────
-- Supabase (PostgreSQL) migration
-- Run this in the Supabase SQL editor to enable 見込み管理

create table if not exists prospects (
  id                  bigserial primary key,
  customer_name       text        not null,
  project_name        text        not null,
  loan_company        text,                           -- アプラス / ジャックス
  equipment           numeric,                        -- 設備費（円）
  land_cost           numeric,                        -- 土地費（円）
  loan_amount         numeric,                        -- 融資額（円）
  apply_status        text        not null default '未'
                        check (apply_status in ('未','提出済','通過','不通','不可')),
  contract_status     text        not null default '未'
                        check (contract_status in ('未','完了','不可')),
  apply_tasks         jsonb       not null default '{}',
  contract_tasks      jsonb       not null default '{}',
  apply_sub_tasks     jsonb       not null default '{}',
  contract_sub_tasks  jsonb       not null default '{}',
  apply_memo          text,
  contract_memo       text,
  site_address        text,
  panel_kw            numeric,
  referrer            text,
  lead_date           date,
  apply_submit_date   date,
  apply_result_date   date,
  sale_contract_date  date,
  land_contract_date  date,
  handover_date       date,
  converted_customer_id bigint references customers(id) on delete set null,
  converted_at        timestamptz,
  created_at          timestamptz not null default now()
);

-- インデックス
create index if not exists prospects_apply_status_idx    on prospects (apply_status);
create index if not exists prospects_contract_status_idx on prospects (contract_status);
create index if not exists prospects_converted_idx       on prospects (converted_customer_id) where converted_customer_id is not null;

-- RLS（Row Level Security）— 既存テーブルに合わせて有効化
alter table prospects enable row level security;

-- 認証済みユーザーに全操作を許可（既存ポリシーに合わせて調整してください）
create policy "allow all for authenticated" on prospects
  for all
  to authenticated
  using (true)
  with check (true);
