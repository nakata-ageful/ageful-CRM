import {createContext,useContext,useEffect,useState,type ReactNode} from 'react'
import {supabase} from '../lib/supabase'

const AccountContext=createContext<{busy:boolean;error:string;logout:()=>Promise<void>}|null>(null)
export function AccountControls(){
 const account=useContext(AccountContext)
 if(!account)return null
 return <div className="sidebar-account"><button type="button" className="nav-btn" disabled={account.busy} onClick={()=>void account.logout()}>{account.busy?'ログアウト中…':'ログアウト'}</button>{account.error&&<p role="alert">{account.error}</p>}</div>
}

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
  async function logout(){if(!supabase||busy)return;setBusy(true);setError('');try{const {error}=await supabase.auth.signOut();if(error)throw error}catch{setError('ログアウトできませんでした。接続を確認してください')}finally{setBusy(false)}}
  if(user)return <AccountContext.Provider value={{busy,error,logout}}><div key={user}>{children}</div></AccountContext.Provider>
  return <main className="card" style={{maxWidth:480,margin:'64px auto',padding:24}}><h1>Ageful Manager ログイン</h1>
    <p>登録済みの利用者だけが請求データを開けます。</p>
    <form onSubmit={async e=>{e.preventDefault();if(busy||!supabase)return;setBusy(true);setError('');try{const {error}=await supabase.auth.signInWithPassword({email,password});if(error)setError('ログインできません。メールアドレスとパスワードを確認してください');else setPassword('')}catch{setError('接続できませんでした。時間をおいて再度お試しください')}finally{setBusy(false)}}}>
      <label>メールアドレス<input className="form-input" type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label>
      <label>パスワード<input className="form-input" type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>
      <button className="btn btn-main" disabled={busy}>ログイン</button><p role="alert">{error}</p>
    </form></main>
}
