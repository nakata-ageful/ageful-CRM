// Audit every JSX date/month input, including computed types and existing ranges.
// Evaluates attribute expressions only; no component, event or data access runs.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const root=path.resolve(__dirname,'..'),utils={exports:{}}
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,'src/lib/utils.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module:utils,exports:utils.exports,Date})
const {dateInputRange}=utils.exports,counts={production:0,practice:0},failures=[]
function audit(file){
 const text=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 function visit(node){
  if((ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node))&&node.tagName.getText(ast)==='input'){
   const attrs=node.attributes.properties,type=attrs.find(a=>ts.isJsxAttribute(a)&&a.name.getText(ast)==='type')
   const read=(a,context)=>!a?.initializer?undefined:ts.isStringLiteral(a.initializer)?a.initializer.text:vm.runInNewContext(a.initializer.expression.getText(ast),context,{timeout:100})
   const contexts=['date','month','text','number'].map(type=>({type,f:{type},year:2026,Date})),dateCases=[]
   for(const context of contexts){const kind=read(type,context);if(['date','month','datetime-local'].includes(kind))dateCases.push({context,kind})}
   if(dateCases.length){
    const location=path.relative(root,file)+':'+(ast.getLineAndCharacterOfPosition(node.getStart()).line+1)
    counts[file.includes('/dev/')?'practice':'production']++
    for(const {context,kind} of dateCases){
     let max
     for(const a of attrs){
      if(ts.isJsxAttribute(a)&&a.name.getText(ast)==='max')max=read(a,context)
      if(ts.isJsxSpreadAttribute(a)){
       assert.equal(a.expression.getText(ast),'dateInputRange()','Review new date input spread: '+location)
       max=dateInputRange().max
      }
     }
     const format=kind==='month'?/^\d{4}-\d{2}$/:/^\d{4}-\d{2}-\d{2}$/
     if(typeof max!=='string'||!format.test(max)||Number(max.slice(0,4))>9999)failures.push(location+' needs a four-digit-year maximum')
    }
   }
  }
  ts.forEachChild(node,visit)
 }
 visit(ast)
}
function scan(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())scan(file);else if(file.endsWith('.tsx'))audit(file)}}
scan(path.join(root,'src'))
assert.ok(counts.production>70,'Expected a full application audit')
assert.deepEqual(failures,[])
const year=new Date().getFullYear(),range=dateInputRange()
assert.equal(range.min,`${year-4}-01-01`);assert.equal(range.max,`${year+1}-12-31`)
console.log(`PASS: ${counts.production} production and ${counts.practice} practice date/month inputs have bounded years; existing rolling ranges preserved; no data access`)
