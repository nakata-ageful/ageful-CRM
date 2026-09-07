export const BACKUP_TABLES = ['customers', 'projects', 'contracts', 'annual_records', 'maintenance_responses', 'periodic_maintenance', 'prospects'] as const
export type BackupTable = typeof BACKUP_TABLES[number]
type Row = Record<string, unknown>
export type BackupPage = { data: Row[] | null; count: number | null; error: unknown }

/** アプリ対象7表の全行取得。DB全体の同時点snapshotやStorageの保全ではない。 */
export async function readBackupTables(fetchPage: (table: BackupTable, from: number, to: number) => Promise<BackupPage>) {
  const entries = await Promise.all(BACKUP_TABLES.map(async table => {
    const rows: Row[] = []
    let expected: number | null = null
    let lastId = 0
    for (;;) {
      const page = await fetchPage(table, rows.length, rows.length + 499)
      if (page.error || !page.data || page.count == null || !Number.isSafeInteger(page.count) || page.count < 0) {
        throw new Error(`${table}の取得に失敗しました。バックアップは作成していません`)
      }
      if (expected != null && expected !== page.count) throw new Error(`${table}の件数が途中で変わりました。編集を止めて再取得してください`)
      expected = page.count
      for (const row of page.data) {
        if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= lastId) throw new Error(`${table}のID順序・重複を確認してください`)
        lastId = row.id
      }
      rows.push(...page.data)
      if (rows.length === expected) break
      if (rows.length > expected || page.data.length === 0) throw new Error(`${table}の取得件数が一致しません`)
    }
    return [table, rows] as const
  }))
  return Object.fromEntries(entries) as Record<BackupTable, Row[]>
}

/** 7表が揃い、主な参照先が含まれるか確認。全列網羅や復元成功の証明ではない。 */
export function checkBackupRelations(data: Record<BackupTable, Row[]>): void {
  const ids = Object.fromEntries(BACKUP_TABLES.map(table => [table, new Set(data[table].map(r => r.id))])) as Record<BackupTable, Set<unknown>>
  const relations: [BackupTable, string, BackupTable, boolean][] = [
    ['projects', 'customer_id', 'customers', false], ['contracts', 'project_id', 'projects', false],
    ['annual_records', 'contract_id', 'contracts', false], ['maintenance_responses', 'project_id', 'projects', false],
    ['periodic_maintenance', 'project_id', 'projects', false], ['prospects', 'converted_customer_id', 'customers', true],
  ]
  for (const [table, column, target, optional] of relations) {
    for (const row of data[table]) {
      if (optional && row[column] == null) continue
      if (!ids[target].has(row[column])) throw new Error(`${table}の${column}に対応する${target}が不足しています。復元用としては要確認です`)
    }
  }
}
