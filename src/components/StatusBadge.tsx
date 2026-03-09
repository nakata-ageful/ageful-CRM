type Props = { status: string | null | undefined }

const MAP: Record<string, { label: string; cls: string }> = {
  pending:    { label: '未対応', cls: 'badge-pending' },
  in_progress:{ label: '対応中', cls: 'badge-progress' },
  completed:  { label: '完了',   cls: 'badge-done' },
  unbilled:   { label: '未請求', cls: 'badge-pending' },
  billed:     { label: '請求済', cls: 'badge-progress' },
  paid:       { label: '入金済', cls: 'badge-done' },
}

export function StatusBadge({ status }: Props) {
  const entry = MAP[status ?? ''] ?? { label: status ?? '-', cls: 'badge-pending' }
  return <span className={`badge ${entry.cls}`}>{entry.label}</span>
}
