import type { AnnualRecord } from '../types'
import { canonicalJson, copyJson } from './billing-json'

/** Empty billing fields only; a due date or an unexplained status is not a maintenance-only record. */
export function isMaintenanceOnlyRecord(record: AnnualRecord): boolean {
  return [record.billing_scheduled_date, record.billing_date, record.payment_due_date, record.received_date]
    .every(value => value == null || value === '')
    && (record.payments == null || (Array.isArray(record.payments) && record.payments.length === 0))
    && (record.line_items == null || (Array.isArray(record.line_items) && record.line_items.length === 0))
    && (record.transfer_failed == null || record.transfer_failed === false)
    && ['', '未入金'].includes(record.status ?? '')
}

/** Read-only preservation manifest. Never inserts a zero-yen bill or changes the source row. */
export async function prepareMaintenancePreservation(datasetId: string, records: readonly AnnualRecord[]) {
  const snapshot = copyJson([...records])
  if (!datasetId.trim() || new Set(snapshot.map(r => r.id)).size !== snapshot.length) throw new Error('保全対象の識別情報が不正です')
  const retained = []
  for (const record of snapshot) {
    if (![record.id, record.contract_id].every(n => Number.isSafeInteger(n) && n > 0)
      || !Number.isInteger(record.year) || record.year < 2000 || record.year > 2200) throw new Error('保全対象の識別情報が不正です')
    if (!isMaintenanceOnlyRecord(record)) throw new Error('請求情報を含むため保守専用として保全できません')
    const sourceSignature = canonicalJson(record)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceSignature))
    retained.push({ recordId: record.id, contractId: record.contract_id, year: record.year,
      sourceRecord: record, sourceSignature,
      sourceSnapshotHash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') })
  }
  return { schemaVersion: 1, datasetId, retained, billingUnitsCreated: 0, readyToWrite: false as const }
}

/** Compare a restored/exported subset against the original manifest, without writing either side. */
export async function verifyMaintenancePreservation(
  manifest: Awaited<ReturnType<typeof prepareMaintenancePreservation>>, restored: readonly AnnualRecord[],
) {
  const expected = copyJson(manifest)
  const rows = copyJson([...restored])
  if (expected.schemaVersion !== 1) throw new Error('保全記録の形式が不正です')
  const regenerated = await prepareMaintenancePreservation(expected.datasetId, expected.retained.map(r => r.sourceRecord))
  if (canonicalJson(regenerated) !== canonicalJson(expected)) throw new Error('保全記録の照合情報が一致しません')
  const mismatches: { recordId: number; reason: 'missing' | 'duplicate' | 'changed' | 'extra' }[] = []
  for (const item of expected.retained) {
    const matches = rows.filter(row => row.id === item.recordId)
    if (matches.length !== 1) mismatches.push({ recordId: item.recordId, reason: matches.length ? 'duplicate' : 'missing' })
    else if (canonicalJson(matches[0]) !== item.sourceSignature) mismatches.push({ recordId: item.recordId, reason: 'changed' })
  }
  for (const row of rows) if (!expected.retained.some(item => item.recordId === row.id)) mismatches.push({ recordId: row.id, reason: 'extra' })
  return { matches: mismatches.length === 0, mismatches, productionRestoreVerified: false as const }
}
