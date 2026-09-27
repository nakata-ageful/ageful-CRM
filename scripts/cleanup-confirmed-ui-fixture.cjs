// Remove ONLY the confirmed disposable UI fixture, after all-source comparison.
// Never disables RLS/triggers or modifies runtime controls; never logs row values.
const fs=require('node:fs'),assert=require('node:assert/strict'),readline=require('node:readline');
const names=['customers','projects','contracts','annual_records','maintenance_responses','periodic_maintenance','prospects','attachments'];
const expected='ufawaiddntqqbjhycbxn',label='【動作確認・削除対象】20260927-new-app';
const canonical=v=>JSON.stringify(v,(_,x)=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(x)?new Date(x).toISOString():x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
async function main(){
 const input=process.argv[2];if(!input?.startsWith('/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups/'))throw Error('Private baseline required');const baseline=JSON.parse(fs.readFileSync(input));
 const origin='https://ageful-crm-new.vercel.app',html=await(await fetch(origin)).text(),paths=[...html.matchAll(/src="([^"]+\.js)"/g)].map(m=>m[1]);assert.equal(paths.length,1);
 const bundle=await(await fetch(new URL(paths[0],origin))).text(),hosts=[...new Set(bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/g)||[])];assert.deepEqual(hosts,[`https://${expected}.supabase.co`]);
 const key=[...new Set(bundle.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[])].find(k=>{try{const p=JSON.parse(Buffer.from(k.split('.')[1],'base64url'));return p.role==='anon'&&p.ref===expected}catch{return false}})||[...new Set(bundle.match(/sb_publishable_[A-Za-z0-9_-]+/g)||[])][0];assert(key);
 console.log('Enter existing account password on stdin (not logged):');const lines=readline.createInterface({input:process.stdin,terminal:false});const password=await new Promise(r=>lines.once('line',x=>{lines.close();r(x)}));
 const headers={apikey:key,'Content-Type':'application/json','x-ageful-client':'ledger-v1'},login=await fetch(`${hosts[0]}/auth/v1/token?grant_type=password`,{method:'POST',headers,body:JSON.stringify({email:'admin@ageful.co.jp',password})}),auth=await login.json();assert(login.ok&&auth.access_token);assert.equal(auth.user?.id,'9a4b877c-d73d-4c37-a902-40c521240d06');headers.Authorization=`Bearer ${auth.access_token}`;
 async function read(t){const r=await fetch(`${hosts[0]}/rest/v1/${t}?select=*&order=id.asc&limit=1000`,{headers:{...headers,Prefer:'count=exact'}}),rows=await r.json();assert(r.ok&&Array.isArray(rows));assert.equal(rows.length,Number(r.headers.get('content-range')?.split('/')[1]));return rows;}
 for(const t of names){const rows=await read(t);if(t==='maintenance_responses'){
   const added=rows.filter(r=>!baseline[t].some(b=>b.id===r.id));assert.equal(added.length,1);assert.equal(added[0].id,102);assert.equal(added[0].project_id,33);assert.equal(added[0].situation,label);assert.equal(added[0].response_no,'26099');assert.equal(added[0].response_content,'保存確認のみ。実際の作業・請求はありません。');assert.equal(canonical(rows.filter(r=>r.id!==102)),canonical(baseline[t]));
  }else assert.equal(canonical(rows),canonical(baseline[t]),`${t}: unexpected change`);}
 const deleted=await fetch(`${hosts[0]}/rest/v1/maintenance_responses?id=eq.102&project_id=eq.33&situation=eq.${encodeURIComponent(label)}`,{method:'DELETE',headers:{...headers,Prefer:'return=representation'}});const removed=await deleted.json();assert(deleted.ok&&Array.isArray(removed)&&removed.length===1&&removed[0].id===102);
 for(const t of names)assert.equal(canonical(await read(t)),canonical(baseline[t]),`${t}: after-cleanup mismatch`);
 console.log(JSON.stringify({target:expected,publicUiFixtureId:102,fixtureRemoved:true,sourceTablesRestored:8,originalBusinessValuesUnchanged:true,noFinancialWrites:true}));
}
main().catch(e=>{console.error(e.name==='AssertionError'?'Fixture cleanup guard failed; stopped':e.message);process.exitCode=1});
