import {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {Customers} from '../views/Customers'
import {CustomerDetailView} from '../views/CustomerDetail'
import {ToastProvider} from '../components/Toast'
import type {Customer} from '../types'
import '../styles.css'
const base={name:'同名 担当',name_kana:'タントウ',company_name:null,is_corporate:false,email:'sample@example.invalid',phone:'090-1234-5678',postal_code:'100-0001',address:'確認用の住所（合成データ）',notes:'確認用の備考。実際の顧客情報ではありません。',created_at:'2026-10-15',project_count:0}
const people:Customer[]=[{...base,id:1,is_corporate:true,company_name:'株式会社あおぞら',company_name_kana:'アオゾラ'},
 {...base,id:2,name:'伊藤 サンプル',name_kana:'イトウサンプル'},
 {...base,id:3,is_corporate:true,company_name:'風株式会社',company_name_kana:'カゼ'},
 {...base,id:4,name:'未定',name_kana:null},{...base,id:5,name:'未定',name_kana:null}]
function Preview(){const [id,setId]=useState<number|null>(null);return <ToastProvider><main className="main" style={{margin:0}}><h1>顧客画面の隔離確認</h1><p>合成データのみ。保存操作は拒否し、本番データへ接続しません。</p>{id?<CustomerDetailView detail={{customer:people.find(c=>c.id===id)!,projects:[],attachments:[]}} onBack={()=>setId(null)} onReload={()=>{}} onViewProject={()=>{}}/>:<Customers customers={people} onReload={()=>{}} onViewDetail={setId}/>}</main></ToastProvider>}
if(import.meta.env.DEV)createRoot(document.getElementById('root')!).render(<Preview/> )
