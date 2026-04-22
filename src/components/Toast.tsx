import { createContext, useCallback, useContext, useState } from 'react'

type ToastType = 'success' | 'error'
type Toast = { id: number; message: string; type: ToastType }

const ToastCtx = createContext<(message: string, type?: ToastType) => void>(() => {})

export function useToast() {
  return useContext(ToastCtx)
}

let nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const show = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++nextId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2500)
  }, [])

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div style={{
        position: 'fixed', bottom: 24, right: 24,
        display: 'flex', flexDirection: 'column', gap: 8,
        zIndex: 9999, pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div
            key={t.id}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              fontSize: 13.5,
              fontWeight: 600,
              color: '#fff',
              background: t.type === 'success'
                ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                : 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
              boxShadow: '0 4px 12px rgba(0,0,0,.15)',
              animation: 'toast-in .25s ease-out',
            }}
          >
            {t.type === 'success' ? '✓ ' : '✕ '}{t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
