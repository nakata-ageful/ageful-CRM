/** 基本情報の区分別備考。「その他」の notes とは独立して保存する。 */
export const BASIC_NOTE_KEYS = ['summary_notes', 'meti_notes', 'power_company_notes'] as const
export type BasicNotesInput = Partial<Record<typeof BASIC_NOTE_KEYS[number], string | null>>

/** 旧フォームの未指定は更新しない。明示的な空文字だけを削除として扱う。 */
export function basicNotesPayload(input: BasicNotesInput): BasicNotesInput {
  return Object.fromEntries(BASIC_NOTE_KEYS
    .filter(key => input[key] !== undefined)
    .map(key => [key, input[key] === '' ? null : input[key]]))
}
