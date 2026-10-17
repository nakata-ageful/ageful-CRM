// Real repository and component callbacks, synthetic storage only. No credentials/network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),crypto=require('node:crypto')
const root=path.resolve(__dirname,'..'),id=n=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`
function moduleFor(file,imports){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,require:n=>{if(n in imports)return imports[n];if(n==='react/jsx-runtime')return require(n);if(n.endsWith('.css'))return{};throw Error('Forbidden import '+n)},Date,Map,Set,Number,Error,structuredClone,crypto});return m.exports}
const row=(n=1,p=1)=>({id:id(n),project_id:p,content:'合成の確認作業',is_completed:false,completed_at:null,revision:1,created_at:'2026-10-17T00:00:00Z',updated_at:'2026-10-17T00:00:00Z'})
const same=(a,b)=>assert.equal(JSON.stringify(a),JSON.stringify(b))
const repo=moduleFor('src/lib/project-todos.ts',{'./supabase':{hasSupabaseEnv:false}})
const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
const text=e=>Array.isArray(e)?e.map(text).join(''):e?.props?text(e.props.children):typeof e==='string'||typeof e==='number'?String(e):''
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()}
function harness(props){const state=[],refs=[],effects=[];let pos=0,rpos=0,initial=true,cleanup
 const hooks={...React,useState(value){const n=pos++;if(!(n in state))state[n]=typeof value==='function'?value():value;return[state[n],v=>{state[n]=typeof v==='function'?v(state[n]):v}]},useRef(value){const n=rpos++;return refs[n]??(refs[n]={current:value})},useEffect(fn){if(initial)effects.push(fn)}}
 const {ProjectTodoPanel}=moduleFor('src/components/ProjectTodoPanel.tsx',{'react':hooks,'../lib/project-todos':repo})
 const h={render(){pos=0;rpos=0;h.tree=ProjectTodoPanel(props);if(initial){initial=false;cleanup=effects[0]()}return h.tree},button(label){return nodes(h.tree,e=>e.type==='button'&&text(e)===label)[0]},area(){return nodes(h.tree,e=>e.type==='textarea')[0]},submit(){return nodes(h.tree,e=>e.type==='form')[0].props.onSubmit({preventDefault(){}})},unmount(){cleanup?.()}};h.render();return h
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
 // Supabase path: scoped pagination > server's default limit, malformed and changing counts fail closed.
 let tableCalls=[],rpcCalls=[],countMode='ok',all=Array.from({length:1201},(_,i)=>row(i+10))
 const client={from(table){assert.equal(table,'project_todos');let start=0,end=0;return{select(_f,opts){assert.equal(opts.count,'exact');return this},eq(k,v){assert.equal(k,'project_id');assert.equal(v,1);return this},order(){return this},async range(a,b){start=a;end=b;tableCalls.push([a,b]);return{data:countMode==='invalid'?[row(1,2)]:all.slice(start,end+1),count:countMode==='changed'&&a>0?1200:all.length,error:null}}}},async rpc(name,args){rpcCalls.push([name,args]);return{data:{...row(),content:args.p_content},error:null}}}
 const hosted=moduleFor('src/lib/project-todos.ts',{'./supabase':{hasSupabaseEnv:true,supabase:client}})
 assert.equal((await hosted.loadProjectTodos(1)).length,1201);assert.equal(tableCalls.length,3)
 countMode='changed';await assert.rejects(hosted.loadProjectTodos(1),/一覧が更新/);countMode='invalid';await assert.rejects(hosted.loadProjectTodos(1),/保存内容/)
 await hosted.saveProjectTodo({id:id(1),projectId:1,revision:null,content:' 新規 ',completed:false});assert.equal(rpcCalls[0][0],'project_todo_write');assert.equal(rpcCalls[0][1].p_content,'新規')
 // Actual UI handlers: no writes on load, blank prevention, duplicate-click lock and complete/edit/reopen.
 let store=[],writes=0,fail='';const save=async change=>{writes++;if(fail)throw Object.assign(Error('合成の通信エラー'),{code:fail});let v=store.find(t=>t.id===change.id);v={...(v??row()),id:change.id,content:change.content,is_completed:change.completed,completed_at:change.completed?'2026-10-17T01:00:00Z':null,revision:(v?.revision??0)+1};store=store.filter(t=>t.id!==v.id).concat(v);return v}
 const h=harness({projectId:1,load:async()=>structuredClone(store),save});await flush();h.render();assert.equal(writes,0);assert.equal(h.button('追加する').props.disabled,true)
 h.area().props.onChange({target:{value:'折返し連絡する'}});h.render();h.submit();h.submit();await flush();h.render();assert.equal(writes,1);assert.ok(text(h.tree).includes('未完了（1件）'))
 h.button('完了にする').props.onClick();await flush();h.render();assert.ok(text(h.tree).includes('完了（1件）'));assert.equal(store[0].is_completed,true)
 h.button('未完了に戻す').props.onClick();await flush();h.render();assert.equal(store[0].is_completed,false)
 h.button('編集').props.onClick();h.render();nodes(h.tree,e=>e.type==='textarea')[1].props.onChange({target:{value:'書類と一緒に連絡する'}});h.render();nodes(h.tree,e=>e.type==='form')[1].props.onSubmit({preventDefault(){}});await flush();h.render();assert.equal(store[0].content,'書類と一緒に連絡する')
 // Response lost after commit: retained draft, no extra row, recovery works even during editing.
 const loss=harness({projectId:1,load:async()=>structuredClone(store),save:async c=>{await save(c);throw Error('応答が途切れました')}});await flush();loss.render();loss.button('編集').props.onClick();loss.render();nodes(loss.tree,e=>e.type==='textarea')[1].props.onChange({target:{value:'応答待ちの編集'}});loss.render();nodes(loss.tree,e=>e.type==='form')[1].props.onSubmit({preventDefault(){}});await flush();loss.render();assert.ok(loss.button('保存結果を再確認'));assert.equal(loss.button('保存結果を再確認').props.disabled,false);loss.button('保存結果を再確認').props.onClick();await flush();loss.render();assert.ok(text(loss.tree).includes('保存できていることを確認'));assert.equal(store.length,1)
 const failure=harness({projectId:1,load:async()=>{throw Error('読込失敗')},save});await flush();failure.render();assert.equal(failure.button('追加する').props.disabled,true);assert.ok(text(failure.tree).includes('読み込めません'))
 const readonly=harness({projectId:1,readOnly:true,load:async()=>structuredClone(store),save});await flush();readonly.render();assert.equal(readonly.button('追加する'),undefined);assert.equal(readonly.button('完了にする').props.disabled,true)
 // ProjectDetail only mounts independent Todo panel when selected; billing/maintenance callbacks unchanged.
 const detail=fs.readFileSync(path.join(root,'src/views/ProjectDetail.tsx'),'utf8');assert.ok(/tab\s*===\s*'Todo'/.test(detail));assert.ok(/key=\{project.id\} projectId=\{project.id\} readOnly=\{readOnly\}/.test(detail))
 assert.ok(!fs.readFileSync(path.join(root,'src/lib/project-todos.ts'),'utf8').includes("from './actions'"))
 console.log('PASS: Todo repository scope/pagination/validation, actual add/complete/reopen/edit handlers, duplicate click, response-loss recovery during edit, load-error and archived read-only; no real DB or business writes')
})().catch(e=>{console.error(e);process.exitCode=1})
