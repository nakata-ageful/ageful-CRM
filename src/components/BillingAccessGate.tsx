import {useEffect,useState,type ReactNode} from 'react'
import {supabase} from '../lib/supabase'

export function BillingAccessGate({children}:{children:ReactNode}){
  const [user,setUser]=useState<string|null>(null),[loaded,setLoaded]=useState(false),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{
    if(!supabase){setLoaded(true);setError('接続設定がありません');return}
    let active=true,authChanged=false
    void supabase.auth.getUser().then(({data})=>{if(active&&!authChanged){setUser(data.user?.id??null);setLoaded(true)}}).catch(()=>{if(active&&!authChanged){setError('ログイン状態を確認できません。接続を確認してください');setLoaded(true)}})
    const {data}=supabase.auth.onAuthStateChange((_event,session)=>{if(active){authChanged=true;setUser(session?.user.id??null);setLoaded(true)}})
    return()=>{active=false;data.subscription.unsubscribe()}
  },[])
  if(!loaded)return <p>ログインを確認しています…</p>
  if(user)return <div key={user}><div style={{textAlign:'right',padding:8}}><button className="btn" disabled={busy} onClick={async()=>{if(!supabase||busy)return;setBusy(true);setError('');try{const {error}=await supabase.auth.signOut();if(error)throw error}catch{setError('ログアウトできませんでした。接続を確認してください')}finally{setBusy(false)}}}>ログアウト</button>{error&&<p role="alert">{error}</p>}</div>{children}</div>
  return <main className="card" style={{maxWidth:480,margin:'64px auto',padding:24}}><h1>Ageful Manager ログイン</h1>
    <p>登録済みの利用者だけが請求データを開けます。</p>
    <form onSubmit={async e=>{e.preventDefault();if(busy||!supabase)return;setBusy(true);setError('');try{const {error}=await supabase.auth.signInWithPassword({email,password});if(error)setError('ログインできません。メールアドレスとパスワードを確認してください');else setPassword('')}catch{setError('接続できませんでした。時間をおいて再度お試しください')}finally{setBusy(false)}}}>
      <label>メールアドレス<input className="form-input" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
      <label>パスワード<input className="form-input" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
      <button className="btn btn-main" disabled={busy}>ログイン</button><p role="alert">{error}</p>
    </form></main>
}
