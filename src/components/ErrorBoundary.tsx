import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, errorInfo)
  }

  handleReload = (): void => {
    window.location.reload()
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          padding: '2rem',
          backgroundColor: '#f8f9fa',
        }}>
          <div style={{
            background: '#fff',
            borderRadius: '12px',
            boxShadow: '0 2px 12px rgba(0, 0, 0, 0.08)',
            padding: '2.5rem',
            maxWidth: '480px',
            width: '100%',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>
              ⚠
            </div>
            <h2 style={{
              fontSize: '1.25rem',
              fontWeight: 600,
              color: '#1a1a1a',
              marginBottom: '0.75rem',
            }}>
              予期しないエラーが発生しました
            </h2>
            <p style={{
              color: '#666',
              fontSize: '0.9rem',
              lineHeight: 1.6,
              marginBottom: '1.5rem',
            }}>
              申し訳ありません。アプリケーションで問題が発生しました。
              ページを再読み込みしてもう一度お試しください。
            </p>
            {this.state.error && (
              <details style={{
                textAlign: 'left',
                marginBottom: '1.5rem',
                padding: '0.75rem',
                background: '#f5f5f5',
                borderRadius: '6px',
                fontSize: '0.8rem',
                color: '#888',
              }}>
                <summary style={{ cursor: 'pointer', marginBottom: '0.5rem' }}>
                  エラー詳細
                </summary>
                <code style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  {this.state.error.message}
                </code>
              </details>
            )}
            <button
              onClick={this.handleReload}
              style={{
                background: '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.625rem 1.5rem',
                fontSize: '0.95rem',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
              onMouseOver={e => (e.currentTarget.style.background = '#1d4ed8')}
              onMouseOut={e => (e.currentTarget.style.background = '#2563eb')}
            >
              再読み込み
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
