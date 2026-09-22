const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'database/drafts/PRODUCTION_CUTOVER_MANIFEST_2026-09-21.json'),'utf8'));
assert.equal(manifest.status,'prepared_not_authorized');
assert.equal(manifest.productionCutoverReady,false);
assert.equal(manifest.accessControlVerified,true);
assert.equal(manifest.futureScheduleCoverageVerified,true);
assert.equal(manifest.futureScheduleCreationAuthorized,false);
assert.deepEqual(manifest.futureScheduleCoverageBasis,{
  totalProjects:87,
  visibleNearTermSetupProjects:2,
  visibleConfigurationIssueProjects:56,
  noNearTermActionProjects:29,
  configurationIssuesRemainVisible:true,
  guessedSchedulesCreated:false,
});
assert.equal(manifest.files.length,17);
assert.equal(new Set(manifest.files.map(file=>file.path)).size,manifest.files.length);
for(const file of manifest.files){
  const body=fs.readFileSync(path.join(root,file.path));
  assert.equal(crypto.createHash('sha256').update(body).digest('hex'),file.sha256,`${file.path} changed after cutover rehearsal`);
}
const runtime=fs.readFileSync(path.join(root,'database/drafts/20260909_billing_runtime.sql'),'utf8');
for(const name of ['write_invoice_unit','transfer_ownership_manual','write_manual_billing_plan','record_manual_debit_result',
  'create_manual_debit_plan','create_future_schedule','set_billing_service_period','write_management_lifecycle']){
  assert.match(runtime,new RegExp(`ALTER FUNCTION public\\.${name}\\([^;]+\\) SECURITY DEFINER;`),`${name} must retain the guarded runtime owner's privileges`);
}
assert.match(runtime,/GRANT SELECT ON public\.billing_operations,public\.billing_unit_events TO authenticated;/);
assert.doesNotMatch(runtime,/GRANT (?:INSERT|UPDATE|DELETE|ALL)[^;]*billing_(?:operations|unit_events)[^;]* TO authenticated;/i,
  'ledger/audit writes must remain available only through billing_runtime_write');
console.log('PASS: the 17-file production cutover order is pinned; access and non-guessing future-schedule disposition are verified, while production authorization remains false.');
