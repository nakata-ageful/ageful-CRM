// Real repository and component callbacks, synthetic storage only. No credentials/network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'..'),id=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`
const timers=new Map();let timerId=0
function moduleFor(file,imports){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,require:n=>{if(n in imports)return imports[n];if(n==='react/jsx-runtime')return require(n);if(n==='./FormError')return moduleFor('src/components/FormError.tsx',{'react':React,'../lib/form-error':moduleFor('src/lib/form-error.ts',{})});if(n==='./mock-store')return {projectStore:{getById:()=>undefined}};if(n.endsWith('.css'))return{};throw Error('Forbidden import '+n)},Date,Map,Set,Number,Error,structuredClone,crypto,setInterval:fn=>{timers.set(++timerId,fn);return timerId},clearInterval:id=>timers.delete(id)});return m.exports}
const row=(n=1,p=1)=>({id:id(n),project_id:p,content:'合成の確認作業',is_completed:false,completed_at:null,revision:1,created_at:'2026-10-17T00:00:00Z',updated_at:'2026-10-17T00:00:00Z'})
const same=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b))
const repo=moduleFor('src/lib/project-todos.ts',{'./supabase':{hasSupabaseEnv:false}})
const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
const text=e=>typeof e?.type==='function'&&e.type.name==='FormError'?String(e.props.message??''):Array.isArray(e)?e.map(text).join(''):e?.props?text(e.props.children):typeof e==='string'||typeof e==='number'?String(e):''
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
function harness(props){const state=[],refs=[],effects=[];let pos=0,rpos=0,initial=true,cleanup
 const hooks={...React,useState(value){const n=pos++;if(!(n in state))state[n]=typeof value==='function'?value():value;return[state[n],v=>{state[n]=typeof v==='function'?v(state[n]):v}]},useRef(value){const n=rpos++;return refs[n]??(refs[n]={current:value})},useEffect(fn){if(initial)effects.push(fn)}}
 const {ProjectTodoPanel}=moduleFor('src/components/ProjectTodoPanel.tsx',{'react':hooks,'../lib/project-todos':repo})
 const h={render(){pos=0;rpos=0;h.tree=ProjectTodoPanel(props);if(initial){initial=false;cleanup=effects.map(fn=>fn())}return h.tree},button(label){return nodes(h.tree,e=>e.type==='button'&&text(e)===label)[0]},area(){return nodes(h.tree,e=>e.type==='textarea')[0]},submit(){return nodes(h.tree,e=>e.type==='form')[0].props.onSubmit({preventDefault(){}})},unmount(){cleanup?.forEach(fn=>fn?.())}};h.render();return h
}
;(async()=>{
 let t=await repo.saveProjectTodo({id:id(1),projectId:1,revision:null,content:' 書類を送る ',completed:false});assert.equal(t.content,'書類を送る')
 t=await repo.saveProjectTodo({id:id(1),projectId:1,revision:1,content:t.content,completed:true});assert.equal(t.is_completed,true)
 same(await repo.saveProjectTodo({id:id(1),projectId:1,revision:null,content:'書類を送る',completed:false}),t)
 await assert.rejects(repo.saveProjectTodo({id:id(1),projectId:1,revision:null,content:'別の内容',completed:false}),/別のTodo/)
 await assert.rejects(repo.saveProjectTodo({id:id(1),projectId:1,revision:1,content:'古い編集',completed:false}),/更新/)
 t=await repo.saveProjectTodo({id:id(1),projectId:1,revision:2,content:'内容を編集',completed:false});assert.equal(t.completed_at,null);assert.equal(t.revision,3)
 assert.equal((await repo.loadProjectTodos(2)).length,0);assert.equal((await repo.loadProjectTodos(1)).length,1)
 assert.throws(()=>repo.parseProjectTodo(row(1,2),1),/保存内容/);assert.throws(()=>repo.validateTodoChange({id:id(9),projectId:1,revision:null,content:' ',completed:false}),/2000/)

 assert.equal(repo.validTodoDueDate('2028-02-29'),true);for(const d of ['2026-02-29','2026-02-30','0000-01-01','2026-1-1','infinity'])assert.equal(repo.validTodoDueDate(d),false,d)
 const dated=await repo.saveProjectTodo({id:id(70),projectId:1,revision:null,content:'期日のある作業',completed:false,dueDate:'2026-11-01'});assert.equal(dated.due_date,'2026-11-01')
 const changed=await repo.saveProjectTodo({id:id(70),projectId:1,revision:1,content:dated.content,completed:false,dueDate:'2026-10-30'});assert.equal(changed.due_date,'2026-10-30')
 assert.equal((await repo.saveProjectTodo({id:id(70),projectId:1,revision:null,content:dated.content,completed:false,dueDate:'2026-11-01'})).due_date,'2026-10-30','Creation retry must not revert later deadline edits')
 await assert.rejects(repo.saveProjectTodo({id:id(70),projectId:1,revision:null,content:dated.content,completed:false,dueDate:'2026-11-02'}),/別のTodo/)
 assert.deepEqual([row(74),{...row(72),due_date:'2026-11-03'},{...row(73),due_date:'2026-10-30'}].sort(repo.compareTodoDueDate).map(t=>t.id),[id(73),id(72),id(74)])
 // Supabase path: scoped pagination > server's default limit, malformed and changing counts fail closed.
 let tableCalls=[],rpcCalls=[],countMode='ok',all=Array.from({length:1201},(_,i)=>row(i+10))
 const client={from(table){assert.equal(table,'project_todos');let start=0,end=0;return{select(_f,opts){assert.equal(opts.count,'exact');return this},eq(k,v){assert.equal(k,'project_id');assert.equal(v,1);return this},order(){return this},async range(a,b){start=a;end=b;tableCalls.push([a,b]);return{data:countMode==='invalid'?[row(1,2)]:all.slice(start,end+1),count:countMode==='changed'&&a>0?1200:all.length,error:null}}}},async rpc(name,args){rpcCalls.push([name,args]);return{data:{...row(),content:args.p_content,...(name==='project_todo_write_with_due_date'?{due_date:args.p_due_date}:{})},error:null}}}
 const hosted=moduleFor('src/lib/project-todos.ts',{'./supabase':{hasSupabaseEnv:true,supabase:client}})
 assert.equal((await hosted.loadProjectTodos(1)).length,1201);assert.equal(tableCalls.length,3)
 countMode='changed';await assert.rejects(hosted.loadProjectTodos(1),/一覧が更新/);countMode='invalid';await assert.rejects(hosted.loadProjectTodos(1),/保存内容/)
 await hosted.saveProjectTodo({id:id(1),projectId:1,revision:null,content:' 新規 ',completed:false});assert.equal(rpcCalls[0][0],'project_todo_write');assert.equal(rpcCalls[0][1].p_content,'新規')
 await hosted.saveProjectTodo({id:id(1),projectId:1,revision:1,content:'期日を設定',completed:false,dueDate:'2026-11-01'});assert.equal(rpcCalls[1][0],'project_todo_write_with_due_date');assert.equal(rpcCalls[1][1].p_due_date,'2026-11-01')
 // Actual UI handlers: no writes on load, blank prevention, duplicate-click lock and complete/edit/reopen.
 let store=[],writes=0,fail='';const save=async change=>{writes++;if(fail)throw Object.assign(Error('合成の通信エラー'),{code:fail});let v=store.find(t=>t.id===change.id);v={...(v??row()),id:change.id,content:change.content,due_date:change.dueDate===undefined?v?.due_date??null:change.dueDate,is_completed:change.completed,completed_at:change.completed?'2026-10-17T01:00:00Z':null,revision:(v?.revision??0)+1};store=store.filter(t=>t.id!==v.id).concat(v);return v}
 const h=harness({projectId:1,load:async()=>structuredClone(store),save});await flush();h.render();assert.equal(writes,0);assert.equal(h.button('追加する').props.disabled,true)
 h.area().props.onChange({target:{value:'折返し連絡する'}});h.render();nodes(h.tree,e=>e.type==='input'&&e.props.type==='date')[0].props.onChange({target:{value:'2026-11-01'}});h.render();h.submit();h.submit();await flush();h.render();assert.equal(writes,1);assert.equal(store[0].due_date,'2026-11-01');assert.ok(!text(h.tree).includes('追加日'));assert.ok(text(h.tree).includes('期日'));assert.ok(text(h.tree).includes('未完了（1件）'))
 h.button('完了にする').props.onClick();await flush();h.render();assert.ok(text(h.tree).includes('完了（1件）'));assert.equal(store[0].is_completed,true)
 assert.equal(h.button('未完了に戻す'),undefined,'Completed tasks are hidden in the default incomplete list');h.button('完了（1件）').props.onClick();h.render()
 h.button('未完了に戻す').props.onClick();await flush();h.render();assert.equal(store[0].is_completed,false)
 h.button('未完了（1件）').props.onClick();h.render()
 h.button('編集').props.onClick();h.render();nodes(h.tree,e=>e.type==='textarea')[1].props.onChange({target:{value:'書類と一緒に連絡する'}});h.render();nodes(h.tree,e=>e.type==='form')[1].props.onSubmit({preventDefault(){}});await flush();h.render();assert.equal(store[0].content,'書類と一緒に連絡する');assert.equal(store[0].due_date,'2026-11-01')
 h.button('編集').props.onClick();h.render();nodes(h.tree,e=>e.type==='input'&&e.props.type==='date')[1].props.onChange({target:{value:''}});h.render();nodes(h.tree,e=>e.type==='form')[1].props.onSubmit({preventDefault(){}});await flush();h.render();assert.equal(store[0].due_date,null)
 // Response lost after commit: retained draft, no extra row, recovery works even during editing.
 const loss=harness({projectId:1,load:async()=>structuredClone(store),save:async c=>{await save(c);throw Error('応答が途切れました')}});await flush();loss.render();loss.button('編集').props.onClick();loss.render();assert.equal(loss.button('完了（0件）').props.disabled,true,'Never hide an unsaved edit by switching filters');nodes(loss.tree,e=>e.type==='textarea')[1].props.onChange({target:{value:'応答待ちの編集'}});loss.render();nodes(loss.tree,e=>e.type==='form')[1].props.onSubmit({preventDefault(){}});await flush();loss.render();assert.ok(loss.button('保存結果を再確認'));assert.equal(loss.button('完了（0件）').props.disabled,true);assert.equal(loss.button('保存結果を再確認').props.disabled,false);loss.button('保存結果を再確認').props.onClick();await flush();loss.render();assert.ok(text(loss.tree).includes('保存できていることを確認'));assert.equal(store.length,1)
 const failure=harness({projectId:1,load:async()=>{throw Error('読込失敗')},save});await flush();failure.render();assert.equal(failure.button('追加する').props.disabled,true);assert.ok(text(failure.tree).includes('読み込めません'))
 const readonly=harness({projectId:1,readOnly:true,load:async()=>structuredClone(store),save});await flush();readonly.render();assert.equal(readonly.button('追加する'),undefined);assert.equal(readonly.button('完了にする').props.disabled,true)
 const completed=harness({projectId:1,initialCompleted:true,load:async()=>[{...row(8),is_completed:true,completed_at:'2026-10-17T01:00:00Z'}],save});await flush();completed.render();assert.ok(completed.button('未完了に戻す'));assert.equal(completed.button('完了にする'),undefined)

 // The project list uses the exact same overdue rule as Dashboard; rendering never saves.
 const today=repo.todoTodayInJapan(),shift=d=>new Date(Date.parse(today+'T00:00:00Z')+d*86400000).toISOString().slice(0,10)
 const dueRows=[{...row(91),content:'昨日までの未完了',due_date:shift(-1)},{...row(92),content:'本日期日',due_date:today},{...row(93),content:'今後の期日',due_date:shift(1)},{...row(94),content:'期日なし',due_date:null},{...row(95),content:'過去の完了済み',due_date:shift(-1),is_completed:true,completed_at:today+'T00:00:00Z'}]
 let dueWrites=0;const dueBefore=JSON.stringify(dueRows),deadline=harness({projectId:1,load:async()=>dueRows,save:async()=>{dueWrites++;throw Error('Rendering cannot save')}});await flush();deadline.render()
 assert.equal(nodes(deadline.tree,e=>e.type==='span'&&e.props.className==='project-todo-overdue-label').length,1)
 assert.ok(text(nodes(deadline.tree,e=>e.type==='td'&&e.props.className?.includes('project-todo-overdue'))[0]).includes(shift(-1)+'期限超過'))
 deadline.button('完了（1件）').props.onClick();deadline.render();assert.ok(!text(deadline.tree).includes('期限超過'));assert.equal(dueWrites,0);assert.equal(JSON.stringify(dueRows),dueBefore)
 const timerCount=timers.size;deadline.unmount();assert.equal(timers.size,timerCount-1,'Leaving the project stops its date timer')
 // ProjectDetail only mounts independent Todo panel when selected; billing/maintenance callbacks unchanged.
 const detail=fs.readFileSync(path.join(root,'src/views/ProjectDetail.tsx'),'utf8');assert.ok(/tab\s*===\s*'Todo'/.test(detail));assert.ok(/key=\{project.id\} projectId=\{project.id\} readOnly=\{readOnly\}/.test(detail))
 assert.ok(!fs.readFileSync(path.join(root,'src/lib/project-todos.ts'),'utf8').includes("from './actions'"))
 console.log('PASS: Todo repository scope/pagination/validation, actual add/complete/reopen/edit handlers, duplicate click, response-loss recovery during edit, load-error and archived read-only; no real DB or business writes')
})().catch(e=>{console.error(e);process.exitCode=1})
