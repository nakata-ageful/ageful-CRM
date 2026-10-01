// Offline search and actual-view rendering only. No DB/network or saves.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'..');
const transpile=source=>ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const mod={exports:{}};vm.runInNewContext(transpile(fs.readFileSync(path.join(root,'src/lib/project-search.ts'),'utf8')),{exports:mod.exports,module:mod});
const {projectMatchesSearch}=mod.exports;
const first={id:1,customer_id:1,project_no:'ABC１２３',project_name:'旧案件名',plant_name:'度会郡大紀町',customer_name:'検索テスト顧客',company_name:'検証会社',site_prefecture:'三重県',site_address:'大紀町錦',search_text:'古い検索用データ',created_at:'2026-01-01'};
for(const query of ['度','会郡','大紀','紀町','度会郡大紀町',' 度会 ','度 会',''])assert.equal(projectMatchesSearch(first,query),true,query);
assert.equal(projectMatchesSearch(first,'渡会'),false,'Different kanji must not alias');
assert.equal(projectMatchesSearch({...first,plant_name:'渡会郡'},'度会'),false);
assert.equal(projectMatchesSearch({...first,plant_name:'度\u200b会郡'},'度会'),true);
assert.equal(projectMatchesSearch({...first,plant_name:null,project_name:'五條市西阿田',search_text:undefined},'西阿'),true,'Fallback displayed name');
for(const query of ['abc123','検証会社','三重','錦','古い検索'])assert.equal(projectMatchesSearch(first,query),true,'Existing broad search retained');
assert.equal(projectMatchesSearch(first,'伊勢市'),false);

let currentQuery='';
const viewModule={exports:{}};
const noAction=()=>{throw Error('No data writes allowed')};
vm.runInNewContext(transpile(fs.readFileSync(path.join(root,'src/views/Projects.tsx'),'utf8')),{
 exports:viewModule.exports,module:viewModule,
 sessionStorage:{getItem:k=>k==='projects_search'?currentQuery:null,setItem:noAction},
 require:n=>{
  if(n==='react'||n==='react/jsx-runtime')return require(n);
  if(n==='../lib/project-search')return mod.exports;
  if(n==='../components/Toast')return{useToast:()=>noAction};
  if(n==='../lib/actions')return{createCustomer:noAction,createProject:noAction,deleteProject:noAction};
  if(n==='../lib/utils')return{dateInputRange:()=>({})};
  if(n==='../components/Modal')return{Modal:()=>{throw Error('No registration modal in search test')}};
  throw Error(`Unexpected dependency: ${n}`);
 },
});
const projects=[first,{...first,id:2,project_name:'別案件',plant_name:'渡会郡',customer_name:'別顧客',company_name:null,site_address:null},{...first,id:3,project_name:'別案件',plant_name:'伊勢市',customer_name:'別顧客',company_name:null,site_address:null}];
const original=JSON.stringify(projects);
for(const [query,expected,excluded] of [['大紀','度会郡大紀町','渡会郡'],['度会','度会郡大紀町','渡会郡'],['渡会','渡会郡','度会郡大紀町']]){
 currentQuery=query;
 const html=renderToStaticMarkup(React.createElement(viewModule.exports.Projects,{projects,customers:[],onReload:noAction,onViewDetail:noAction}));
 assert(html.includes(`<strong>${expected}</strong>`));assert(!html.includes(`<strong>${excluded}</strong>`));
}
currentQuery='見つからない文字';
assert(renderToStaticMarkup(React.createElement(viewModule.exports.Projects,{projects,customers:[],onReload:noAction,onViewDetail:noAction})).includes('該当する案件がありません'));
assert.equal(JSON.stringify(projects),original);
console.log('PASS: actual Projects view, name substrings, stale/empty broad text, different kanji, existing field searches, no data mutations.');
