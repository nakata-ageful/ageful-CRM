// Synthetic inputs only: no real customers, network or authentication.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server')
const root=path.resolve(__dirname,'..')
function load(file,overrides={}){file=path.resolve(root,file);const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,Intl,Set,Map,require:n=>{if(n in overrides)return overrides[n];if(n==='react')return React;if(n==='react/jsx-runtime')return require(n);if(n.endsWith('.css'))return {};if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'),overrides)}});return m.exports}
const {sortCustomersByKana,searchCustomers}=load('src/lib/customer-search.ts')
const customers=[{id:8,name:'未定',is_corporate:false},{id:7,name:'未定',is_corporate:false},
 {id:5,name:'同名 担当',company_name:'株式会社青空',company_name_kana:'アオゾラ',name_kana:'ンン',is_corporate:true},
 {id:4,name:'同名 担当',company_name:'株式会社風',company_name_kana:'カゼ',name_kana:'アア',is_corporate:true},
 {id:3,name:'個人',name_kana:'いとう',is_corporate:false},
 {id:2,name:'末尾',company_name:'読未登録',name_kana:'アア',is_corporate:true},
 {id:9,name:'別 個人',name_kana:'ｱｵｿﾞﾗ',is_corporate:false}]
const before=JSON.stringify(customers),sorted=sortCustomersByKana(customers)
assert.equal(sorted.length,7);assert.equal(JSON.stringify(customers),before)
assert.deepEqual(Array.from(sorted.slice(0,4),c=>c.id),[5,9,3,4])
assert.deepEqual(Array.from(sorted.slice(4),c=>c.id).sort((a,b)=>a-b),[2,7,8]);assert.ok(sorted.findIndex(c=>c.id===7)<sorted.findIndex(c=>c.id===8))
assert.deepEqual(Array.from(searchCustomers(customers,'あおぞら'),c=>c.id),[5,9])
const {emptyCustomerInput,validateCustomerRegistration}=load('src/lib/customer-registration.ts')
const corp={...emptyCustomerInput,name:'担当者',is_corporate:true,company_name:'株式会社青空',company_name_kana:' アオゾラ ',name_kana:'タントウ',phone:'090-1234-5678',notes:'保持する備考'}
assert.equal(validateCustomerRegistration(corp).company_name_kana,'アオゾラ')
assert.equal(validateCustomerRegistration({...corp,is_corporate:false}).company_name_kana,'')
assert.equal(validateCustomerRegistration({...corp,email:'旧形式のメール'},{email:'旧形式のメール'}).email,'旧形式のメール','Kana-only edits must not reject an unchanged legacy email')
assert.throws(()=>validateCustomerRegistration({...corp,email:'別の不正メール'},{email:'旧形式のメール'}),/メール/)
const {CustomerFields}=load('src/components/CustomerFields.tsx')
const text=renderToStaticMarkup(React.createElement(CustomerFields,{value:corp,onChange(){}}))
for(const s of ['種別','会社名','会社名フリガナ','担当者名','担当者フリガナ','電話番号','メールアドレス','郵便番号','住所','備考'])assert.ok(text.includes(s),s)
assert.ok(text.indexOf('会社名フリガナ')<text.indexOf('担当者名'))
assert.ok(text.indexOf('担当者フリガナ')<text.indexOf('電話番号'))
let selected=[]
const {Customers}=load('src/views/Customers.tsx',{'../lib/actions':{},'../components/Toast':{useToast:()=>()=>{}}})
const rendered=renderToStaticMarkup(React.createElement(Customers,{customers,onReload(){},onViewDetail:id=>selected.push(id)}))
assert.ok(rendered.includes('<th>顧客名</th>'));assert.ok(!rendered.includes('<th>種別</th>'));assert.ok(!rendered.includes('<th>会社名</th>'))
assert.equal((rendered.match(/class="clickable-row"/g)||[]).length,7,'Do not group different customer IDs by contact name or 未定')
assert.ok(rendered.includes('customer-phone'));assert.ok(rendered.includes('株式会社青空')&&rendered.includes('株式会社風'))
// Execute the actual CRUD functions with a recording DB stub. Omitted kana must be preserved.
const source=ts.createSourceFile('actions.ts',fs.readFileSync(path.join(root,'src/lib/actions.ts'),'utf8'),ts.ScriptTarget.Latest,true)
const functions=source.statements.filter(n=>ts.isFunctionDeclaration(n)&&['createCustomer','updateCustomer'].includes(n.name?.text)).map(n=>n.getText(source)).join('\n')
let payloads=[]
const chain={insert(p){payloads.push(p);return this},update(p){payloads.push(p);return this},eq(){return this},select(){return this},async single(){return {data:{id:1,...payloads.at(-1)},error:null}}}
const module2={exports:{}};vm.runInNewContext(ts.transpileModule(functions,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:module2,exports:module2.exports,hasSupabaseEnv:true,db:()=>({from:()=>chain}),EMAIL_RE:/./,syncBackToProspect:async()=>{},console})
;(async()=>{
 await module2.exports.createCustomer(corp);assert.equal(payloads.at(-1).company_name_kana,'アオゾラ')
 const legacy={...corp};delete legacy.company_name_kana;await module2.exports.updateCustomer(1,legacy);assert.ok(!('company_name_kana'in payloads.at(-1)))
 await module2.exports.updateCustomer(1,{...corp,company_name_kana:''});assert.equal(payloads.at(-1).company_name_kana,null)
 console.log('PASS: customer kana sort/search, no name grouping, corporate layout fields, omitted kana preservation and explicit clearing')
})().catch(e=>{console.error(e);process.exitCode=1})
