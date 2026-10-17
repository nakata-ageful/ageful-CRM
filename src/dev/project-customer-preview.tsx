import {createRoot} from 'react-dom/client'
import {Projects} from '../views/Projects'
import type {Customer} from '../types'
import '../styles.css'

// Rehearsal mode replaces every real action with a throwing stub. No DB is loaded.
const customer:Customer={id:1,name:'検証用の既存顧客',name_kana:'ケンショウ',company_name:null,company_name_kana:null,is_corporate:false,email:null,phone:null,postal_code:null,address:null,notes:null,created_at:'2026-01-01'}
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<main style={{padding:24}}><p className="notice">隔離検証：合成データのみ。保存はできません。本番DBへの接続はありません。</p><h2>発電所</h2><Projects projects={[]} customers={[customer]} onReload={()=>{throw Error('保存は禁止されています')}} onViewDetail={()=>{}}/></main>)
else document.getElementById('root')!.textContent='隔離検証モード専用です。'
