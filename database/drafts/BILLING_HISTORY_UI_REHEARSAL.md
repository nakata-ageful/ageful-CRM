# 顧客・請求詳細の履歴表示準備

BillingHistorySectionを既存CustomerDetailView/BillingDetailViewへ任意billingHistory入力として接続。保存請求先による横断抽出、発電所名ごとの表、確定額集計、未知金額の別表示。認可済みデータを呼出元が渡す前提で、現所有者から請求先を補完しない。

BillingDetailで新入力を指定すると読取専用となり旧年度の編集欄は表示しない。通常Appからの取得・指定はまだなく、旧画面は従来動作を維持する。CustomerDetailの請求以外の操作は従来どおり。

DEV専用billing-history-preview.htmlは架空データのみ。同一部品で顧客A/B別と発電所別表示を比較できる。ブラウザで現在Bでも顧客Aの過去82,500円が残り、発電所の表にA過去/B予定が並ぶことを確認。既存Detail全体の操作テストではない。

残る：認可されたDB横断取得/行変換、RPC保存と再読込、通常請求/ダッシュボード集計、実データ切替・振替・権限/復元検証。公開・本番適用なし。
# 追加：DB保存行の厳密変換

billing-unit-storage.tsで実SQL行のID/年度/月/回/日付/方法/状態/請求先/確定額・明細・時刻を検査しBillingUnitへ変換。現在所有者・現契約の補完なし。単回の不明回番号を第1回と捏造せず「保存済み単回記録」と表示。実移行SQL出力で値一致と不正値拒否をテスト。

invoice-db-previewのreloadで変換し、BillingHistorySectionへ渡す。既存の発行/入金/訂正後の再読込経路でも更新される。予定額の計算根拠がないため検証画面の履歴部品はnullを渡す。通常AppのSupabase取得・権限・切替は未接続。変換はDB制約の代替ではなく、全不正状態の検証器でもない。
