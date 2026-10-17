// Synthetic state/event-handler tests only. No app server, network or database.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const root=path.resolve(__dirname,'..'),cells=[]
let index=0,submitted=[],closed=0,handler=async()=>{},props
const hooks={...React,
 useState(initial){const n=index++;if(!(n in cells))cells[n]=typeof initial==='function'?initial():initial;return [cells[n],value=>{cells[n]=typeof value==='function'?value(cells[n]):value}]},
 useRef(value){const n=index++;return cells[n]??(cells[n]={current:value})},useMemo:fn=>fn(),
}
const cache=new Map()
function load(file,extra=''){
 file=path.resolve(root,file)
 if(cache.has(file))return cache.get(file).exports
 const m={exports:{}};cache.set(file,m)
 const source=fs.readFileSync(file,'utf8')+extra
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
  module:m,exports:m.exports,crypto:require('node:crypto').webcrypto,Error,TypeError,Date,Intl,Map,Set,
  sessionStorage:{getItem:()=>null,setItem:()=>{throw Error('Unexpected storage write')}},
  setTimeout:()=>{throw Error('Unexpected timer')},
  require:name=>{
   if(name==='react')return hooks
   if(name==='react/jsx-runtime')return require(name)
   if(name.endsWith('.css'))return {}
   if(name.includes('/lib/actions'))return new Proxy({},{get:()=>()=>{throw Error('Business writes forbidden')}})
   if(name.includes('/components/Toast'))return {useToast:()=>()=>{throw Error('Unexpected mutation toast')}}
   if(!name.startsWith('.'))throw Error('External access forbidden: '+name)
   const resolved=path.resolve(path.dirname(file),name)
   return load(resolved+(fs.existsSync(resolved+'.ts')?'.ts':'.tsx'))
  },
 })
 return m.exports
}
const {AddModal,Prospects}=load('src/views/Prospects.tsx','\nexport {AddModal};')
const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
const text=e=>Array.isArray(e)?e.map(text).join(''):e?.props?text(e.props.children):typeof e==='string'?e:''
function reset(ready=true){
 cells.length=0;submitted=[];closed=0;handler=async()=>{}
 props={newProspectReady:ready,existingCustomers:[{id:5,name:'合成A',name_kana:'エー',company_name:'合成会社A',company_name_kana:'ゴウセイカイシャエー',is_corporate:true}],
  onClose(){closed++},onSave:async(input,key)=>{submitted.push({input,key});await handler()},
 }
}
const render=()=>{index=0;return AddModal(props)}
const button=(tree,label)=>nodes(tree,e=>e.type==='button'&&e.props.children===label)[0]
function plant(value){nodes(render(),e=>e.type==='input'&&e.props.placeholder==='鹿嶋市武井')[0].props.onChange({target:{value}})}
async function test(){
 reset(false)
 let tree=render()
 assert.equal(button(tree,'顧客未定').props.disabled,true)
 button(tree,'顧客未定').props.onClick();tree=render()
 assert.ok(text(tree).includes('個人または法人を選んでから'),'Readiness guard must reject changing to undecided and keep the new-customer type choice')

 reset();tree=render();button(tree,'既存顧客').props.onClick();tree=render()
 nodes(tree,e=>e.type==='input'&&e.props.placeholder==='会社名・氏名・フリガナで検索')[0].props.onFocus();tree=render()
 nodes(tree,e=>e.type==='div'&&typeof e.props.onMouseDown==='function')[0].props.onMouseDown({preventDefault(){}})
 tree=render();button(tree,'顧客未定').props.onClick();tree=render()
 assert.equal(nodes(tree,e=>e.type==='input'&&e.props.placeholder==='山田 太郎').length,0)
 assert.equal(button(tree,'保存する').props.disabled,true,'Plant name remains required')
 plant('合成・顧客未定発電所');tree=render();assert.equal(button(tree,'保存する').props.disabled,false)

 let fail
 handler=()=>new Promise((_resolve,reject)=>{fail=()=>reject(new TypeError('Synthetic connection loss'))})
 const save=button(tree,'保存する').props.onClick,pending=save();save()
 assert.equal(submitted.length,1,'Synchronous save lock prevents a second click')
 assert.equal(submitted[0].input.customer_undecided,true)
 assert.equal(submitted[0].input.customer_name,'');assert.equal(submitted[0].input.customer_name_kana,'')
 assert.equal(submitted[0].input.company_name,'');assert.equal(submitted[0].input.existing_customer_id,undefined)
 assert.ok(!('company_name_kana' in submitted[0].input),'The strict undecided RPC must receive the unchanged field set')
 assert.equal(submitted[0].input.is_corporate,false);assert.match(submitted[0].key,/^[0-9a-f-]{36}$/)
 tree=render();tree.props.onClick();assert.equal(closed,0,'Cannot close while saving')
 fail();await pending;tree=render()
 assert.equal(nodes(tree,e=>e.type==='fieldset')[0].props.disabled,true)
 assert.equal(button(tree,'キャンセル').props.disabled,true)
 button(tree,'新規顧客').props.onClick();plant('変更してはいけない値')
 tree.props.onClick();assert.equal(closed,0,'Cannot dismiss an uncertain pending registration')
 handler=async()=>{};tree=render();await button(tree,'同じ内容で保存結果を確認').props.onClick()
 assert.equal(submitted.length,2);assert.equal(submitted[0].key,submitted[1].key)
 assert.deepEqual(submitted[0].input,submitted[1].input,'Recovery must use exactly the reviewed original payload')

 tree=render();handler=async()=>{throw {code:'23514',message:'Synthetic definite rejection'}}
 await button(tree,'保存する').props.onClick();tree=render()
 assert.equal(nodes(tree,e=>e.type==='fieldset')[0].props.disabled,false)
 plant('合成・修正後');handler=async()=>{};tree=render();await button(tree,'保存する').props.onClick()
 assert.notEqual(submitted.at(-1).key,submitted[0].key,'Editing a definitely rejected request gets a new key')
 tree=render();button(tree,'既存顧客').props.onClick();tree=render()
 assert.equal(button(tree,'保存する').props.disabled,true,'Changing mode requires explicit customer reselection')

 reset();plant('合成・通常新規');tree=render()
 button(tree,'個人').props.onClick();tree=render()
 nodes(tree,e=>e.type==='input'&&e.props.placeholder==='山田 太郎')[0].props.onChange({target:{value:'合成人名'}})
 handler=async()=>{throw new TypeError('Synthetic legacy connection loss')}
 tree=render();await button(tree,'保存する').props.onClick();tree=render()
 assert.equal(button(tree,'保存する').props.disabled,true,'Legacy multi-write path must not offer unsafe replay')
 button(tree,'閉じて一覧を確認').props.onClick();assert.equal(closed,1)

 reset();plant('合成・法人の新規案件');tree=render()
 assert.equal(nodes(tree,e=>e.type==='input'&&e.props.placeholder==='山田 太郎').length,0,'Choose type before customer entry')
 assert.equal(button(tree,'保存する').props.disabled,true)
 await button(tree,'保存する').props.onClick();assert.equal(submitted.length,0,'Handler also rejects missing type')
 button(tree,'法人').props.onClick();tree=render()
 assert.ok(text(tree).includes('担当者名')&&text(tree).includes('担当者フリガナ')&&text(tree).includes('会社名フリガナ'))
 const enter=(placeholder,value)=>{nodes(render(),e=>e.type==='input'&&e.props.placeholder===placeholder)[0].props.onChange({target:{value}})}
 enter('山田 太郎','合成 担当');enter('やまだ たろう','ゴウセイ タントウ');tree=render()
 assert.equal(button(tree,'保存する').props.disabled,true,'Company remains mandatory')
 enter('株式会社〇〇','合成法人');enter('カブシキガイシャ〇〇','ゴウセイホウジン');tree=render()
 button(tree,'法人').props.onClick();tree=render();assert.equal(nodes(tree,e=>e.type==='input'&&e.props.placeholder==='カブシキガイシャ〇〇')[0].props.value,'ゴウセイホウジン','Clicking the selected type does not clear input')
 assert.equal(button(tree,'保存する').props.disabled,false);await button(tree,'保存する').props.onClick()
 assert.equal(submitted[0].input.company_name_kana,'ゴウセイホウジン');assert.equal(submitted[0].input.customer_name,'合成 担当');assert.equal(submitted[0].input.customer_name_kana,'ゴウセイ タントウ');assert.equal(submitted[0].input.is_corporate,true)
 button(tree,'個人').props.onClick();tree=render();assert.ok(!text(tree).includes('会社名フリガナ'))
 await button(tree,'保存する').props.onClick();assert.equal(submitted.at(-1).input.company_name,'');assert.equal(submitted.at(-1).input.company_name_kana,'');assert.equal(submitted.at(-1).input.is_corporate,false)
 button(tree,'顧客未定').props.onClick();tree=render();await button(tree,'保存する').props.onClick()
 assert.ok(!('company_name_kana'in submitted.at(-1).input));assert.equal(submitted.at(-1).input.customer_name,'');assert.equal(submitted.at(-1).input.customer_name_kana,'')

 reset();tree=render();button(tree,'既存顧客').props.onClick();tree=render()
 nodes(tree,e=>e.type==='input'&&e.props.placeholder==='会社名・氏名・フリガナで検索')[0].props.onChange({target:{value:'ゴウセイカイシャエー'}});tree=render()
 const match=nodes(tree,e=>e.type==='div'&&typeof e.props.onMouseDown==='function');assert.equal(match.length,1,'Existing company kana also matches the search')
 match[0].props.onMouseDown({preventDefault(){}});tree=render();assert.ok(text(tree).includes('ゴウセイカイシャエー'),'Existing company kana is shown without editing')
 plant('合成・既存法人の新規案件');tree=render();await button(tree,'保存する').props.onClick();assert.equal(submitted[0].input.existing_customer_id,5)

 cells.length=0;index=0
 const calls=[],data=[
  {id:1,new_project_id:901,customer_name:'新規未定',project_name:'合成新規発電所',converted_customer_id:null},
  {id:2,new_project_id:902,converted_customer_id:45,customer_name:'合成B',project_name:'合成初回設定後'},
  {id:3,ownership_project_id:903,candidate_customer_id:null,customer_name:'引継ぎ先未定',project_name:'合成既存発電所'},
 ].map(p=>({...p,apply_status:'未',contract_status:'未'}))
 const original=JSON.stringify(data)
 tree=Prospects({prospects:data,customers:[],newProspectReady:true,onReload(){throw Error('Unexpected reload')},
  onViewDetail:id=>calls.push(['detail',id]),onViewProject:id=>calls.push(['legacy',id]),
  onViewExistingProject:id=>calls.push(['project',id]),onViewCustomer:id=>calls.push(['customer',id])})
 const rows=nodes(tree,e=>e.type==='tr'&&e.props.className==='clickable-row')
 assert.equal(rows.length,3)
 for(let i=0;i<rows.length;i++){
  const columns=nodes(rows[i],e=>e.type==='td');let stopped=false
  columns[2].props.onClick({stopPropagation(){stopped=true}})
  assert.equal(stopped,true);assert.deepEqual(calls.pop(),['project',901+i])
  assert.equal(nodes(rows[i],e=>e.type==='button'&&e.props.children==='✕').length,0)
 }
 assert.ok(text(rows[0]).includes('新規案件・顧客未定'))
 assert.equal(text(nodes(rows[0],e=>e.type==='td')[1]),'顧客未定')
 assert.ok(text(rows[1]).includes('新規案件'));assert.ok(!text(rows[1]).includes('顧客未定'))
 assert.ok(text(rows[2]).includes('引継ぎ先未定'));assert.equal(JSON.stringify(data),original)
 console.log('PASS: new-prospect actual UI handlers, readiness, pending identity, stable project links, double-click guard, same-key immutable recovery, definite rejection and legacy no-replay fallback')
}
test().catch(error=>{console.error(error);process.exitCode=1})
