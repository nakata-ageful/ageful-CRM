export const RESTORE_DISABLED_MESSAGE = '現在の復元機能は既存データへ追加・上書きする方式のため、本番では実行できません。隔離した検証環境で確認してください。'

export function ensureLegacyRestoreAllowed(hasDatabaseConnection: boolean): void {
  if (hasDatabaseConnection) throw new Error(RESTORE_DISABLED_MESSAGE)
}
