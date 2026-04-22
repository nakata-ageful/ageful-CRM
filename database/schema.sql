-- ============================================================
-- Ageful Manager — Supabase Schema（現行アプリコード対応版）
-- ============================================================
-- 実行順序: このファイルを Supabase SQL エディタに貼り付けて実行
-- ============================================================

-- ── 1. customers ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT        NOT NULL,          -- 個人名
  company_name  TEXT,                          -- 法人名
  is_corporate  BOOLEAN     NOT NULL DEFAULT false,
  email         TEXT,
  phone         TEXT,
  postal_code   TEXT,
  address       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. projects ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id                       BIGSERIAL PRIMARY KEY,
  customer_id              BIGINT      NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  project_no               TEXT,                -- 管理番号
  project_name             TEXT        NOT NULL,
  plant_name               TEXT,                -- 発電所名
  -- 発電所住所
  site_postal_code         TEXT,
  site_prefecture          TEXT,
  site_address             TEXT,
  latitude                 NUMERIC(10,7),
  longitude                NUMERIC(10,7),
  -- パネル情報
  panel_kw                 NUMERIC(10,2),
  panel_count              INTEGER,
  panel_maker              TEXT,
  panel_model              TEXT,
  -- PCS情報
  pcs_kw                   NUMERIC(10,2),
  pcs_count                INTEGER,
  pcs_maker                TEXT,
  pcs_model                TEXT,
  -- 経産・FIT
  grid_id                  TEXT,
  grid_certified_at        DATE,
  fit_period               INTEGER,
  power_supply_start_date  DATE,
  customer_number          TEXT,
  generation_point_id      TEXT,
  meter_reading_day        TEXT,
  -- 監視情報
  monitoring_system        TEXT,
  monitoring_id            TEXT,
  monitoring_user          TEXT,
  monitoring_pw            TEXT,
  has_4g                   BOOLEAN,
  -- その他
  key_number               TEXT,
  local_association        TEXT,
  old_owner                TEXT,
  sales_company            TEXT,
  referrer                 TEXT,
  power_change_date        DATE,
  handover_date            DATE,
  sales_price              INTEGER,
  reference_price          INTEGER,
  land_cost                INTEGER,
  amuras_member_no         TEXT,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. contracts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contracts (
  id                        BIGSERIAL PRIMARY KEY,
  project_id                BIGINT      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 請求
  billing_method            TEXT,                -- 請求書 / 口座振替
  billing_due_day           TEXT,                -- 例: "12月1日"
  billing_amount_ex         INTEGER,
  billing_amount_inc        INTEGER,
  annual_maintenance_ex     INTEGER,
  annual_maintenance_inc    INTEGER,
  land_cost_monthly         INTEGER,
  insurance_fee             INTEGER,
  other_fee                 INTEGER,
  transfer_fee              INTEGER,
  transfer_account          INTEGER,
  -- 契約日
  sale_contract_date        DATE,
  equipment_contract_date   DATE,
  land_contract_date        DATE,
  maintenance_contract_date DATE,
  -- 販売経路
  sales_to_neosys           TEXT,
  neosys_to_referrer        TEXT,
  contractor_name           TEXT,
  -- 請求回数（年間保守料÷請求金額で暗黙決定、手動上書き可）
  billing_count             INTEGER DEFAULT 1,
  -- 保守委託
  subcontractor             TEXT,
  subcontract_fee_ex        INTEGER,
  subcontract_fee_inc       INTEGER,
  subcontract_billing_day   TEXT,
  subcontract_start_date    DATE,
  maintenance_start_date    DATE,
  -- 保守プラン
  plan_inspection           TEXT CHECK (plan_inspection IN ('なし','年1回')),
  plan_weeding              TEXT CHECK (plan_weeding IN ('なし','年1回','年2回','年3回')),
  plan_emergency            TEXT CHECK (plan_emergency IN ('なし','年1回','無制限')),
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. annual_records ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS annual_records (
  id                     BIGSERIAL PRIMARY KEY,
  contract_id            BIGINT      NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  year                   INTEGER     NOT NULL,
  billing_scheduled_date DATE,                 -- 請求予定日
  billing_date           DATE,                 -- 請求日
  payment_due_date       DATE,                 -- 入金予定日
  received_date          DATE,                 -- 入金日
  line_items             JSONB,                -- 請求明細 [{name, amount}]
  payments               JSONB,                -- 分割入金 [{seq, scheduled_date, received_date}]
  maintenance_record     TEXT,
  escort_record          TEXT,
  transfer_failed        BOOLEAN,               -- 振替不能フラグ（口座振替のみ）
  status                 TEXT NOT NULL DEFAULT ''
                           CHECK (status IN ('', '請求済', '入金済')),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (contract_id, year)
);

-- ── 5. maintenance_responses ─────────────────────────────────
CREATE TABLE IF NOT EXISTS maintenance_responses (
  id               BIGSERIAL PRIMARY KEY,
  project_id       BIGINT      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  response_no      TEXT,                       -- 管理番号 例: "25001"
  status           TEXT NOT NULL DEFAULT '対応中'
                     CHECK (status IN ('対応中', '完了')),
  inquiry_date     DATE,                       -- 問合日
  occurrence_date  DATE,                       -- 発生日
  target_area      TEXT,                       -- 対象箇所
  situation        TEXT,                       -- 状況
  response_content TEXT,                       -- 対応
  report           TEXT,                       -- 報告
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. periodic_maintenance ──────────────────────────────────
CREATE TABLE IF NOT EXISTS periodic_maintenance (
  id          BIGSERIAL PRIMARY KEY,
  project_id  BIGINT      NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  record_date DATE        NOT NULL,
  work_type   TEXT,                            -- 点検 / 除草 / 巡回 / その他
  content     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 7. attachments ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS attachments (
  id           BIGSERIAL PRIMARY KEY,
  customer_id  BIGINT      NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  file_name    TEXT        NOT NULL,
  file_url     TEXT        NOT NULL,
  file_type    TEXT        NOT NULL,           -- pdf / image / other
  description  TEXT,
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 8. prospects ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prospects (
  id                    BIGSERIAL PRIMARY KEY,
  customer_name         TEXT        NOT NULL,
  project_name          TEXT        NOT NULL,
  loan_company          TEXT,
  equipment             NUMERIC,
  land_cost             NUMERIC,
  loan_amount           NUMERIC,
  apply_status          TEXT NOT NULL DEFAULT '未'
                          CHECK (apply_status IN ('未','提出済','通過','不通','不可')),
  contract_status       TEXT NOT NULL DEFAULT '未'
                          CHECK (contract_status IN ('未','完了','不可')),
  apply_tasks           JSONB NOT NULL DEFAULT '{}',
  contract_tasks        JSONB NOT NULL DEFAULT '{}',
  apply_sub_tasks       JSONB NOT NULL DEFAULT '{}',
  contract_sub_tasks    JSONB NOT NULL DEFAULT '{}',
  apply_memo            TEXT,
  contract_memo         TEXT,
  site_address          TEXT,
  panel_kw              NUMERIC,
  referrer              TEXT,
  lead_date             DATE,
  apply_submit_date     DATE,
  apply_result_date     DATE,
  sale_contract_date    DATE,
  land_contract_date    DATE,
  handover_date         DATE,
  converted_customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  converted_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- インデックス
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_projects_customer         ON projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_contracts_project         ON contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_annual_records_contract   ON annual_records(contract_id);
CREATE INDEX IF NOT EXISTS idx_annual_records_year       ON annual_records(year);
CREATE INDEX IF NOT EXISTS idx_annual_records_status     ON annual_records(status);
CREATE INDEX IF NOT EXISTS idx_maintenance_project       ON maintenance_responses(project_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_status        ON maintenance_responses(status);
CREATE INDEX IF NOT EXISTS idx_periodic_project          ON periodic_maintenance(project_id);
CREATE INDEX IF NOT EXISTS idx_attachments_customer      ON attachments(customer_id);
CREATE INDEX IF NOT EXISTS idx_prospects_apply_status    ON prospects(apply_status);
CREATE INDEX IF NOT EXISTS idx_prospects_contract_status ON prospects(contract_status);
CREATE INDEX IF NOT EXISTS idx_prospects_converted       ON prospects(converted_customer_id)
  WHERE converted_customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_name            ON customers(name);
CREATE INDEX IF NOT EXISTS idx_projects_name             ON projects(project_name);

-- ============================================================
-- updated_at 自動更新トリガー
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_contracts_updated_at
  BEFORE UPDATE ON contracts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_annual_records_updated_at
  BEFORE UPDATE ON annual_records
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_maintenance_responses_updated_at
  BEFORE UPDATE ON maintenance_responses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_periodic_maintenance_updated_at
  BEFORE UPDATE ON periodic_maintenance
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_attachments_updated_at
  BEFORE UPDATE ON attachments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_prospects_updated_at
  BEFORE UPDATE ON prospects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Row Level Security（匿名アクセス許可 — ログイン機能なし）
-- ============================================================
ALTER TABLE customers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE annual_records       ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE periodic_maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospects            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon full access" ON customers             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON projects              FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON contracts             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON annual_records        FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON maintenance_responses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON periodic_maintenance  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON attachments           FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow anon full access" ON prospects             FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- Storage バケット（添付ファイル用）
-- ============================================================
-- Supabase ダッシュボード > Storage > New bucket で手動作成してください:
--   バケット名: attachments
--   Public: OFF（署名付きURLを使用）

-- ============================================================
-- バルクインポート用トランザクション関数
-- ============================================================
CREATE OR REPLACE FUNCTION bulk_insert_project(
  p_customer JSONB,
  p_project JSONB,
  p_contract JSONB DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
  v_customer_id BIGINT;
  v_project_id BIGINT;
  v_contract_id BIGINT;
BEGIN
  -- 顧客の名寄せ/作成
  SELECT id INTO v_customer_id FROM customers WHERE name = p_customer->>'name' LIMIT 1;
  IF v_customer_id IS NULL THEN
    INSERT INTO customers (name, company_name, is_corporate, email, phone, postal_code, address)
    VALUES (
      p_customer->>'name',
      p_customer->>'company_name',
      (p_customer->>'is_corporate')::boolean,
      p_customer->>'email',
      p_customer->>'phone',
      p_customer->>'postal_code',
      p_customer->>'address'
    )
    RETURNING id INTO v_customer_id;
  END IF;

  -- 案件作成
  INSERT INTO projects
  SELECT * FROM jsonb_populate_record(null::projects, p_project || jsonb_build_object('customer_id', v_customer_id))
  RETURNING id INTO v_project_id;

  -- 契約作成（任意）
  IF p_contract IS NOT NULL THEN
    INSERT INTO contracts
    SELECT * FROM jsonb_populate_record(null::contracts, p_contract || jsonb_build_object('project_id', v_project_id))
    RETURNING id INTO v_contract_id;
  END IF;

  RETURN jsonb_build_object('customer_id', v_customer_id, 'project_id', v_project_id, 'contract_id', v_contract_id);
END;
$$ LANGUAGE plpgsql;
