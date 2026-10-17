// Real project modal, synthetic state and recording action stubs only. No DB/network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react')
const root=path.resolve(__dirname,'..'),state=[],refs=[],cache=new Map(),customers=[],projects=[]
let cursor=0,refCursor=0,failProject=false,reloads=0
const hooks={...React,useState(v){const i=cursor++;if(!(i in state))state[i]=typeof v==='function'?v():v;return[state[i],v=>state[i]=typeof v==='function'?v(state[i]):v]},useRef(v){return refs[refCursor++]??(refs[refCursor-1]={current:v})}}
const actions={async createCustomer(input){customers.push(structuredClone(input));return {id:91,...input}},async createProject(input,key){projects.push({input:structuredClone(input),key});if(failProject)throw Error('合成の保存失敗');return {id:92,...input}},deleteProject(){throw Error('Deletion forbidden')}}
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m)
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Date,Intl,Set,Map,crypto:{randomUUID:()=> 'synthetic-operation-key'},sessionStorage:{getItem:()=>null,setItem(){throw Error('Unexpected session write')}},require:n=>{
  if(n==='react')return hooks;if(n==='react/jsx-runtime')return require(n);if(n==='../lib/actions')return actions;if(n==='../components/Toast')return {useToast:()=>()=>{}};if(n.endsWith('.css'))return {};if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);if(/\/(supabase|data|mock-store)$/.test(p))throw Error('Business data access forbidden');return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'))
 }});return m.exports}
const {Projects}=load('src/views/Projects.tsx'),nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):e?.props?[...(p(e)?[e]:[]),...nodes(e.props.children,p)]:[],text=e=>Array.isArray(e)?e.map(text).join(''):e?.props?text(e.props.children):typeof e==='string'?e:''
const existing=[{id:8,name:'架空の既存顧客',is_corporate:false}],before=JSON.stringify(existing),props={projects:[],customers:existing,onReload:()=>reloads++,onViewDetail(){}}
let tree;const draw=()=>{cursor=0;refCursor=0;return tree=Projects(props)},button=s=>nodes(tree,e=>e.type==='button'&&text(e)===s)[0],radio=s=>nodes(nodes(tree,e=>e.type==='label'&&text(e)===s)[0],e=>e.type==='input')[0]
const input=s=>nodes(nodes(tree,e=>e.type==='label'&&text(e)===s)[0],e=>e.type==='input')[0]
const fill=(s,value)=>{input(s).props.onChange({target:{value}});draw()},choose=s=>{radio(s).props.onChange();draw()},save=async()=>{await button('登録する').props.onClick();draw()}
;(async()=>{
 draw();button('＋ 新規案件登録').props.onClick();draw();choose('新規顧客を作成')
 assert.ok(text(tree).includes('個人または法人を選んでから'))
 assert.equal(input('顧客名（個人名）'),undefined);assert.equal(input('担当者名'),undefined)
 fill('発電所名','合成の発電所');await save();assert.ok(text(tree).includes('個人または法人を選んでください'));assert.equal(customers.length,0);assert.equal(projects.length,0)
 choose('法人');assert.ok(input('会社名')&&input('会社名フリガナ')&&input('担当者名')&&input('担当者フリガナ'));assert.equal(input('顧客名（個人名）'),undefined)
 fill('担当者名','検証 太郎');await save();assert.ok(text(tree).includes('会社名は必須'));assert.equal(customers.length,0)
 fill('会社名',' 検証株式会社 ');fill('担当者名','');await save();assert.ok(text(tree).includes('担当者名は必須'));assert.equal(customers.length,0)
 fill('担当者名',' 検証 太郎 ');fill('会社名フリガナ','ケンショウカブシキガイシャ');fill('担当者フリガナ','ケンショウ タロウ');fill('電話番号','03-0000-0000');fill('メール','test@example.com')
 failProject=true;await save();assert.equal(customers.length,1);assert.equal(customers[0].name,'検証 太郎');assert.equal(customers[0].is_corporate,true);assert.equal(customers[0].company_name,'検証株式会社');assert.equal(customers[0].name_kana,'ケンショウ タロウ');assert.equal(customers[0].company_name_kana,'ケンショウカブシキガイシャ');assert.ok(text(tree).includes('合成の保存失敗'))
 failProject=false;await save();assert.equal(customers.length,1,'Retry after project failure reuses successful customer ID');assert.equal(projects.at(-1).input.customer_id,91);assert.equal(projects.at(-1).input.plant_name,'合成の発電所');assert.equal(projects[0].key,projects[1].key);assert.equal(reloads,1)
 button('＋ 新規案件登録').props.onClick();draw();choose('新規顧客を作成');assert.ok(text(tree).includes('個人または法人を選んでから'),'Each fresh registration asks for type')
 choose('法人');fill('会社名','個人に残さない会社');fill('会社名フリガナ','カイシャ');choose('個人');assert.ok(input('顧客名（個人名）')&&input('フリガナ'));assert.equal(input('会社名'),undefined);assert.equal(input('担当者名'),undefined)
 fill('顧客名（個人名）','検証 花子');fill('フリガナ','ケンショウ ハナコ');fill('発電所名','合成の個人発電所');await save();assert.equal(customers.at(-1).is_corporate,false);assert.equal(customers.at(-1).company_name,'');assert.equal(customers.at(-1).company_name_kana,'');assert.equal(customers.at(-1).name,'検証 花子')
 const count=customers.length;button('＋ 新規案件登録').props.onClick();draw();fill('発電所名','合成の既存顧客発電所');await save();assert.equal(customers.length,count,'Existing customer path never creates a customer');assert.equal(projects.at(-1).input.customer_id,8)
 assert.equal(JSON.stringify(existing),before)
 console.log('PASS: explicit customer type before entry, corporate company/contact/kana payloads, required-field validation before writes, individual fields and clearing, existing customer path and retry ID preservation; synthetic only')
})().catch(e=>{console.error(e);process.exitCode=1})
