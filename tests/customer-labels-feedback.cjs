// Actual read projections, form handlers and rendered feedback; synthetic data, no network or business writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
const root=path.resolve(__dirname,'..')
function load(file,hooks=React,overrides={}){
 file=path.resolve(root,file);const m={exports:{}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Date,Error,Intl,Set,Map,structuredClone,require:n=>{
  if(n in overrides)return overrides[n]
  if(n==='react')return {...React,...hooks}
  if(n==='react/jsx-runtime')return require(n)
  if(n.endsWith('.css'))return {}
  if(!n.startsWith('.'))throw Error('External access forbidden: '+n)
  const p=path.resolve(path.dirname(file),n)
  if(/\/(actions|supabase|mock-store)$/.test(p))throw Error('Business access forbidden: '+p)
  return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'),hooks,overrides)
 }});return m.exports
}
const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
function harness(file,props,overrides={}){const slots=[],refs=[];let i=0,j=0
 const hooks={useState(v){const n=i++;if(!(n in slots))slots[n]=typeof v==='function'?v():v;return[slots[n],v=>slots[n]=typeof v==='function'?v(slots[n]):v]},useRef(v){return refs[j++]??(refs[j-1]={current:v})},useEffect(){},useId:()=> 'synthetic'}
 const exports=load(file,hooks,overrides),Component=Object.values(exports)[0]
 return {render(){i=0;j=0;return Component(props)}}
}
const error=tree=>nodes(tree,e=>typeof e.type==='function'&&e.type.name==='FormError').map(e=>e.props.message).find(Boolean)
const field=(tree,label,value)=>{const e=nodes(tree,e=>e.type==='label'&&e.props.children?.[0]===label)[0];nodes(e,e=>['input','textarea','select'].includes(e.type))[0].props.onChange({target:{value}})}
const submit=tree=>nodes(tree,e=>e.type==='form')[0].props.onSubmit({preventDefault(){}})
const {formErrorText,errorDetail}=load('src/lib/form-error.ts')
assert.equal(errorDetail({message:'対象月を確認してください'}),'対象月を確認してください')
assert.ok(formErrorText(new Error('Failed to fetch')).includes('保存結果を確認'))
assert.ok(formErrorText({message:'JWT expired'}).includes('入力中の内容を控えて'))
assert.equal(formErrorText('Error: 請求先を選択してください'),'請求先を選択してください')
const {FormError}=load('src/components/FormError.tsx')
const markup=renderToStaticMarkup(React.createElement(FormError,{message:new Error('Failed to fetch')}))
assert.ok(markup.includes('role="alert"'));assert.ok(markup.includes('tabindex="-1"'));assert.ok(markup.includes('詳しいエラー内容'))
assert.equal(renderToStaticMarkup(React.createElement(FormError,{message:''})),'')
const {customerDisplayName,customerChoiceLabel}=load('src/lib/customer-search.ts')
const corp={id:1,name:'架空担当者',company_name:'株式会社合成',is_corporate:true}
assert.equal(customerDisplayName(corp),'株式会社合成')
assert.equal(customerDisplayName({...corp,company_name:' '}),'架空担当者')
assert.equal(customerChoiceLabel({...corp,is_corporate:false}),'架空担当者 ／ 顧客ID 1')
const source=JSON.stringify(corp)
const p={id:10,customer_id:1,project_name:'合成発電所'},store={getAll:()=>[p],getById:id=>id===10?p:null}
const data=load('src/lib/data.ts',React,{'./supabase':{hasSupabaseEnv:false},'./mock-store':{projectStore:store,contractStore:{getAll:()=>[]},customerStore:{getById:()=>corp},annualRecordStore:{getAll:()=>[]},maintenanceResponseStore:{getAll:()=>[{id:9,project_id:10}]},periodicMaintenanceStore:{getAll:()=>[{id:8,project_id:10}]}}})
;(async()=>{
 for(const rows of [await data.getProjects(),await data.getBillingRows(),await data.getPeriodicMaintenance()])assert.equal(rows[0].customer_name,'株式会社合成')
 const responseData=load('src/lib/data.ts',React,{'./supabase':{hasSupabaseEnv:true,supabase:{from:()=>({select(){return this},is(){return this},order(){return this},limit:async()=>({data:[{id:9,projects:{project_name:'合成発電所',customers:corp}}],error:null})})}},'./mock-store':{}})
 assert.equal((await responseData.getMaintenanceResponses())[0].customer_name,'株式会社合成')
 assert.equal(JSON.stringify(corp),source,'Read projections never mutate customer data')
 const creator=harness('src/components/BillingOccurrenceCreator.tsx',{candidate:{year:2027,round:1,periodStart:'2027-01-01',periodEnd:'2027-12-31',date:'2027-01-01',recipientId:1,amount:1000,method:'invoice'},contract:{project_id:10,maintenance_start_date:'2026-01-01',billing_count:1,billing_method:'請求書',billing_schedule_days:['1月1日']},units:[],recipients:[corp],onSave:()=>{throw Error('Business writes forbidden')},onClose(){}})
 field(creator.render(),'確認内容・備考','対象期間を確認した')
 submit(creator.render())
 const confirmation=nodes(creator.render(),e=>e.props.className==='billing-plan-confirmation')[0]
 assert.ok(confirmation,String(error(creator.render())))
 assert.ok(renderToStaticMarkup(confirmation).includes('請求先：株式会社合成'))
 let writes=0
 const debit=harness('src/components/ManualDebitPlanCreator.tsx',{expanded:true,recipients:[corp],onSave:async()=>{writes++;throw {message:'通信結果が未確認です'}}})
 await submit(debit.render());assert.equal(error(debit.render()),'「請求先」で顧客を選択してください');assert.equal(writes,0)
 nodes(debit.render(),e=>typeof e.type==='function'&&e.type.name==='CustomerPicker')[0].props.onChange('1')
 field(debit.render(),'対象年','2027');field(debit.render(),'対象月','13');await submit(debit.render());assert.ok(String(error(debit.render())).includes('「対象月」'))
 field(debit.render(),'対象月','1');field(debit.render(),'振替予定日','2027-01-25');field(debit.render(),'追加の確認内容・理由','確認した内容')
 await submit(debit.render());assert.equal(writes,1)
 assert.equal(nodes(debit.render(),e=>e.type==='input'&&e.props.type==='date')[0].props.value,'2027-01-25','A failed save must retain the input')
 const customer=harness('src/views/Customers.tsx',{customers:[corp],onReload:()=>{throw Error('Unexpected reload')},onViewDetail(){}},{'../lib/actions':{deleteCustomer:async()=>{throw {message:'削除できませんでした'}}},'../components/Toast':{useToast:()=>()=>{}}})
 nodes(customer.render(),e=>e.props['aria-label']==='株式会社合成の顧客情報を編集')[0].props.onClick()
 nodes(customer.render(),e=>e.type==='button'&&e.props.children==='削除')[0].props.onClick()
 let confirm=nodes(customer.render(),e=>typeof e.type==='function'&&e.type.name==='Confirm')[0]
 assert.ok(confirm.props.message.includes('株式会社合成'));await confirm.props.onConfirm()
 confirm=nodes(customer.render(),e=>typeof e.type==='function'&&e.type.name==='Confirm')[0]
 assert.equal(confirm.props.error.message,'削除できませんでした');assert.equal(confirm.props.busy,false)
 console.log('PASS: shared corporate labels in read-only lists, contact-only labels retained, actionable errors, failed-save input retained and delete failures displayed')
})().catch(e=>{console.error(e);process.exitCode=1})
