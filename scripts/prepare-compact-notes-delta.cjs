// Offline compiler: the exact same source-row comparisons are represented by SHA-256.
// No DB connection or network access. Typed JSON canonicalization is done by PostgreSQL.
const fs=require('node:fs'),path=require('node:path');
const {build,tables}=require('./prepare-migrated-notes-delta.cjs');
const q=v=>`'${String(v).replaceAll("'","''")}'`;
// jsonb equality treats 1.0 and 1.00 as equal, but their text representations differ.
// Preserve the original comparison semantics by normalizing numeric scale, not values.
const row=alias=>`(SELECT jsonb_object_agg(k,CASE WHEN jsonb_typeof(v)='number' THEN to_jsonb(trim_scale((v#>>'{}')::numeric)) ELSE v END) FROM jsonb_each(to_jsonb(${alias})) n(k,v))`;
const digest=(from,alias)=>`encode(sha256(convert_to(coalesce(jsonb_agg(${row(alias)} ORDER BY ${alias}.id),'[]'::jsonb)::text,'UTF8')),'hex') FROM ${from} ${alias}`;
async function compact(db,before,after){
 const original=build(before,after).sql;
 const pattern=/DO \$\$ BEGIN IF EXISTS\(\n[\s\S]*?\) THEN RAISE EXCEPTION '(Before|After) source mismatch: ([a-z_]+)'; END IF; END \$\$/g;
 const replacements=[];
 for(const match of original.matchAll(pattern)){
  const [,phase,t]=match;if(!tables.includes(t))throw Error('Unexpected source table');
  const data=phase==='Before'?before:after;
  const result=await db.query(`SELECT ${digest(`jsonb_populate_recordset(NULL::public.${t},$1::jsonb)`,'s')} `,[JSON.stringify(data[t])]);
  const expected=result.rows[0].encode;if(!/^[a-f0-9]{64}$/.test(expected))throw Error('Invalid digest');
  const sql=`DO $$ BEGIN IF (SELECT ${digest('public.'+t,'t')}) IS DISTINCT FROM ${q(expected)} THEN RAISE EXCEPTION '${phase} source mismatch: ${t}'; END IF; END $$`;
  replacements.push({start:match.index,end:match.index+match[0].length,sql});
 }
 if(replacements.length!==tables.length*2)throw Error('Incomplete source checks');
 let sql=original;for(const r of replacements.reverse())sql=sql.slice(0,r.start)+r.sql+sql.slice(r.end);
 return sql;
}
module.exports={compact};
if(require.main===module)(async()=>{
 const [archive,beforeFile,afterFile,output]=process.argv.slice(2),dir='/Users/keigoshoda/Documents/ChatGPT/エイジフル/private-backups/';
 if(![archive,beforeFile,afterFile,output].every(f=>f&&path.resolve(f).startsWith(dir)))throw Error('Private paths required');
 const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite({loadDataDir:new Blob([fs.readFileSync(archive)])});
 try{await db.exec("SET timezone='UTC'");const sql=await compact(db,JSON.parse(fs.readFileSync(beforeFile)),JSON.parse(fs.readFileSync(afterFile)));fs.writeFileSync(output,sql,{flag:'wx',mode:0o600});console.log(JSON.stringify({preparedOnly:true,sourceChecks:16,bytes:Buffer.byteLength(sql)}));}finally{await db.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1});
