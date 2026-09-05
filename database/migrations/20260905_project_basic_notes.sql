-- 2026-09-05 ユーザー承認により duoibibtuamilpneysnl へ適用済み。
-- 既存の備考・業務データは変更しない。他環境への実行には別途承認が必要。
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS summary_notes TEXT,
  ADD COLUMN IF NOT EXISTS meti_notes TEXT,
  ADD COLUMN IF NOT EXISTS power_company_notes TEXT;
DO $$
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects'
        AND column_name IN ('summary_notes', 'meti_notes', 'power_company_notes')
        AND data_type = 'text' AND is_nullable = 'YES') <> 3 THEN
    RAISE EXCEPTION 'Basic note columns must all be nullable TEXT; review existing schema before proceeding';
  END IF;
END $$;
COMMENT ON COLUMN public.projects.summary_notes IS '基本情報：概要の備考';
COMMENT ON COLUMN public.projects.meti_notes IS '基本情報：経済産業省の備考';
COMMENT ON COLUMN public.projects.power_company_notes IS '基本情報：電力会社の備考';
NOTIFY pgrst, 'reload schema';
COMMIT;
