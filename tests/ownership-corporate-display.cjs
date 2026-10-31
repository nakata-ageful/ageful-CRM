// Synthetic data only; exercise the actual editors and save callbacks.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..')
function load(file,hooks){file=path.resolve(root,file);const m={exports:{}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {module:m,exports:m.exports,Date,structuredClone,require:n=>{if(n==='react')return hooks??React;if(n==='react/jsx-runtime')return require(n);if(n.endsWith('.css'))return {};if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);if(/\/(actions|data|supabase)$/.test(p))throw Error('Business access forbidden');return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'),hooks)}});return m.exports}
function harness(file,props){const slots=[],refs=[];let pos=0,rpos=0
 const hooks={useId:()=> 'test-id',useEffect:()=>{},useRef(initial){const i=rpos++;return refs[i]??(refs[i]={current:initial})},useState(initial){const i=pos++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>slots[i]=typeof v==='function'?v(slots[i]):v]}}
 const exports=load(file,hooks),Component=Object.values(exports)[0]
 return {render(){pos=0;rpos=0;return Component(props)}}
}

const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
const {customerDisplayName}=load('src/lib/customer-search.ts')
const oldOwner={id:1,name:'旧担当者',company_name:'株式会社旧法人',is_corporate:true}
const newOwner={id:2,name:'新担当者',company_name:'株式会社新法人',is_corporate:true}
assert.equal(customerDisplayName(oldOwner),'株式会社旧法人')
assert.equal(customerDisplayName({...newOwner,is_corporate:false}),'新担当者')
assert.equal(customerDisplayName({...newOwner,company_name:'  '}),'新担当者')
const project={id:10,customer_id:1,project_name:'合成発電所'}
const contract={id:5,project_id:10,billing_method:'請求書',billing_count:1,maintenance_start_date:'2026-01-01'}
const unit={id:'u1',projectId:10,serviceYear:2026,roundLabel:'第1回',method:'請求書',scheduledDate:'2026-12-01',recipientId:1,lifecycle:'planned',issuedOn:null,receivedOn:null,frozenAmount:null,frozenLineItems:null,frozenAt:null,periodStart:null,periodEnd:null,planNote:null,revision:1,collectionState:'pending',plannedAmount:1000}
const snapshot=JSON.stringify({project,contract,unit,oldOwner,newOwner});let saves=[]
const parent=harness('src/components/OwnershipTransferEditor.tsx',{project,contract,customers:[oldOwner,newOwner],units:[unit],initialOwnerId:2,onSave:async v=>saves.push(v)})
const tree=parent.render(),plan=nodes(tree,e=>typeof e.type==='function'&&e.type.name==='OwnershipBillingPlanEditor')[0]
const outer=renderToStaticMarkup(tree)
assert.ok(outer.includes('<strong>株式会社旧法人</strong>'))
assert.ok(outer.includes('変更後の所有者<br/><strong>株式会社新法人</strong>'))
const summary=renderToStaticMarkup(plan.props.reviewSummary)
assert.ok(summary.includes('今後の基本請求先：株式会社新法人'))
const editor=harness('src/components/OwnershipBillingPlanEditor.tsx',{...plan.props,onReview:()=>{}})
let e=editor.render();nodes(e,n=>typeof n.type==='function'&&n.type.name==='CustomerPicker')[0].props.onChange('2')
nodes(editor.render(),n=>n.type==='form')[0].props.onSubmit({preventDefault(){}})
e=editor.render();const final=renderToStaticMarkup(e)
assert.ok(final.includes('請求先：株式会社旧法人 → 株式会社新法人'),final.replace(/<[^>]*>/g,''))
assert.equal(saves.length,0,'Rendering/review must not save')
assert.equal(JSON.stringify({project,contract,unit,oldOwner,newOwner}),snapshot)
const workflow=load('src/components/OwnershipWorkflowPanel.tsx').OwnershipWorkflowPanel
const workflowHtml=renderToStaticMarkup(React.createElement(workflow,{project,customers:[oldOwner,newOwner],onSave:async()=>{},onCreateCustomer:async()=>{},onReloadCustomers:async()=>[]}))
assert.ok(workflowHtml.includes('現在の所有者：株式会社旧法人'))
const app=fs.readFileSync(path.join(root,'src/App.tsx'),'utf8');assert.match(app,/recipientName:id=>\{const recipient=customers.find[\s\S]*?customerDisplayName\(recipient\)/)
console.log('PASS: corporate owner labels in workflow, STEP 1/2/3 and recipient review; personal/fallback names; no writes or identity changes')
