// Actual read repository + UI/navigation callbacks, synthetic data only; no network or business writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const root=path.resolve(__dirname,'..'),id=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`
const row=n=>({id:id(n),project_id:n%2+1,content:'架空の確認作業'+n,is_completed:false,completed_at:null,revision:1,created_at:'2026-10-17T00:00:00Z',updated_at:'2026-10-17T00:00:00Z',projects:{id:n%2+1,project_name:'合成発電所'+(n%2+1),plant_name:null,archived_at:null}})
function load(file,imports){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,require:n=>{if(n in imports)return imports[n];if(n==='react/jsx-runtime')return require(n);if(n==='./mock-store')return {projectStore:{getById:()=>undefined}};throw Error('Forbidden import '+n)},Date,Map,Set,Number,Error,structuredClone});return m.exports}
const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
const text=e=>Array.isArray(e)?e.map(text).join(''):e?.props?text(e.props.children):typeof e==='string'?e:''
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
const ordering=load('src/lib/project-todos.ts',{'./supabase':{hasSupabaseEnv:false}})
function harness(props){const states=[],refs=[],effects=[];let pos=0,epos=0;const callbacks=[]
 const hooks={...React,useState(v){const n=pos++;if(!(n in states))states[n]=typeof v==='function'?v():v;return[states[n],v=>{states[n]=typeof v==='function'?v(states[n]):v}]},useEffect(fn,deps){const n=epos++,old=effects[n];if(!old||deps.some((x,i)=>x!==old.deps[i])){old?.cleanup?.();effects[n]={deps};callbacks.push(()=>{effects[n].cleanup=fn()})}}}
 const {DashboardTodoPanel}=load('src/components/DashboardTodoPanel.tsx',{'react':hooks,'../lib/project-todos':{compareTodoDueDate:ordering.compareTodoDueDate,loadDashboardProjectTodos:()=>{throw Error('Inject synthetic reader')}}})
 const h={render(){pos=0;epos=0;h.tree=DashboardTodoPanel(props);for(const fn of callbacks.splice(0))fn();return h.tree},refresh(){nodes(h.tree,e=>e.type==='button'&&text(e)==='再読み込み')[0].props.onClick()},unmount(){effects.forEach(e=>e.cleanup?.())}};h.render();return h
}
;(async()=>{
 let mode='ok',calls=0,rpc=0;const all=Array.from({length:1201},(_,i)=>row(i+1))
 const client={
  from(table){assert.equal(table,'project_todos');return{
   select(s,o){assert.ok(s.includes('projects!inner(id,project_name,plant_name,archived_at)'));assert.equal(o.count,'exact');return this},
   eq(){throw Error('Dashboard must read both states')},is(k,v){assert.equal(k,'projects.archived_at');assert.equal(v,null);return this},order(k){assert.ok(['created_at','id'].includes(k));return this},
   async range(a,b){calls++;if(mode==='denied')return{error:Error('取得不可')};return{data:mode==='bad'?[{...row(1),projects:{...row(1).projects,archived_at:'2026-01-01'}}]:mode==='short'?[]:all.slice(a,b+1),count:mode==='drift'&&a>0?all.length+1:all.length,error:null}}
  }},rpc(){rpc++;throw Error('Dashboard must not write')}
 }
 const repo=load('src/lib/project-todos.ts',{'./supabase':{hasSupabaseEnv:true,supabase:client}})
 all[1200]={...all[1200],is_completed:true,completed_at:'2026-10-17T01:00:00Z'}
 all[1].due_date='2026-11-03';all[2].due_date='2026-10-30';
 const original=JSON.stringify(all),result=await repo.loadDashboardProjectTodos();assert.equal(result.length,1201);assert.equal(calls,3);assert.equal(result[0].project_name,'合成発電所2');assert.equal(result[1200].is_completed,true);assert.equal(JSON.stringify(all),original);assert.equal(rpc,0)
 for(const [value,re] of [['bad',/一覧を確認/],['short',/最後まで/],['drift',/一覧が更新/],['denied',/取得不可/]]){mode=value;await assert.rejects(repo.loadDashboardProjectTodos(),re)}
 const mock=load('src/lib/project-todos.ts',{'./supabase':{hasSupabaseEnv:false},'./mock-store':{projectStore:{getById:n=>n===1?{id:1,project_name:'合成の使用中発電所'}:n===2?{id:2,project_name:'合成の保管発電所',archived_at:'2026-10-17'}:undefined}}})
 for(const n of [1,2,3])await mock.saveProjectTodo({id:id(n),projectId:n,revision:null,content:'架空作業'+n,completed:false})
 assert.equal((await mock.loadDashboardProjectTodos()).length,1);await mock.saveProjectTodo({id:id(1),projectId:1,revision:1,content:'架空作業1',completed:true});assert.equal((await mock.loadDashboardProjectTodos())[0].is_completed,true)
 await mock.saveProjectTodo({id:id(1),projectId:1,revision:2,content:'架空作業1',completed:false});assert.equal((await mock.loadDashboardProjectTodos())[0].is_completed,false)
 let reads=0,fail=false;const nav=[],panelRows=[...result.slice(0,12),result[1200]],h=harness({onViewTodo:(n,done)=>nav.push([n,done]),load:async()=>{reads++;if(fail)throw Error('通信失敗');return panelRows}})
 assert.ok(text(h.tree).includes('読み込み中'));assert.ok(!text(h.tree).includes('タスクはありません'));await flush();h.render();assert.equal(reads,1);assert.ok(text(h.tree).includes('未完了（12件）'));assert.ok(text(h.tree).includes('完了（1件）'));assert.equal(nodes(h.tree,e=>e.type==='button'&&text(e)==='Todoへ').length,12,'No eight-row truncation')
 nodes(h.tree,e=>e.type==='button'&&text(e)==='Todoへ')[0].props.onClick();assert.deepEqual(nav,[[2,false]]);assert.deepEqual(nodes(h.tree,e=>e.type==='tbody')[0].props.children.slice(0,3).map(e=>e.key),[id(3),id(2),id(1)]);assert.ok(!text(h.tree).includes('追加日'));assert.ok(text(h.tree).includes('2026-10-30'));assert.equal(nodes(h.tree,e=>e.type==='tbody')[0].props.children[0].props.children[0].props.children.props.children,'合成発電所2');assert.equal(reads,1,'Navigation does not save or refresh global business data')
 nodes(h.tree,e=>e.type==='button'&&text(e)==='完了（1件）')[0].props.onClick();h.render();assert.equal(nodes(h.tree,e=>e.type==='button'&&text(e)==='Todoへ').length,1);assert.ok(text(h.tree).includes('架空の確認作業1201'));assert.ok(!text(h.tree).includes('架空の確認作業2'));assert.ok(text(h.tree).includes('完了日'));assert.equal(reads,1,'Switching status is read-only and makes no extra requests')
 nodes(h.tree,e=>e.type==='button'&&text(e)==='Todoへ')[0].props.onClick();assert.deepEqual(nav.at(-1),[2,true],'Completed dashboard rows open the completed project list')
 nodes(h.tree,e=>e.type==='button'&&text(e)==='未完了（12件）')[0].props.onClick();h.render();assert.equal(nodes(h.tree,e=>e.type==='button'&&text(e)==='Todoへ').length,12)
 fail=true;h.refresh();h.render();await flush();h.render();assert.ok(text(h.tree).includes('読み込めません'));assert.ok(!text(h.tree).includes('（12件）'));assert.ok(!text(h.tree).includes('タスクはありません'))
 fail=false;h.refresh();h.render();await flush();h.render();assert.ok(text(h.tree).includes('（12件）'));assert.equal(reads,3)
 const empty=harness({onViewTodo(){},load:async()=>[]});await flush();empty.render();assert.ok(text(empty.tree).includes('未完了のタスクはありません'))
 // Cancelled reads after navigation never update an unmounted Dashboard.
 let finish;const stale=harness({onViewTodo(){},load:()=>new Promise(resolve=>{finish=resolve})});stale.unmount();finish(result);await flush();stale.render();assert.ok(text(stale.tree).includes('読み込み中'))
 // Execute the real App navigation attribute and verify exact Todo destination.
 const app=ts.createSourceFile('App.tsx',fs.readFileSync(path.join(root,'src/App.tsx'),'utf8'),ts.ScriptTarget.Latest,true);let attr
 function visit(n){if(ts.isJsxAttribute(n)&&n.name.getText(app)==='onViewTodo')attr=n;ts.forEachChild(n,visit)}visit(app);assert.ok(attr)
 const ctx={exports:{},navToProjectDetail:(...args)=>nav.push(args)};vm.runInNewContext(ts.transpileModule('exports.go='+attr.initializer.expression.getText(app),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,ctx);ctx.exports.go(17,true);assert.deepEqual(nav.at(-1),[17,'Todo',true])
 const detail=ts.createSourceFile('ProjectDetail.tsx',fs.readFileSync(path.join(root,'src/views/ProjectDetail.tsx'),'utf8'),ts.ScriptTarget.Latest,true);let tabs
 function find(n){if(ts.isVariableDeclaration(n)&&n.name.getText(detail)==='TABS')tabs=n.initializer;ts.forEachChild(n,find)}find(detail)
 const tabCtx={exports:{}};vm.runInNewContext('exports.tabs='+tabs.getText(detail),tabCtx);assert.equal(tabCtx.exports.tabs.at(-1),'Todo');assert.equal(tabCtx.exports.tabs.length,11)
 console.log('PASS: dashboard reads 1201 active-project tasks across both states under existing RLS; incomplete default/completed switching, exact counts, completed dates, archive exclusion, no extra requests on filters, navigation/reload/error/empty/cancelled reads and far-right Todo; no real DB writes')
})().catch(e=>{console.error(e);process.exitCode=1})
