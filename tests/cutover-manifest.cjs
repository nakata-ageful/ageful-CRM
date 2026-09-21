const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'database/drafts/PRODUCTION_CUTOVER_MANIFEST_2026-09-21.json'),'utf8'));
assert.equal(manifest.status,'prepared_not_authorized');
assert.equal(manifest.productionCutoverReady,false);
assert.equal(manifest.futureScheduleCoverageVerified,false);
assert.equal(manifest.files.length,17);
assert.equal(new Set(manifest.files.map(file=>file.path)).size,manifest.files.length);
for(const file of manifest.files){
  const body=fs.readFileSync(path.join(root,file.path));
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'),file.sha256,`${file.path} changed after cutover rehearsal`);
}
console.log('PASS: the 17-file production cutover order is pinned to the rehearsed SQL hashes; authorization and future coverage remain false.');
