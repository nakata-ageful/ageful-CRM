// Read-only deployment/Auth check. Never print credentials, tokens or business rows.
const readline=require('node:readline');
const expected='ufawaiddntqqbjhycbxn';
const origin='https://ageful-crm-new.vercel.app';
async function main(){
  const page=await fetch(origin);if(!page.ok)throw Error(`Deployment HTTP ${page.status}`);
  const html=await page.text();const paths=[...html.matchAll(/src="([^"]+\.js)"/g)].map(m=>m[1]);
  if(paths.length!==1)throw Error('Unexpected deployment bundle count');
  const bundle=await (await fetch(new URL(paths[0],origin))).text();
  const hosts=[...new Set(bundle.match(/https:\/\/[a-z0-9]+\.supabase\.co/g)||[])];
  if(hosts.length!==1||hosts[0]!==`https://${expected}.supabase.co`)throw Error('Deployment DB target mismatch');
  const keys=[...new Set(bundle.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)||[])];
  const publishable=[...new Set(bundle.match(/sb_publishable_[A-Za-z0-9_-]+/g)||[])];
  const key=keys.find(k=>{try{const p=JSON.parse(Buffer.from(k.split('.')[1],'base64url'));return p.role==='anon'&&p.ref===expected}catch{return false}})||(publishable.length===1?publishable[0]:null);
  if(!key)throw Error('Target public anon key missing');
  const base=hosts[0];const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json','x-ageful-client':'ledger-v1'};
  const anonymous=await fetch(`${base}/rest/v1/customers?select=id&limit=1`,{headers});
  const anonBody=await anonymous.json();
  if(anonymous.ok&&Array.isArray(anonBody)&&anonBody.length)throw Error('Anonymous customer exposure');
  console.log(JSON.stringify({deploymentHTTP:page.status,database:expected,anonymousCustomerStatus:anonymous.status,anonymousCustomerRows:Array.isArray(anonBody)?anonBody.length:null}));
  let password=process.env.AGEFUL_CHECK_PASSWORD;
  if(!password){
    console.log('Enter existing account password on stdin (not logged):');
    const input=readline.createInterface({input:process.stdin,terminal:false});
    password=await new Promise(resolve=>input.once('line',line=>{input.close();resolve(line)}));
  }
  const login=await fetch(`${base}/auth/v1/token?grant_type=password`,{method:'POST',headers,body:JSON.stringify({email:'admin@ageful.co.jp',password})});
  const auth=await login.json();if(!login.ok||!auth.access_token)throw Error(`Sign-in rejected (${login.status}, ${auth.error_code||auth.code||'unknown'})`);
  headers.Authorization=`Bearer ${auth.access_token}`;
  const snapshot=await fetch(`${base}/rest/v1/rpc/billing_runtime_snapshot`,{method:'POST',headers,body:'{}'});
  const snap=await snapshot.json();if(snapshot.ok&&snap.ready)throw Error('Runtime unexpectedly enabled');
  const inspect=await fetch(`${base}/rest/v1/rpc/billing_runtime_inspection_snapshot`,{method:'POST',headers,body:'{}'});
  const data=await inspect.json();if(!inspect.ok)throw Error(`Inspection rejected (${inspect.status})`);
  const counts={customers:data.customers?.length,projects:data.projects?.length,contracts:data.contracts?.length,units:data.units?.length};
  const actual=(data.units||[]).reduce((n,u)=>n+Number(u.frozen_amount||0),0);
  const planned=(data.units||[]).reduce((n,u)=>n+Number(u.planned_amount||0),0);
  if(counts.customers!==84||counts.projects!==87||counts.contracts!==90||counts.units!==32||actual!==4177465||planned!==165000)throw Error('New DB reconciliation mismatch');
  console.log(JSON.stringify({signIn:true,runtimeStatus:snapshot.status,runtimeReady:snap.ready===true,inspection:true,counts,actual,planned,futureCoverage:data.future_schedule_coverage_verified}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
