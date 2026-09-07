# 所有者変更時の回別指定チェック

## 最新：混在予定＋所有者の原子的移転RPC

transfer_ownership_manualを追加。project/contract全snapshot版確認、A/B先限定、detail_choicesの既存allowlist、manual plan子操作を同txnで実行、所有者/旧名/移転日/選択項目を更新し全snapshot保存。A→B→C/契約備考clear/最終snapshot失敗rollback/古い再送でCを戻さない試験成功。旧年度/既存recipientplans制限は維持。契約の全54項目変更や契約請求方法・回数構成変更を解禁したものではない。新RPCは画面未接続（画面の保存は依然予定のみ）。

振替結果RPCはoriginal_methodを由来として維持し、現在method=debit/pendingで受領/不能を許可。foundationのfailed制約からoriginal_method依存を外した（受領日null制約維持）。invoice由来→debit受領、不能→invoice発行→入金を同IDで試験。received debitのcorrection追加：実額/明細/日付、理由必須、前後監査・再送。請求先訂正や入金取消は未対応。既存draft適用DBへのALTER/CREATE OR REPLACE移行はまだなく、新規隔離DB用のみ。

①②残り：新移転RPCへのUI接続、既存recipientplan/移行済みとの統合、全契約項目と請求方法構成の検証、振替予定の明示追加、訂正UI、4通り各ケースの移転から結果記録までを一つの試験で検証。今回の各層試験だけで①②完了としない。本番なし。

## 最新：隔離DBで請求予定を保存

20260907_manual_billing_plan.sqlでperiod_start/end/plan_noteを追加、write_manual_billing_planで全plannedのID/版・厳密入力・失敗回元先をDB再検証し、回更新/全snapshot監査/操作完了を同一txn化。original_method・実績は保持。再送同IDは完了receipt、別内容/古い版は拒否。PUBLIC実行不可。既存recipient planまたは移行元参照ありは統合未完のため拒否。所有者を更新するRPCではなく、A/B所属制限はまだ純粋関数側のみ（DBは顧客FK検証）。通常App/本番接続不可。

OwnershipBillingDbPreviewは架空PGliteのみ。確認後に理由と保存ボタン、成功後全件再取得/フォーム再生成。期間/備考の保存値を初期表示へ渡す。結果不明は同内容/同ID再試行（メモリのみ、ページを閉じた復旧未実装）。ブラウザーでA請求書/B振替・予定額82500保存と履歴3件/再取得を確認。無変更の回も全件確認対象としてrevisionと監査を記録する。

manual-billing-plan-postgresをtest:billing-dbへ追加。混在方法/期間備考/実績不変/不能先保護/対象全件/重複/不正日付/途中監査失敗rollback/再送/版/未認証/既存計画拒否を検証。DB suite/build成功。

重要な未接続：invoice由来からdirect_debitへ変えた回をmanual_debit_resultがoriginal_method制約で拒否する。不能時のfoundation制約もoriginal_methodに依存するため、単にガードを削除しない。4通りの「予定保存」は検証済みだが、その後の全運用完成ではない。所有者/契約同時更新・既存計画統合・権限・移行・復元は別途必要。

## 確認画面の追加

表示を整理：現在/変更後所有者の見出し、回別4項目（先/方法/予定日/額）の横並び、期間/備考はdetailsへ折りたたみ。入力あり表示を付け、狭い画面では2列/1列へ変更する専用CSS。ブラウザーの初期折りたたみ状態とスクリーンショットを確認。機能・保存範囲は変更なし。

OwnershipBillingPlanEditorとDEV専用ownership-billing-preview.htmlを追加。架空の請求書/振替予定を初期値のまま表示し、先・方法・予定日・予定額・任意期間・備考を入力して純粋検証後に前後比較を表示。変更すると古い確認結果は消す。保存ボタン/RPC呼出はない。不能回は元先固定・請求書に限定。編集セッションのunitとrevisionは値コピー。

ブラウザーで11月分Aの振替→請求書、次の回Bへ請求書→振替/翌年6月を指定し、額保持・備考・対象外実績1件の比較を確認。対象年度/回は元の記録であり、予定日変更で年度を自動変更しない。新規請求生成・年度変更の画面ではない。画面を通常Appへ接続する前に、初期値となる既存期間/備考の読み込みと保存、親snapshotと認可・RPC接続が必要。

2026-09-07：src/lib/ownership-billing-plan.ts追加。D-027の4通り（請求書→請求書/振替、振替→請求書/振替）を確認する純粋関数。DB保存・画面接続・認可の実装ではない。

認可済みの対象発電所の全回と、すべてのplanned回の明示指定を入力する。ID/版、AまたはB、方法、実在日付、予定額の安全整数（0/nullを区別）、任意対象期間の開始終了を検証。予定なしでも架空の請求を追加しない。現契約からの計算、自動日割り、移転日による開始日の自動指定なし。

発行済み/入金済み/固定済み/取消は変更対象に含めない。review_requiredは先に確認が必要。振替不能の回は元の請求先の請求書として維持し、この経路で再振替へ変更しない。前後所有者以外の保存先が必要な既存例外は現関数では拒否するため、実接続前に別経路との整合性確認が必要。

tests/billing-migration-source.cjsで4通り、次回A/以降B、翌年開始、支払済み保持、予定なし、金額0/null、誤日付/版/対象/重複/期間、不能先保持、値コピーを確認。build成功（既存bundle警告のみ）。

残る：入力全件取得の保証、DB内再検証、対象期間/備考の保存先、振替予定生成・編集・実績訂正、原子的所有者変更RPCへの統合、通常画面と認可取得、移行・復元。本番適用なし。既存RPCの請求書限定ガードはまだ維持している。
