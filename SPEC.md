# Ageful Manager — 太陽光発電 顧客管理システム 仕様書

バージョン: 0.1.0
最終更新: 2026-03-09

---

## 1. アプリ概要

### 目的
太陽光発電所の顧客・案件情報を一元管理するWebアプリケーション。
既存のスプレッドシート（Googleスプレッドシート / Excel）による管理をWebアプリに移行し、情報の検索・更新・共有を効率化する。

### 主な対象業務
- 顧客情報の管理（個人・法人）
- 太陽光発電所（案件）の情報管理
- 保守記録のトラッキング
- 契約・請求状況の管理
- 既存スプレッドシートデータの一括取り込み（CSVインポート）

---

## 2. 技術スタック

| 区分 | 技術 |
|---|---|
| フロントエンド | React 19 + TypeScript |
| ビルドツール | Vite 6 |
| バックエンド/DB | Supabase（PostgreSQL） |
| 認証 | なし（RLS で全操作許可） |
| デプロイ | 静的ファイル（`dist/`）を任意のホスティングに配置 |
| モックモード | `.env` 未設定時はインメモリのモックストアで動作 |

### ディレクトリ構成

```
ageful.manager.claude/
├── src/
│   ├── App.tsx              # ルート・ナビゲーション
│   ├── main.tsx             # エントリポイント
│   ├── types.ts             # 全型定義
│   ├── styles.css           # グローバルスタイル
│   ├── views/               # 各画面コンポーネント
│   │   ├── Dashboard.tsx
│   │   ├── Projects.tsx
│   │   ├── Customers.tsx
│   │   ├── CustomerDetail.tsx
│   │   ├── Maintenance.tsx
│   │   ├── Billing.tsx
│   │   └── CsvImport.tsx
│   ├── components/          # 共通UIコンポーネント
│   │   ├── Modal.tsx
│   │   ├── Confirm.tsx
│   │   └── StatusBadge.tsx
│   └── lib/
│       ├── supabase.ts      # Supabaseクライアント設定
│       ├── data.ts          # データ取得関数
│       ├── actions.ts       # データ更新・作成関数
│       └── mock-store.ts    # オフライン用モックデータ
├── database/
│   └── schema.sql           # DBスキーマ定義
├── .env                     # Supabase接続情報（要作成）
└── vite.config.ts
```

---

## 3. 環境設定

### Supabase接続（`.env` ファイルを作成）

```env
VITE_SUPABASE_URL=https://xxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

`.env` が存在しない場合、アプリはモックモードで動作する。
モックモードではブラウザのメモリ上にデータが保持され、リロードで消える。

### 開発サーバー起動

```bash
npm install
npm run dev      # http://localhost:5173
```

### 本番ビルド

```bash
npm run build    # dist/ に静的ファイル生成
```

---

## 4. データモデル

### ER図（概念）

```
customers
  └── projects (1:N)
        ├── power_plant_specs (1:1)
        ├── maintenance_logs (1:N)
        └── contracts (1:N)
              └── invoices (1:N)
```

### テーブル定義

#### customers（顧客）

| カラム | 型 | 説明 |
|---|---|---|
| id | SERIAL PK | |
| type | TEXT | `individual`（個人）/ `corporate`（法人） |
| company_name | TEXT | 法人名（法人の場合） |
| contact_name | TEXT NOT NULL | 担当者名・個人名 |
| email | TEXT | |
| phone | TEXT | |
| postal_code | TEXT | 顧客の郵便番号 |
| address | TEXT | 顧客の住所 |
| notes | TEXT | 備考 |

#### projects（案件）

| カラム | 型 | 説明 |
|---|---|---|
| id | SERIAL PK | |
| customer_id | FK → customers | |
| project_number | TEXT | 案件番号 |
| project_name | TEXT NOT NULL | 案件名（発電所名） |
| site_address | TEXT | 設置住所 |
| key_number | TEXT | カギNo |
| grid_id | TEXT | 経産省 系統ID |
| grid_certified_at | DATE | 系統認定日 |
| fit_period | INTEGER | FIT期間（年） |
| fit_end_date | DATE | FIT満了日 |
| power_supply_start_date | DATE | 需給開始日 |
| generation_point_id | TEXT | 受電地点特定番号 |
| customer_number | TEXT | お客さま番号 |
| handover_date | DATE | 引渡日 |
| abolition_date | DATE | 廃止日 |
| sales_company | TEXT | 販売会社 |
| referrer | TEXT | 紹介者 |
| sales_price | INTEGER | 販売価格（税込） |
| reference_price | INTEGER | 価格参照 |
| land_cost | INTEGER | 土地代 |
| amuras_member_no | TEXT | アムラス会員番号 |
| monitoring_system | TEXT | 遠隔監視システム名 |
| notes | TEXT | 備考 |
| latitude | NUMERIC(10,7) | 緯度 |
| longitude | NUMERIC(10,7) | 経度 |

#### power_plant_specs（発電所スペック）

1案件につき1レコード（UNIQUE制約）。

| カラム | 型 | 説明 |
|---|---|---|
| project_id | FK → projects UNIQUE | |
| panel_kw | NUMERIC | パネル出力（kW） |
| panel_count | INTEGER | パネル枚数 |
| panel_manufacturer | TEXT | パネルメーカー |
| panel_model | TEXT | パネル型番 |
| pcs_kw | NUMERIC | パワコン出力（kW） |
| pcs_count | INTEGER | パワコン台数 |
| pcs_manufacturer | TEXT | パワコンメーカー |
| pcs_model | TEXT | パワコン型番 |

#### maintenance_logs（保守記録）

| カラム | 型 | 説明 |
|---|---|---|
| project_id | FK → projects | |
| inquiry_date | DATE | 問合せ日 |
| occurrence_date | DATE | 発生日 |
| work_type | TEXT | 作業種別 |
| target_area | TEXT | 対象箇所 |
| situation | TEXT | 状況 |
| response | TEXT | 対応内容 |
| report | TEXT | 報告内容 |
| status | TEXT | `pending` / `in_progress` / `completed` |

#### contracts（契約）

| カラム | 型 | 説明 |
|---|---|---|
| project_id | FK → projects | |
| contract_type | TEXT | 契約種別（デフォルト: `maintenance`） |
| business_owner | TEXT | 事業主 |
| contractor | TEXT | 受託者 |
| start_date | DATE | 契約開始日 |
| end_date | DATE | 契約終了日 |
| annual_maintenance_fee | INTEGER | 年間保守料（円） |
| communication_fee | INTEGER | 通信費（円） |

#### invoices（請求）

| カラム | 型 | 説明 |
|---|---|---|
| contract_id | FK → contracts | |
| billing_period | TEXT | 請求期間 |
| issue_date | DATE | 発行日 |
| amount | INTEGER | 金額（円） |
| status | TEXT | `unbilled`（未請求）/ `billed`（請求済）/ `paid`（入金済） |
| payment_due_date | DATE | 支払期限 |
| paid_at | DATE | 入金日 |

---

## 5. 画面仕様

### 5-1. ダッシュボード

**目的:** アプリ全体の状況を一覧確認する。

**表示内容:**
- KPIカード（4つ）
  - 顧客総数
  - 案件総数
  - 対応中の保守件数（`pending` + `in_progress`）
  - 未請求の請求件数
- 請求KPIグリッド（未請求金額合計・入金済金額合計）
- 請求対応待ちリスト（未請求・請求済の明細一覧）
- 最近の保守記録（最新6件）

**操作:**
- KPIカードをクリックすると該当画面へ遷移

---

### 5-2. 案件一覧

**目的:** 全発電所案件を一覧・検索・管理する。

**表示内容:**
- 案件カード一覧（案件名・顧客名・設置住所・引渡日・FIT満了日・販売会社）
- FIT満了日アラート（満了済: 赤、365日以内: オレンジ）

**操作:**
- テキスト検索（案件名・顧客名・住所・販売会社）
- 新規案件作成（モーダル）
  - 既存顧客から選択 または 新規顧客を同時作成
  - 案件基本情報 / FIT・系統情報 / 販売情報 / 保守管理 / 座標 を入力
- 案件カードクリック → 顧客詳細画面（その顧客にフォーカス）へ遷移

---

### 5-3. 顧客管理

**目的:** 顧客（個人・法人）の情報を一覧・管理する。

**表示内容:**
- 顧客カード一覧（顧客名・会社名・連絡先・保有案件数・作成日）

**操作:**
- テキスト検索（顧客名・会社名・メール・電話）
- 新規顧客作成（モーダル）
- 顧客編集（モーダル）
- 顧客削除（確認ダイアログ付き、カスケード削除）
- 顧客カードクリック → 顧客詳細画面へ遷移
- CSVエクスポート（現在表示中の顧客一覧をダウンロード）

---

### 5-4. 顧客詳細

**目的:** 特定顧客の全情報を1画面で確認・編集する。

**表示内容:**
- 顧客基本情報（編集ボタンあり）
- その顧客が保有する案件一覧
  - 発電スペック（パネル・パワコン）
  - FIT情報・販売情報
- 最近の保守記録

**操作:**
- 顧客情報編集（モーダル）
- 新規案件作成（この顧客に紐づく）
- 案件編集（モーダル）
- 案件削除
- 「戻る」で顧客管理画面へ

---

### 5-5. 保守記録

**目的:** 全案件の保守・点検ログをトラッキングする。

**表示内容:**
- 保守ログ一覧（案件名・顧客名・作業種別・発生日・ステータス）

**操作:**
- テキスト検索（案件名・顧客名・作業種別）
- ステータスフィルター（全件 / 未対応 / 対応中 / 完了）
- ステータス変更（ドロップダウンで即時更新）
- 新規保守ログ作成（モーダル、案件選択→情報入力）
- 保守ログ削除（確認ダイアログ付き）
- CSVエクスポート

**ステータス:**

| 値 | 表示 | 意味 |
|---|---|---|
| `pending` | 未対応 | 作業未着手 |
| `in_progress` | 対応中 | 作業中 |
| `completed` | 完了 | 作業完了 |

---

### 5-6. 契約・請求

**目的:** 契約ごとの請求状況を管理し、入金ステータスを更新する。

**表示内容:**
- KPIカード（未請求合計・請求済合計・入金済合計）
- 請求一覧（契約名・案件名・請求期間・金額・発行日・支払期限・ステータス）

**操作:**
- ステータス変更（未請求→請求済→入金済）
- CSVエクスポート

**ステータス:**

| 値 | 表示 |
|---|---|
| `unbilled` | 未請求 |
| `billed` | 請求済 |
| `paid` | 入金済 |

---

### 5-7. CSVインポート

**目的:** 既存スプレッドシートデータを一括取り込む。

**対応フォーマット:**
1. **テンプレート形式** — アプリが提供するCSVテンプレート（1行ヘッダー）
2. **既存データ形式** — エイジフル既存スプレッドシート（2行ヘッダー）

フォーマットはアップロード時に自動判別される（1行目のcol1が「案件名」なら既存データ形式）。

**処理フロー:**
1. CSVファイルをアップロード（クリック or ドラッグ&ドロップ）
2. プレビュー表示（フォーマット種別バッジ・件数・エラー一覧）
3. 「インポート」ボタンで確定
4. 顧客の名寄せ（同一の顧客名が既に存在する場合は既存IDを使用）
5. 案件・発電スペックを順次作成
6. 結果表示（成功件数・失敗件数・エラー詳細）

**既存データ形式の列マッピング:**

| 列インデックス | 内容 | マッピング先 |
|---|---|---|
| 1 | 案件名 | project_name |
| 2 | 顧客名 | customer_name / company_name |
| 3 | E-mail | email |
| 4 | 電話番号 | phone |
| 5 | 顧客郵便番号 | postal_code |
| 6 | 顧客住所 | customer_address |
| 9+10 | 都道府県+市区町村 | site_address（結合） |
| 11 | Google Map座標 | latitude / longitude |
| 12 | パネルkW | panel_kw |
| 13 | パネル説明（枚数パース） | panel_count |
| 14 | パネルメーカー | panel_manufacturer |
| 15 | パネル型番 | panel_model |
| 16 | パワコンkW | pcs_kw |
| 17 | パワコン説明（台数パース） | pcs_count |
| 18 | パワコンメーカー | pcs_manufacturer |
| 19 | パワコン型番 | pcs_model |
| 20 | 経産ID | grid_id |
| 21 | 経産認定日 | grid_certified_at |
| 22 | FIT（数値を抽出） | fit_period |
| 23 | 需給開始日 | power_supply_start_date |
| 24 | お客さま番号 | customer_number |
| 25 | 受電地点特定番号 | generation_point_id |
| 26 | 遠隔監視システム | monitoring_system |
| 33 | 販売会社 | sales_company |
| 34 | 紹介者 | referrer |
| 36 | 引渡日 | handover_date |
| 38 | 販売価格（税込） | sales_price |
| 39 | 価格備考（税込） | reference_price |
| 40 | 土地代 | land_cost |
| 46 | カギNo | key_number |
| 47 | 備考 | notes |
| 48 | アプラス会員番号 | amuras_member_no |
| 77〜80 | パネルkW/メーカー/パワコンkW/メーカー | col12が空の場合フォールバック |

**法人判定:** 顧客名に「㈱」「株式」「有限」「合同」「(株)」「(有)」等を含む場合、`type = corporate` として登録。

---

## 6. アーキテクチャ

### データフロー

```
[ブラウザ（React）]
      │
      ├── lib/data.ts      ← データ取得（SELECT相当）
      │       │
      ├── lib/actions.ts   ← データ更新（INSERT/UPDATE/DELETE相当）
      │       │
      └── lib/supabase.ts  ← Supabaseクライアント
              │
    ┌─────────┴──────────┐
    │  .env 設定あり      │  .env 設定なし
    │  Supabase API       │  mock-store.ts
    │  (PostgreSQL)       │  (インメモリ)
    └─────────────────────┘
```

### モックモード
`.env` ファイルがない状態でもアプリが起動・動作するよう、`mock-store.ts` にインメモリのデータストアを実装している。全データ取得・作成・更新・削除操作がモックで動作する。ただし**ページリロードでデータは消える**。

画面上部に「モックデータで表示中」バナーが表示される。

### Supabase RLS
現在は全テーブルに「Allow all」ポリシーが適用されており、認証なしで全操作が可能。
将来的に認証を追加する場合はポリシーを変更する。

---

## 7. 主要な型定義（types.ts）

```typescript
// 顧客
type Customer = {
  id: number
  type: 'individual' | 'corporate'
  company_name: string | null
  contact_name: string
  email: string | null
  phone: string | null
  postal_code: string | null
  address: string | null
  notes: string | null
  created_at: string
  project_count?: number  // 一覧表示用（JOIN結果）
}

// 案件（一覧表示用）
type ProjectRow = {
  id: number
  customer_id: number
  project_number: string | null
  project_name: string
  site_address: string | null
  key_number: string | null
  fit_end_date: string | null
  handover_date: string | null
  sales_company: string | null
  created_at: string
  customer_name: string    // JOINで取得
  company_name: string | null
}

// 保守ステータス
type MaintenanceStatus = 'pending' | 'in_progress' | 'completed'

// 請求ステータス
type InvoiceStatus = 'unbilled' | 'billed' | 'paid'

// ダッシュボード集計
type DashboardStats = {
  totalCustomers: number
  totalProjects: number
  pendingMaintenanceCount: number
  unbilledInvoiceCount: number
}
```

---

## 8. 今後の拡張ポイント

- **認証追加:** Supabase Auth を有効化し、ユーザー単位でのアクセス制御
- **FIT満了日通知:** 満了が近い案件のメール通知
- **地図表示:** 座標データを使った発電所マップビュー
- **保守レポートPDF出力:** 保守記録の帳票化
- **契約・請求の作成UI:** 現在は請求ステータスの更新のみ対応
