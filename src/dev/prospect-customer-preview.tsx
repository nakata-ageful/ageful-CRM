import {createRoot} from 'react-dom/client'
import {Prospects} from '../views/Prospects'
import type {Customer} from '../types'
import '../styles.css'

// Rehearsal mode replaces real actions with throwing stubs. No DB/network saves.
const customer:Customer={id:1,name:'検証用 担当者',name_kana:'ケンショウヨウ タントウシャ',company_name:'検証用株式会社',company_name_kana:'ケンショウヨウカブシキガイシャ',is_corporate:true,email:null,phone:null,postal_code:null,address:null,notes:null,created_at:'2026-01-01'}
if(import.meta.env.DEV&&import.meta.env.MODE==='rehearsal')createRoot(document.getElementById('root')!).render(<main style={{padding:24}}><p className="notice">隔離検証：合成データのみ。保存はできません。本番DBへの接続はありません。</p><h2>見込み管理</h2><Prospects prospects={[]} customers={[customer]} newProspectReady onReload={()=>{throw Error('保存は禁止されています')}} onViewDetail={()=>{}} onViewProject={()=>{}} onViewCustomer={()=>{}}/></main>)
else document.getElementById('root')!.textContent='隔離検証モード専用です。'
