import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import {readFileSync,cpSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

export default defineConfig(({mode})=>({
  plugins: [react(),{
    name:'local-pdf-resources',
    configureServer(server){server.middlewares.use((req,res,next)=>{
      const match=req.url?.match(/^\/pdf-resources\/cmaps\/([A-Za-z0-9_-]+\.bcmap)$/)
      if(!match)return next()
      try{res.setHeader('Content-Type','application/octet-stream');res.end(readFileSync(new URL(`./node_modules/pdfjs-dist/cmaps/${match[1]}`,import.meta.url)))}catch{res.statusCode=404;res.end()}
    })},
    writeBundle(options){const out=options.dir??'dist';mkdirSync(`${out}/pdf-resources`,{recursive:true});cpSync(new URL('./node_modules/pdfjs-dist/cmaps',import.meta.url),`${out}/pdf-resources/cmaps`,{recursive:true})},
  },...(mode==='operator-demo'?[{name:'isolate-full-app-demo',enforce:'pre' as const,
    resolveId(id:string){if(/(?:^|\/)supabase(?:\.ts)?$/.test(id))return fileURLToPath(new URL('./src/dev/full-demo-supabase.ts',import.meta.url));
      if(/(?:^|\/)billing-runtime(?:\.ts)?$/.test(id))return fileURLToPath(new URL('./src/dev/full-demo-runtime.ts',import.meta.url))}
  }]:[]),...(mode==='rehearsal'?[{name:'deny-real-actions',enforce:'pre' as const,
    resolveId(id:string){if(id.endsWith('/lib/actions')||id.endsWith('/lib/actions.ts'))return '\0rehearsal-actions'},
    load(id:string){if(id!=='\0rehearsal-actions')return;const source=readFileSync(new URL('./src/lib/actions.ts',import.meta.url),'utf8');return [...source.matchAll(/export async function (\w+)/g)].map(m=>`export async function ${m[1]}(){throw new Error('隔離検証：実データ操作は禁止されています')}`).join('\n')}
  }]:[])],
  // The local-only PostgreSQL preview loads WASM/data beside the original package.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  server: {
    port: 5177,
    strictPort: true,
  },
}))
