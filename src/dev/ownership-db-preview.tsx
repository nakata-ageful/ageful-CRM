import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { PGlite } from '@electric-sql/pglite'
import { createOwnershipTestDb } from './ownership-test-db'
import '../styles.css'

type Unit={id:number;revision:number;lifecycle:string;service_year:number;round_number:number;
  scheduled_date:string|null;recipient_customer_id:number;frozen_amount:number|null}
type State={project:{id:number;customer_id:number;old_owner:string|null};
  contract:{id:number;billing_count:number;annual_maintenance_inc:number;notes:string|null;[k:string]:unknown};
  plan:{id:number;revision:number};units:Unit[];today:string;
  history:{id:number;from_customer_id:number;to_customer_id:number;transfer_date:string;
    contract_before:{notes:string|null};contract_after:{notes:string|null}}[]}
type Request={operation:string;source:State;schedule:object|null;choices:object;overrides:Record<string,number>;
  after:{date:string;payer:number;amount:number}[]}
const name=(id:number)=>id===1?'顧客A':'顧客B'
const yen=(n:number)=>`${n.toLocaleString()}円`

function OwnershipPreview(){
  const [db,setDb]=useState<PGlite|null>(null),[state,setState]=useState<State|null>(null)
  const [open,setOpen]=useState(false),[next,setNext]=useState('2'),[changeSchedule,setChangeSchedule]=useState(false)
  const [noteMode,setNoteMode]=useState('keep'),[note,setNote]=useState(''),[request,setRequest]=useState<Request|null>(null)
  const [error,setError]=useState(''),[message,setMessage]=useState('検証用DBを準備しています…'),[saving,setSaving]=useState(false)
  const busy=useRef(false)
  async function read(client:PGlite){
    const result=await client.query<{value:State}>(`select jsonb_build_object(
      'project',(select to_jsonb(p) from projects p where id=1),
      'contract',(select to_jsonb(c) from contracts c where id=1),
      'plan',(select to_jsonb(p) from billing_recipient_plans p where project_id=1 and retired_at is null),
      'units',(select jsonb_agg(to_jsonb(u) order by service_year,scheduled_date nulls last,id) from billing_units u),
      'today',current_date::text,'history',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from ownership_transfers t)) value`)
    return result.rows[0].value
  }
  useEffect(()=>{
    let active=true,client:PGlite|null=null
    void createOwnershipTestDb().then(async instance=>{
      client=instance
      if(!active){await instance.close();return}
      const initial=await read(instance)
      if(active){setDb(instance);setState(initial);setMessage('「所有者を変更」から試せます。')}
    }).catch(e=>{if(active)setError(String(e))})
    return()=>{active=false;if(client)void client.close()}
  },[])
  function start(){if(!state)return
    setNext('2');setChangeSchedule(false);setNoteMode('keep');setNote(state.contract.notes??'')
    setRequest(null);setError('');setOpen(true)
  }
  function confirm(){if(!state)return
    const source=structuredClone(state),planned=source.units.filter(u=>u.lifecycle==='planned')
    const year=planned[0].service_year,first=planned[0],second=planned[1]
    const overrides:Record<string,number>=!changeSchedule&&next==='1'?{[first.id]:1}:{}
    const schedule=changeSchedule?{
      configuration:{billing_count:3,billing_schedule_days:['3月1日','6月1日','12月1日'],billing_amount_overrides:null},
      targets:[{source_id:null,service_year:year,round_number:1},{source_id:first.id,service_year:year,round_number:2},
        {source_id:second.id,service_year:year,round_number:3}],retire:[],reason:'年3回への変更を確認',
      new_recipient_overrides:next==='1'?{[`${year}:1`]:1}:{},
    }:null
    const dates=changeSchedule?[`${year}-03-01`,`${year}-06-01`,`${year}-12-01`]:planned.map(u=>u.scheduled_date!)
    setRequest({operation:crypto.randomUUID(),source,schedule,overrides,
      choices:{contract:{notes:noteMode==='change'?{mode:'change',value:note}:{mode:noteMode}}},
      after:dates.map((date,i)=>({date,payer:i===0?Number(next):2,amount:Math.floor(source.contract.annual_maintenance_inc/dates.length)}))})
  }
  async function save(){if(!db||!request||busy.current)return
    busy.current=true;setSaving(true);setError('')
    try{
      const s=request.source
      await db.query('select transfer_ownership_inherit($1,1,2,$2,$3::jsonb,$4::jsonb,$5,$6,$7::jsonb,2,$8::jsonb,$9::jsonb,$10::jsonb)',
        [request.operation,s.today,JSON.stringify(s.project),JSON.stringify(s.contract),s.plan.id,s.plan.revision,
          JSON.stringify(Object.fromEntries(s.units.filter(u=>u.lifecycle==='planned').map(u=>[u.id,u.revision]))),
          JSON.stringify(request.overrides),JSON.stringify(request.choices),request.schedule?JSON.stringify(request.schedule):null])
      setState(await read(db));setOpen(false);setRequest(null)
      setMessage('所有者・今後の請求先・契約をまとめて保存しました。過去の入金済みは顧客Aのままです。')
    }catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{busy.current=false;setSaving(false)}
  }
  return <main style={{maxWidth:1100,margin:'24px auto',padding:'0 20px',display:'grid',gap:18}}>
    <div className="notice">架空データ専用です。本番とは接続していません。再読み込みで初期状態へ戻ります。全回未発行の翌年度を使った、限定範囲の動作確認です。</div>
    <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:16}}><div>
      <h1 style={{fontSize:24,margin:0}}>サンプル発電所 ― 発電所詳細</h1><p>現在の所有者：{state?name(state.project.customer_id):'準備中'}</p></div>
      <button className="btn btn-main" disabled={!state||state.project.customer_id===2} onClick={start}>所有者を変更</button></header>
    <p role="status">{message}</p>{error&&<div role="alert" style={{color:'#b91c1c'}}>{error}</div>}
    {state&&<><section className="card" style={{padding:20}}><h2>保守・請求情報</h2>
      <p>年次保守料（税込）：{yen(state.contract.annual_maintenance_inc)} ／ 請求方法：請求書 ／ 年{state.contract.billing_count}回</p>
      <p>備考：{state.contract.notes??'未記入'}</p></section>
      {(['planned','received'] as const).map(status=><section key={status} className="card" style={{padding:20}}>
        <h2>{status==='planned'?'請求予定':'入金済み（変更しません）'}</h2>
        <table style={{width:'100%',textAlign:'left'}}><thead><tr><th>年度・回</th><th>請求予定日</th><th>請求先</th><th>金額（税込）</th></tr></thead>
          <tbody>{state.units.filter(u=>u.lifecycle===status).map(u=><tr key={u.id}><td>{u.service_year}年 第{u.round_number}回</td>
            <td>{u.scheduled_date??'未記録'}</td><td>{name(u.recipient_customer_id)}</td>
            <td>{yen(u.frozen_amount??Math.floor(state.contract.annual_maintenance_inc/state.contract.billing_count))}{u.frozen_amount===null?'（予定額）':'（確定額）'}</td></tr>)}</tbody></table>
      </section>)}
      <section className="card" style={{padding:20}}><h2>所有者変更履歴</h2>
        {!state.history.length?<p>まだ変更はありません。</p>:state.history.map(h=><div key={h.id}>
          <p>{h.transfer_date}：{name(h.from_customer_id)} → {name(h.to_customer_id)}</p>
          <p>変更前の備考：{h.contract_before.notes??'未記入'} ／ 変更後：{h.contract_after.notes??'未記入'}</p>
        </div>)}<p>別の設定を試す場合は、このページを再読み込みしてください。</p></section>
    </>}
    {open&&state&&<div role="dialog" aria-modal="true" aria-labelledby="transfer-title" style={{position:'fixed',inset:0,background:'#0f172a80',display:'grid',placeItems:'center',padding:20,zIndex:100}}>
      <section className="card" style={{padding:24,width:'min(680px,100%)',maxHeight:'85vh',overflowY:'auto'}}>
        <h2 id="transfer-title">{request?'所有者変更の最終確認':'所有者を変更'}</h2>
        <fieldset disabled={saving} style={{border:0,padding:0}}>
          <p>顧客A → 顧客B ／ 所有権移転日：{request?.source.today??state.today}</p>
          {request?<><p>今後の請求は下記のとおりです。請求書の発行・送信は行いません。</p>
            <table style={{width:'100%',textAlign:'left'}}><thead><tr><th>請求予定日</th><th>請求先</th><th>予定額（税込）</th></tr></thead>
              <tbody>{request.after.map(x=><tr key={x.date}><td>{x.date}</td><td>{name(x.payer)}</td><td>{yen(x.amount)}</td></tr>)}</tbody></table>
            <p>過去の入金済み82,500円は、請求先・金額とも変更しません。</p>
            <p>備考：{noteMode==='keep'?'そのまま引き継ぐ':noteMode==='clear'?'現在欄は空欄にする（旧値は履歴に保存）':note}</p>
            <div style={{display:'flex',gap:10}}><button className="btn btn-main" onClick={()=>void save()}>{saving?'保存中…':'保存する（検証用）'}</button>
              <button className="btn btn-sub" onClick={()=>setRequest(null)}>設定へ戻る</button></div>
          </>:<><label className="form-group"><span className="form-label">次回の請求先</span>
            <select className="form-input" value={next} onChange={e=>setNext(e.target.value)}><option value="2">顧客B</option><option value="1">顧客A</option></select></label>
            <p>その次からの請求先：顧客B</p>
            <label><input type="checkbox" checked={changeSchedule} onChange={e=>setChangeSchedule(e.target.checked)}/> 請求条件も変更する（年2回 → 年3回）</label>
            <p>チェックすると翌年3月の予定を追加し、6月・12月の予定は残します。年次保守料165,000円は変えず、予定額は各55,000円になります。</p>
            <label className="form-group"><span className="form-label">契約の備考</span><select className="form-input" value={noteMode} onChange={e=>setNoteMode(e.target.value)}>
              <option value="keep">そのまま引き継ぐ</option><option value="change">変更して引き継ぐ</option><option value="clear">引き継がない</option></select></label>
            {noteMode==='change'&&<textarea aria-label="変更後の備考" className="form-input" value={note} onChange={e=>setNote(e.target.value)}/>}
            <p>この画面では代表項目だけを確認できます。その他の項目は保持します。</p>
            <button className="btn btn-main" onClick={confirm}>変更内容を確認</button>
          </>}
          <button className="btn btn-sub" style={{marginTop:12}} onClick={()=>setOpen(false)}>キャンセル</button>
          {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
        </fieldset>
      </section>
    </div>}
  </main>
}
if(import.meta.env.DEV)createRoot(document.getElementById('root')!).render(<OwnershipPreview/> )
