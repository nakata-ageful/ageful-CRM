import {FormError} from './FormError'
type Props = {
  error?:unknown
  busy?:boolean
  message: string
  onConfirm: () => void
  onCancel: () => void
}

export function Confirm({ message, onConfirm, onCancel,error,busy=false }: Props) {
  return (
    <div className="modal-overlay" onClick={()=>{if(!busy)onCancel()}}>
      <div className="modal-box" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">確認</h2>
          <button disabled={busy} aria-label="閉じる" className="modal-close" onClick={()=>{if(!busy)onCancel()}}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ margin: '0 0 24px', color: '#374151' }}>{message}</p>
          <FormError message={error}/>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button disabled={busy} className="btn btn-sub" onClick={()=>{if(!busy)onCancel()}}>キャンセル</button>
            <button disabled={busy} className="btn btn-danger" onClick={onConfirm}>{busy?'処理中…':'削除する'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
