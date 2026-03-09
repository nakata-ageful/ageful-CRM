-- Ageful Manager — Supabase Schema
-- 既存 ageful.customer-management-system と互換

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  type TEXT DEFAULT 'individual' CHECK (type IN ('individual', 'corporate')),
  company_name TEXT,
  contact_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  postal_code TEXT,
  address TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  project_number TEXT,
  project_name TEXT NOT NULL,
  site_address TEXT,
  key_number TEXT,

  -- FIT・系統情報
  grid_id TEXT,
  grid_certified_at DATE,
  fit_period INTEGER,
  fit_end_date DATE,
  power_supply_start_date DATE,
  generation_point_id TEXT,
  customer_number TEXT,

  -- 日程
  handover_date DATE,
  abolition_date DATE,

  -- 販売情報
  sales_company TEXT,
  referrer TEXT,
  sales_price INTEGER,
  reference_price INTEGER,
  land_cost INTEGER,

  -- 保守管理
  amuras_member_no TEXT,
  monitoring_system TEXT,
  notes TEXT,

  -- 座標
  latitude NUMERIC(10,7),
  longitude NUMERIC(10,7),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS power_plant_specs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE UNIQUE,
  panel_kw NUMERIC(10,2),
  panel_count INTEGER,
  panel_manufacturer TEXT,
  panel_model TEXT,
  pcs_kw NUMERIC(10,2),
  pcs_count INTEGER,
  pcs_manufacturer TEXT,
  pcs_model TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS maintenance_logs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  inquiry_date DATE,
  occurrence_date DATE,
  work_type TEXT,
  target_area TEXT,
  situation TEXT,
  response TEXT,
  report TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contracts (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  contract_type TEXT DEFAULT 'maintenance',
  business_owner TEXT,
  contractor TEXT,
  start_date DATE,
  end_date DATE,
  annual_maintenance_fee INTEGER,
  communication_fee INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  contract_id INTEGER REFERENCES contracts(id) ON DELETE CASCADE,
  billing_period TEXT,
  issue_date DATE,
  amount INTEGER,
  status TEXT DEFAULT 'unbilled' CHECK (status IN ('unbilled', 'billed', 'paid')),
  payment_due_date DATE,
  paid_at DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects(customer_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_project ON maintenance_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_status ON maintenance_logs(status);
CREATE INDEX IF NOT EXISTS idx_contracts_project ON contracts(project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_contract ON invoices(contract_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- updated_at 自動更新トリガー
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_customers_updated_at
  BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_projects_updated_at
  BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_specs_updated_at
  BEFORE UPDATE ON power_plant_specs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_maintenance_updated_at
  BEFORE UPDATE ON maintenance_logs FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE OR REPLACE TRIGGER trg_contracts_updated_at
  BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS（全操作許可）
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE power_plant_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all" ON customers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON power_plant_specs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON maintenance_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON contracts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all" ON invoices FOR ALL USING (true) WITH CHECK (true);
