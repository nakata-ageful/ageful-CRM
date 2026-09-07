# 請求移行の読み取り専用検証

最新：D-025の既存請求先確認を適用する場合は、第3ファイル引数としてRECIPIENT_APPROVAL.jsonを渡す。`datasetHash`（バックアップ全体のcanonical SHA-256）、`mode: "existing_current_customer"`、`basis`を必須とし、対象内容が変われば拒否する。承認なしでは従来どおり請求先を推定しない。承認を適用してもreadyToWrite=false。本番の移行・将来所有者への自動付替えではない。

## 実行

```sh
node tests/billing-backup-audit.cjs
node tests/billing-migration-source.cjs
node scripts/review-billing-backup.cjs /absolute/path/app-data.json /absolute/path/amount-approvals.json
```

監査CLIは既存バックアップJSONを読むだけで、環境変数・Supabase・通常アプリのDBモジュールへ接続しない。結果は標準出力だけ。入力ファイルや元DBを書き換えない。請求情報を含むため出力も公開しない。実データと承認ファイルはリポジトリへ入れない。

## 金額確認の形式

承認ファイルは配列。各要素は `recordId / contractId / year / paymentIndex / seq / sourceRecordHash / amount / lineItems（省略可）/ basis`。

- `paymentIndex`は元payments配列の0始まりの位置。単回はnull、seqもnull。
- `sourceRecordHash`はbilling-jsonのcanonicalJsonをUTF-8としてSHA-256にしたもの。通常のJSON.stringifyやPostgreSQL jsonb::textを直接ハッシュした値とは同一とは限らない。
- `basis`は確認根拠。利用者回答と保存明細と原本の直接確認を区別する。
- これは金額だけの確認。現在所有者・現在請求方法を過去の確定情報として認定しない。
- 元行変更・回の不一致・未発行への過去額の指定・重複確認・不正金額は停止する。
- 担当AIが今回のバックアップへ確認回答を対応付けている。利用者回答時点のDB全体との同一性を証明するものではない。今後の元行変更はハッシュで検出する。

## 出力の読み方

- actualは請求日・入金日等の実績がある回。実在した全ての振替月が記録済みという意味ではない。
- unknownActualAmountsは保存明細／明示確認によって金額を対応付けできなかった回数。0でも実際の請求書原本と全件一致を証明しない。
- actualWithoutScheduledDateは過去の予定日が空欄の回数。請求日・入金日が空欄とは別。元IDで履歴を保全できるので、これだけを理由に過去の予定日を推測して埋めない。
- currentOwnerReferenceIdとcurrentMethodReferenceは現契約にたどった参照候補のみ。recipientConfirmedへ昇格しない。
- 旧所有者や移転日の存在／不在だけで過去の請求先を決定しない。
- readyToWriteは常にfalse。完全INSERT payload・移行許可ではない。

## 未完了の移行条件

1. 請求先の初期確認を発電所別にまとめ、例外を回ごとに指定する。全回を現所有者へ無条件確定しない。
2. 過去の請求方法と対象月を確認する。現在口座振替でも過去の単回記録を12か月に増殖させない。
3. 元記録・元seq・根拠を含む証跡の永続保存先を決める。sourceの3列だけを保存して完了としない。
4. 移行RPCで元行をロックして再照合し、新回・証跡・完了記録を原子的に保存する。ローカルでハッシュが一致しても書込時点までの一致は保証しない。
5. 新予定生成と元未発行回を対応付ける。日付が空欄の2回を捨てたり、新予定と二重計上したりしない。
6. 読取・表示・合計・訂正経路を新回へ切替え、旧画面による更新を防ぐ。移行だけ先行し二重の正本を作らない。
7. 1人利用の最小限の認証・権限、永続復旧試験、本番適用と公開の別承認。

識別テストはPGliteでDB制約を実行するが、実データ監査CLIはDBを使わない。複数接続での競合・本番の権限・復元試験ではない。
