const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'database/drafts/PRODUCTION_CUTOVER_MANIFEST_2026-09-21.json'),'utf8'));
assert.equal(manifest.status,'prepared_not_authorized');
assert.equal(manifest.productionCutoverReady,false);
assert.equal(manifest.accessControlVerified,true);
assert.equal(manifest.futureScheduleCoverageVerified,false);
assert.equal(manifest.nearTermScheduleDispositionVerified,true);
assert.equal(manifest.futureScheduleCreationAuthorized,false);
assert.equal(manifest.expectedStoredUnitsAfterConfirmedAdjustments,32);
assert.deepEqual(manifest.separatedDatabaseRehearsal,{
  passed:true,oldDatabaseChanged:false,newDatabaseMigrationCommitted:true,sourceTablesMatchedAfterMigration:true,
  storedUnits:32,sourceUnits:31,actualAmount:4177465,plannedAmount:165000,acceptedProjects:87,runtimeEnabled:false,
});
assert.equal(manifest.futureSchedule24MonthReview.passed,true);
assert.equal(manifest.futureSchedule24MonthReview.classifiedProjects,87);
assert.equal(manifest.futureSchedule24MonthReview.reviewOccurrences,0);
assert.equal(manifest.futureSchedule24MonthReview.hiddenReviewCandidates,false);
assert.equal(manifest.futureSchedule24MonthReview.authorizesPerpetualCoverage,false);
assert.deepEqual(manifest.nearTermScheduleDispositionBasis,{
  totalProjects:87,
  visibleNearTermSetupProjects:2,
  visibleConfigurationIssueProjects:56,
  noNearTermActionProjectsBeforeMismatchFix:29,
  configurationIssuesRemainVisible:true,
  guessedSchedulesCreated:false,
  note:'Three-month operational visibility is not perpetual future coverage. Revalidation after mismatch-display fix is required.',
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
console.log('PASS: the 17-file production cutover order is pinned; access and near-term non-guessing disposition are recorded, while future coverage and production authorization remain false.');
