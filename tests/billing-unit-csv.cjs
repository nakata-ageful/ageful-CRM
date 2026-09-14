const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
function load(file){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports:m.exports,require:n=>load(path.resolve(path.dirname(file),n)+'.ts')});return m.exports}
const {buildBillingUnitCsv:build}=load(path.resolve(__dirname,'../src/lib/billing-unit-csv.ts'));
const unit={id:'1',projectId:1,serviceYear:2026,roundLabel:'第1回',recipientId:2,method:'請求書',scheduledDate:'2026-09-01',issuedOn:null,receivedOn:null,lifecycle:'planned',plannedAmount:0,frozenAmount:null,periodStart:'2026-10-27',periodEnd:'2027-12-31',planNote:'備考,"保持"\n次行'};
const before=JSON.stringify(unit),csv=build([unit],()=> '=HYPERLINK("x")',()=> '発電所');
assert.ok(csv.startsWith('\uFEFF請求回ID'));assert.ok(csv.includes('2026-10-27,2027-12-31,保存済み'));assert.ok(csv.includes("'＝")===false);assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes('予定額,0,0,,'));assert.ok(csv.includes('"備考,""保持""\n次行"'));assert.equal(JSON.stringify(unit),before);
const paid=build([{...unit,lifecycle:'received',frozenAmount:165000,issuedOn:'2026-09-01',receivedOn:'2026-09-10'}],()=> 'B',()=> '発電所');
assert.ok(paid.includes('2026-09-01,2026-09-01,2026-09-10,入金済,確定額,165000,0,165000'));
assert.ok(build([{...unit,plannedAmount:null,periodStart:null,periodEnd:null}],()=> 'B',()=> '発電所').includes('金額要確認,,,,'));
console.log('PASS: per-unit CSV saved payer, explicit period, dates, zero/unknown, planned/frozen separation, notes escaping, formula protection, immutable inputs');
// Optional diagnostic fixture: use the application's exporter, not another CSV serializer.
// Never overwrite an existing file; this is not proof of browser download completion.
if(process.argv[2]==='--export-fixture'){
 const output=process.argv[3];assert.ok(output&&path.isAbsolute(output),'absolute diagnostic path required');
 const content=build([unit,{...unit,id:'2',roundLabel:'第2回',lifecycle:'received',frozenAmount:165000,issuedOn:'2026-09-01',receivedOn:'2026-09-10'},
  {...unit,id:'3',roundLabel:'第3回',plannedAmount:null,periodStart:null,periodEnd:null}],()=> '検証顧客B',()=> '検証発電所');
 fs.writeFileSync(output,content,{flag:'wx',mode:0o600});
 assert.equal(fs.readFileSync(output,'utf8'),content);
 console.log('PASS: diagnostic CSV file saved and read back byte-for-byte (synthetic data only)');
}
