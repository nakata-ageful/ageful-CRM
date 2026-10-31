import React,{useState} from 'react'
import{createRoot}from'react-dom/client'
import {PowerContractImport} from '../components/PowerContractImport'
import {projectStore,customerStore} from '../lib/mock-store'
import '../styles.css'
import './power-contract-telemetry'
if(import.meta.env.MODE!=='operator-demo')throw Error('実データに接続しないoperator-demoモードで開いてください。')
const original=projectStore.getAll()[0],c=customerStore.getAll()[0]
projectStore.update(original.id,{plant_name:'練習用・電力会社PDF',project_name:'合成発電所',customer_id:c.id,grid_id:'ZZ12345A00',grid_certified_at:null,generation_point_id:null,power_supply_start_date:null,power_change_date:null,fit_period:20,fit_end_date:null,power_company_notes:'今ある備考は残します'})
function App(){const [open,setOpen]=useState(true),[version,setVersion]=useState(0),[saved,setSaved]=useState(false);const p=projectStore.getAll().find(p=>p.id===original.id)!;return <main style={{padding:24}}><p role="status">練習画面：実データには保存しません</p><output id="power-metrics" aria-label="読み取り計測">読み取り前</output><details><summary>検証用の読み取り結果</summary><pre id="power-debug"/></details><div className="card"><h2>基本情報 ／ 電力会社</h2><button className="btn btn-sub" onClick={()=>setOpen(true)}>PDFを読み込む</button>{saved&&<p>練習用のデータに反映しました。{version}回目</p>}<p>設備ID：{p.grid_id} ／ FIT：{p.fit_period}円 ／ FIT期間：{p.fit_end_date||'未登録'}</p><p style={{whiteSpace:'pre-wrap'}}>{p.power_company_notes}</p></div>{open&&<PowerContractImport project={p} customer={{...c,name:'合成担当者',is_corporate:true,company_name:'練習用合同会社'}} onClose={()=>setOpen(false)} onSaved={()=>{setOpen(false);setSaved(true);setVersion(v=>v+1)}}/>}</main>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
