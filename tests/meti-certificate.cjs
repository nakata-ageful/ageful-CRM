// Synthetic, offline regression tests. No credentials or production writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/meti-certificate.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:m,exports:m.exports,Date,Set});const a=m.exports
const plain=x=>JSON.parse(JSON.stringify(x));let items=[{text:'再生可能エネルギー発電設備を用いた発電の認定の証明について',x:0,y:800,width:400,page:1}]
function row(label,value,y,page=1){items.push({text:label,x:50,y,width:65,page},{text:value,x:220,y,width:200,page})}
row('認定日','２０１８年１１月２９日',700);row('設備ＩＤ','ＡＡ１２３４５Ｚ６７',680);row('事業者名','合成 顧客',660);row('事業者住所','東京都テスト町１－２－３ 建物１０１',640);row('発電設備の設置場所','兵庫県テスト市７４－１、７５－１',620)
row('製造事業者名','Ｔｅｓｔ Ｓｏｌａｒ',760,2);row('種類','単結晶',740,2);row('型式番号','ＴＳＭ－３１５（ＩＩ）',720,2);row('枚数','２６８枚',700,2);row('合計出力','８４．４ｋＷ',680,2)
items.push({text:'2026年10月26日',x:400,y:780,width:140,page:1},{text:'49.5kW',x:220,y:600,width:80,page:1},{text:'余剰配線',x:220,y:660,width:80,page:2})
const d=a.parseCertificate(items);assert.equal(d.certifiedAt,'2018-11-29');assert.equal(d.gridId,'AA12345Z67');assert.equal(d.panelKw,'84.4');assert.equal(d.panelCount,'268');assert.equal(d.panelMaker,'Test Solar');assert.equal(d.panelModel,'TSM-315(II)');assert.match(d.siteAddress,/74-1、75-1/)
assert.throws(()=>a.parseCertificate([]),/書式/);assert.equal(a.parseCertificate([...items,{text:'設備ID',x:50,y:100,width:60,page:2}]).gridId,'','Repeated labels are ambiguous, not first-wins')
for(const x of ['2026-02-29','2026-99-01','2026-01-00',''])assert.equal(a.validCertificateDate(x),false)
assert.equal(a.validCertificateDate('2024-02-29'),true)
const p={id:1,customer_id:2,grid_id:'OLD12345',grid_certified_at:null,panel_kw:49.5,panel_count:100,panel_model:null,panel_maker:null,meti_notes:'既存メモは残す',site_address:'詳細な住所は残す'},c={id:2,address:'元の建物名も残す'}
assert.throws(()=>a.certificateRequest(p,c,d,new Set()),/選んで/)
const req=a.certificateRequest(p,c,d,new Set(['grid_certified_at','panel_kw','meti_notes']))
assert.deepEqual(Object.keys(req.patch).sort(),['grid_certified_at','meti_notes','panel_kw']);assert.equal(req.patch.panel_kw,84.4);assert.equal(req.before.panel_kw,49.5);assert.equal(req.updateCustomer,false);assert.equal(req.customerAddress,null);assert.match(req.patch.meti_notes,/既存メモは残す/);assert.match(req.patch.meti_notes,/事業者住所/);assert.match(req.patch.meti_notes,/発電所住所/);assert.equal(a.certificateNotes(req.patch.meti_notes,d),req.patch.meti_notes,'No repeated appending')
assert.ok(!('site_address'in req.patch));assert.ok(!('customer_id'in req.patch));assert.ok(!('name'in req.patch))
assert.equal(a.certificateRequest(p,c,d,new Set(['customer_address'])).customerAddress,d.businessAddress)
assert.throws(()=>a.certificateRequest(p,null,d,new Set(['customer_address'])),/顧客/)
assert.throws(()=>a.certificateRequest(p,c,{...d,panelCount:'2.5'},new Set(['panel_count'])),/枚数/)
assert.throws(()=>a.certificateRequest(p,c,{...d,panelKw:'NaN'},new Set(['panel_kw'])),/合計出力/)
assert.deepEqual(plain(p).site_address,'詳細な住所は残す')
console.log('PASS: positional JPEA extraction, original certification date vs certificate date, panel output vs facility output, ambiguous labels, invalid dates/numbers, explicit selection, no identity/site/contract/billing writes, preserve notes and deduplicate addresses')
