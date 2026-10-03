// Local-only search and real component handlers. No authentication or business writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),root=path.resolve(__dirname,'..')
function load(file,hooks){file=path.resolve(root,file);const m={exports:{}}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {module:m,exports:m.exports,require:n=>{if(n==='react')return hooks??React;if(n==='react/jsx-runtime')return require(n);if(!n.startsWith('.'))throw Error('External access forbidden');const p=path.resolve(path.dirname(file),n);return load(p+(fs.existsSync(p+'.ts')?'.ts':'.tsx'),hooks)}});return m.exports}
const customers=[{id:1,name:'山﨑 真佑子',company_name:'株式会社検証',name_kana:'ヤマサキ マユコ'},
 {id:2,name:'山﨑 真佑子',company_name:'テスト株式会社'},...Array.from({length:30},(_,i)=>({id:i+3,name:`候補${i}`}))]
const before=JSON.stringify(customers),{searchCustomers,customerChoiceLabel}=load('src/lib/customer-search.ts')
const ids=query=>Array.from(searchCustomers(customers,query),c=>c.id)
assert.deepEqual(ids('真佑'),[1,2]);assert.deepEqual(ids('検証'),[1]);assert.deepEqual(ids('やまさき'),[1])
assert.deepEqual(ids('ﾏﾕｺ'),[1]);assert.deepEqual(ids('山﨑　検証'),[1]);assert.deepEqual(ids('３２'),[32])
assert.equal(ids('候補').length,30);assert.equal(ids('').length,32);assert.equal(ids('不存在').length,0)
assert.ok(customerChoiceLabel(customers[1]).includes('テスト株式会社')&&customerChoiceLabel(customers[1]).includes('顧客ID 2'))
assert.equal(JSON.stringify(customers),before)
const slots=[];let cursor=0;const writes=[]
const hooks={useId:()=> 'picker',useState(init){const i=cursor++;if(!(i in slots))slots[i]=typeof init==='function'?init():init;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}]}}
const {CustomerPicker}=load('src/components/CustomerPicker.tsx',hooks)
const props={label:'請求先',value:'1',customers,onChange:v=>{writes.push(v);props.value=v}}
const render=()=>{cursor=0;return CustomerPicker(props)}
const nodes=(e,p)=>Array.isArray(e)?e.flatMap(v=>nodes(v,p)):!e?.props?[]:[...(p(e)?[e]:[]),...nodes(e.props.children,p)]
const input=tree=>nodes(tree,e=>e.type==='input')[0]
let tree=render();input(tree).props.onChange({target:{value:'真佑'}});tree=render()
assert.equal(writes.length,0,'Typing must not change the selected ID or auto-select a match')
let options=nodes(tree,e=>e.props.role==='option');assert.equal(options.length,2)
options[1].props.onClick();tree=render();assert.deepEqual(writes,['2']);assert.equal(input(tree).props['aria-expanded'],false)
input(tree).props.onChange({target:{value:'不存在'}});tree=render();assert.equal(nodes(tree,e=>e.props.role==='option').length,0)
let prevented=0;input(tree).props.onKeyDown({key:'Enter',nativeEvent:{},preventDefault(){prevented++}})
assert.equal(prevented,1);assert.deepEqual(writes,['2'],'No match must not submit the form or select an arbitrary ID')
input(tree).props.onChange({target:{value:'候補'}});tree=render();assert.equal(nodes(tree,e=>e.props.role==='option').length,30,'No fixed result limit')
input(tree).props.onKeyDown({key:'ArrowDown',nativeEvent:{},preventDefault(){}});tree=render()
input(tree).props.onKeyDown({key:'Enter',nativeEvent:{isComposing:true},preventDefault(){throw Error('IME must not pick')}});assert.equal(writes.length,1)
input(tree).props.onKeyDown({key:'Enter',nativeEvent:{},preventDefault(){}});assert.deepEqual(writes,['2','3'])
tree=render();nodes(tree,e=>e.props['aria-label']==='請求先の選択を解除')[0].props.onClick();assert.equal(props.value,'')
props.disabled=true;tree=render();assert.equal(input(tree).props.disabled,true)
const markup=renderToStaticMarkup(React.createElement(load('src/components/CustomerPicker.tsx').CustomerPicker,{...props,value:'2',disabled:false}))
assert.ok(markup.includes('選択中：テスト株式会社')&&markup.includes('顧客ID 2'))
console.log('PASS: partial name/company/kana search, duplicates by ID, all matches, explicit choice, IME, keyboard and clear')
