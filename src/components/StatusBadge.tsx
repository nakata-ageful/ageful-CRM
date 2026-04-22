type Props = { status: string | null | undefined }

const MAP: Record<string, { label: string; cls: string }> = {
  // MaintenanceResponse status
  '対応中': { label: '対応中', cls: 'badge-progress' },
  '完了':   { label: '完了',   cls: 'badge-done' },
  // AnnualRecord status
  '': { label: '—', cls: 'badge-pending' },
  '請求済': { label: '請求済', cls: 'badge-progress' },
  '入金済': { label: '入金済', cls: 'badge-done' },
}

export function StatusBadge({ status }: Props) {
  const entry = MAP[status ?? ''] ?? { label: status ?? '-', cls: 'badge-pending' }
  return <span className={`badge ${entry.cls}`}>{entry.label}</span>
}
