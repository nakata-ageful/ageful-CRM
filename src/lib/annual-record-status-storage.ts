/**
 * Storage-boundary adapter for the verified production CHECK constraint.
 * Not wired into actions yet: every write path must be reviewed before rollout.
 * This does not infer issuance from status or normalize historical read values.
 */
export type StoredAnnualRecordStatus = '未入金' | '請求済' | '入金済'

export function toStoredAnnualRecordStatus(value: unknown): StoredAnnualRecordStatus {
  if (value === '') return '未入金'
  if (value === '未入金' || value === '請求済' || value === '入金済') return value
  throw new Error('Unsupported annual record status')
}

/** Missing status in a partial update must stay missing, not reset existing state. */
export function annualRecordPayloadForStorage<T extends object>(payload: T): Omit<T, 'status'> & { status?: StoredAnnualRecordStatus } {
  const result = { ...payload } as Omit<T, 'status'> & { status?: StoredAnnualRecordStatus }
  if (Object.hasOwn(payload, 'status')) {
    result.status = toStoredAnnualRecordStatus((payload as { status: unknown }).status)
  }
  return result
}

/** The current UI uses blank for a record that has not been issued. */
export function annualRecordFromStorage<T extends object>(row: T): T {
  if (!Object.hasOwn(row, 'status')) return { ...row }
  const status = (row as { status: unknown }).status
  if (status === '未入金') return { ...row, status: '' }
  if (status === '' || status === '請求済' || status === '入金済') return { ...row }
  throw new Error('Unsupported stored annual record status')
}
