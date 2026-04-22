# 開発メモ（Claude との作業記録）

## プロジェクト概要

- **フレームワーク**: React 19 + TypeScript + Vite
- **ポート**: 5177
- **DB**: Supabase（開発時は mock-store で代替、`hasSupabaseEnv` で切り替え）

---

## データベース

### schema.sql の修正

`database/schema.sql` を実際のアプリコードに合わせて全面書き直し済み。

#### テーブル一覧（8テーブル）

| テーブル名 | 説明 |
|---|---|
| `customers` | 顧客（個人名・法人名） |
| `projects` | 案件（発電所情報・パネル・PCS・監視等） |
| `contracts` | 契約情報（1案件につき1件） |
| `annual_records` | 年次請求記録（`UNIQUE(contract_id, year)`） |
| `maintenance_responses` | 保守対応履歴 |
| `periodic_maintenance` | 定期点検記録 |
| `attachments` | 添付ファイル（Supabase Storage 連携） |
| `prospects` | 見込み客 |

#### annual_records の重要仕様
- `year` フィールドで年ごとにレコードが分かれる
- 入金完了にしても翌年は新しいレコードが作られるため履歴として残る
- `status`: `'未入金' | '請求済' | '入金済'`
- `line_items`: JSONB `[{name, amount}]` 形式

---

## 主要ファイル

| ファイル | 役割 |
|---|---|
| `src/lib/data.ts` | データ取得関数（mock/Supabase 切り替え） |
| `src/lib/actions.ts` | データ更新・作成関数 |
| `src/lib/mock-store.ts` | 開発用インメモリストア |
| `src/views/ProjectDetail.tsx` | 案件詳細画面 |
| `src/views/BillingDetail.tsx` | 請求詳細画面 |

---

## 実装済み変更

### 1. BillingDetail.tsx レイアウト改善

- グリッドレイアウト: `gridTemplateColumns: '1fr 520px'`（右カラム固定幅）
- スケジュール欄を「請求グループ」「入金グループ」の2カードに分割
  - 請求グループ（青: `#0ea5e9`）: 請求予定日 / 請求日
  - 入金グループ（緑: `#10b981`）: 入金予定日 / 入金日
- 保守情報編集フォーム: セクションごとに2カラムグリッド
- 履歴データ行: 請求日 / 入金日 / 金額 を横並び3カラム
- `SectionLabel`: テキスト両側に水平ラインを追加
- `InfoRow`: `borderBottom: '1px solid #f8fafc'` で区切り線

### 2. 契約情報の新規作成機能

**対応ファイル:**

- `src/lib/actions.ts` → `createContract()` 関数を追加
  ```ts
  export async function createContract(
    projectId: number,
    input: Partial<Omit<Contract, 'id' | 'created_at' | 'project_id'>>
  ): Promise<Contract>
  ```

- `src/views/ProjectDetail.tsx`
  - `handleSaveContract()` を修正: `contract` が null なら `createContract()`、あれば `updateContract()` を使用
  - 請求タブで `contract` が null のとき「＋ 契約情報を追加」ボタンを表示

---

## Supabase 本番移行時の TODO

- `getProjectDetail()`: Supabase stub が `return null` のまま → 本実装が必要
- `getBillingDetail()`: 同上
- `getDashboard()`: `activeMaintenanceCount` / `pendingBillingCount` が 0 固定 → 本実装が必要
- Storage バケット `attachments` をダッシュボードで手動作成（Public: ON）
