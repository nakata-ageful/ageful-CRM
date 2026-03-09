type Props = {
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function Confirm({ message, onConfirm, onCancel }: Props) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">確認</h2>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ margin: '0 0 24px', color: '#374151' }}>{message}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-sub" onClick={onCancel}>キャンセル</button>
            <button className="btn btn-danger" onClick={onConfirm}>削除する</button>
          </div>
        </div>
      </div>
    </div>
  )
}
