import { useState } from 'react'
import { supabase } from '../lib/supabase'

interface LoginProps {
  onLogin: () => void
}

export function Login({ onLogin }: LoginProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!supabase) return
    setLoading(true)
    setError('')
    setMessage('')

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        setMessage('確認メールを送信しました。メールを確認してください。')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        onLogin()
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'エラーが発生しました'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f1f5f9',
    }}>
      <div className="card" style={{ width: '100%', maxWidth: 400, padding: '40px 32px' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: '#38bdf8', letterSpacing: '0.03em' }}>
            Ageful
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
            太陽光 管理
          </div>
        </div>

        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', textAlign: 'center', marginBottom: 20 }}>
          {isSignUp ? 'アカウント作成' : 'ログイン'}
        </h2>

        {error && <div className="form-error">{error}</div>}
        {message && (
          <div className="notice" style={{ marginBottom: 14 }}>{message}</div>
        )}

        <form onSubmit={handleSubmit}>
          <label className="form-label" style={{ marginBottom: 14 }}>
            メールアドレス
            <input
              className="form-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="user@example.com"
              required
              autoComplete="email"
            />
          </label>

          <label className="form-label" style={{ marginBottom: 20 }}>
            パスワード
            <input
              className="form-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              minLength={6}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
            />
          </label>

          <button
            type="submit"
            className="btn btn-main"
            disabled={loading}
            style={{ width: '100%', padding: '10px 16px', fontSize: 14 }}
          >
            {loading ? '処理中...' : isSignUp ? 'アカウント作成' : 'ログイン'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <button
            type="button"
            onClick={() => { setIsSignUp(!isSignUp); setError(''); setMessage('') }}
            style={{
              background: 'none',
              border: 'none',
              color: '#0ea5e9',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {isSignUp ? 'ログインに戻る' : '初回セットアップ / アカウント作成'}
          </button>
        </div>
      </div>
    </div>
  )
}
