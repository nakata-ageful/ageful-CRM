// Synthetic documents only. Customer PDFs and OCR output stay outside the repository.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');const modules={};function load(n){if(modules[n])return modules[n];const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/'+n+'.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,Date,Set,require:p=>load(p.replace('./',''))});return modules[n]=m.exports}const a=load('power-contract')
for(const [s,want]of [['2019-12-20','2040-01'],['2020-01-31','2040-02'],['2024-02-29','2044-03'],['2023-02-29',''],['9990-01-01','']])assert.equal(a.kansaiFitMonth(s),want)
assert.equal(a.kyushuNetPrice('19.8'),'18');assert.equal(a.kyushuNetPrice('19.80'),'18');assert.equal(a.kyushuNetPrice('19.81'),'18.009090909090908');assert.equal(a.kyushuNetPrice('19,8'),'')
function fixture(provider='kansai'){
 const rows=provider==='kansai'?['関西電力送配電株式会社','再生可能エネルギー発電に関する電力受給契約内容のお知らせ','ご契約名義合成法人','受電地点特定番号06-1111-2222-3333-4444-5555','発電設備設置場所合成市テスト町1-2','認定IDZZ12345A67認定日2018年11月29日','受給開始日2019年12月20日接続契約日2018年8月16日','特定契約日2023年6月27日契約変更日2024年8月1日','受給最大電力49.5kW','買取単価18.00円に消費税等相当額を加えた金額','買取期間受給開始日以降最初の検針日240月','当社の連絡先：合成電気センター','電話番号:000-111-2222']:[]
 return rows.map((text,i)=>({text,x:50,y:800-i*22,width:480,page:1}))
}
const f=fixture(),d=a.parsePowerContract(f);assert.equal(d.supplyStart,'2019-12-20');assert.equal(d.fitMonth,'2040-01');assert.equal(d.changeDate,'2023-06-27','Use specific contract date, not change-date column');assert.equal(d.fitPrice,'18');assert.match(d.notes,/合成市/);assert.match(d.notes,/49.5kW/)
assert.throws(()=>a.parsePowerContract([]),/書式|契約書/)
assert.throws(()=>a.parsePowerContract([...f,...f.map(i=>({...i,page:2}))]),/1件ずつ/)
assert.throws(()=>a.parsePowerContract([...f,{text:'九州電力',x:40,y:100,width:100,page:1}]),/特定できません/)
assert.throws(()=>a.parsePowerContract([...f,{text:'09-1111-2222-3333-4444-5555',x:40,y:100,width:100,page:1}]),/複数/)
const p={id:1,customer_id:2,grid_id:null,fit_period:20,power_company_notes:'既存の文章',site_address:'変えない住所'},req=a.powerContractRequest(p,d,new Set(['fit_period','fit_end_date','power_company_notes']))
assert.deepEqual(Object.keys(req.patch).sort(),['fit_end_date','fit_period','power_company_notes']);assert.equal(req.patch.fit_period,18);assert.equal(req.patch.fit_end_date,'2040-01-01');assert.match(req.patch.power_company_notes,/既存の文章/);assert.equal(a.powerNotes(req.patch.power_company_notes,d.notes),req.patch.power_company_notes)
assert.throws(()=>a.powerContractRequest(p,d,new Set()),/選んで/)
for(const value of ['18.5','NaN','-1','1001'])assert.throws(()=>a.powerContractRequest(p,{...d,fitPrice:value},new Set(['fit_period'])),/整数/)
assert.throws(()=>a.powerContractRequest(p,{...d,fitMonth:'2040-99'},new Set(['fit_end_date'])),/FIT期間/)
assert.throws(()=>a.powerContractRequest(p,{...d,pointId:'123'},new Set(['generation_point_id'])),/22桁/)
assert.equal(p.site_address,'変えない住所');assert.ok(!('customer_id'in req.patch));assert.ok(!('site_address'in req.patch));assert.ok(!('panel_kw'in req.patch))
console.log('PASS: FIT rule and month rollover, tax conversion without rounding, provider/document ambiguity, field selection, notes preserved, no ownership/site/panel/billing writes')
// Kyushu: four columns, values beneath labels, separate utility/customer contacts.
{
 let items=[],y=800
 const line=(pairs,at=y)=>{for(const [text,x]of pairs)items.push({text,x,y:at,width:40,page:1});y-=22}
 line([['九州電力送配電株式会社',50]]);line([['合成名前さま',50]]);line([['再生可能エネルギー発電からの電力受給契約のご案内',50]])
 line([['発電場所',70]]);line([['合成県テスト市1-2',80]])
 line([['最大受電電力',70],['認定1エD',380]]);line([['49.5kW',80],['ZZ54321B98',390]])
 line([['電気方式',70],['周波数',230],['標準電圧',400]]);line([['交流単相3線式',80],['60Hz',250],['100Vまたは200V',405]])
 line([['受電地点特定番号',70]]);line([['09-1111-2222-3333-4444-5555',150]])
 line([['受給開始日',70],['固定買取終了年月',193],['取引開始指示数',320],['購入料金単価',436]])
 line([['2023年2月1日',90],['2039年3月',213],['-',355],['19.8円',459]])
 line([['連絡責任者',50]]);line([['合成顧客090-1111-2222さま',50]])
 line([['<連絡先>',50]]);line([['合成託送受付センター',50]]);line([['0800-111-2222',50]])
 const d=a.parsePowerContract(items,true)
 assert.equal(d.gridId,'ZZ54321B98');assert.equal(d.pointId,'09-1111-2222-3333-4444-5555');assert.equal(d.changeDate,'2023-02-01');assert.equal(d.supplyStart,'');assert.equal(d.certifiedAt,'');assert.equal(d.fitMonth,'2039-03');assert.equal(d.fitPrice,'18');assert.match(d.notes,/49.5kW/);assert.match(d.notes,/60Hz/);assert.match(d.notes,/0800-111-2222/);assert.doesNotMatch(d.notes,/090-1111-2222/)
 console.log('PASS: Kyushu positional columns, crossed-out supply-date mapping, tax-exclusive price, FIT month, label OCR variation, utility/customer contact separation')
}
// New three-column scan, synthetic values: no transaction counter; customer
// number is a separate row and must not become the generation-point number.
{
 const items=[];let y=800
 const line=pairs=>{for(const [text,x]of pairs)items.push({text,x,y,width:30,page:1});y-=22}
 line([['九州電力株式会社',50]]);line([['合成名前さま',50]]);line([['電力受給契約のご案内',50]])
 line([['最大受電電力(発電出力)',50],['|',300],['認定ID',380]]);line([['49.000kW',60],['Z123456B78',390]])
 line([['お客さま番号',50]]);line([['40-100-200-00-1234567-89',60]])
 line([['受電地点特定番号',50]]);line([['09-2222-3333-4444-5555-6666',60]])
 line([['受給開始日',50],['固定買取終了年月',220],['購入料金単価(注1)',400]])
 line([['2024年5月8日',60],['2040年4月',230],['39.60円',410]])
 const d=a.parsePowerContract(items,true)
 assert.equal(d.gridId,'Z123456B78');assert.equal(d.pointId,'09-2222-3333-4444-5555-6666');assert.equal(d.changeDate,'2024-05-08');assert.equal(d.fitMonth,'2040-04');assert.equal(d.fitPrice,'36');assert.equal(d.supplyStart,'');assert.equal(d.certifiedAt,'')
 for(const bad of ['XZ123456B78','Z123456B789','Z12345GB78','Z123456B78Z'])assert.equal(a.parsePowerContract(items.map(i=>i.text==='Z123456B78'?{...i,text:bad}:i),true).gridId,'','Do not extract an ID substring or repair OCR characters')
 // Missing labels leave the associated value blank, rather than borrowing
 // an adjacent month, the issue date, or another unrelated number.
 for(const [label,key]of [['受給開始日','changeDate'],['固定買取終了年月','fitMonth'],['購入料金単価(注1)','fitPrice']])assert.equal(a.parsePowerContract(items.filter(i=>i.text!==label),true)[key],'')
 console.log('PASS: three-column form, both complete ID families, customer/point separation, no adjacent-cell or malformed-ID guessing')
}
