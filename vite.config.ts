import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import {readFileSync,cpSync,mkdirSync} from 'node:fs'
import {fileURLToPath} from 'node:url'

const ocrAssets:Record<string,string>={
 'worker.min.js':'tesseract.js/dist/worker.min.js',
 'jpn.traineddata.gz':'@tesseract.js-data/jpn/4.0.0_best_int/jpn.traineddata.gz',
 ...Object.fromEntries(['tesseract-core-lstm','tesseract-core-simd-lstm','tesseract-core-relaxedsimd-lstm'].flatMap(n=>['wasm.js','wasm'].map(ext=>[`core/${n}.${ext}`,`tesseract.js-core/${n}.${ext}`]))),
}

export default defineConfig(({mode})=>({
  plugins: [react(),{
    name:'local-pdf-resources',
    configureServer(server){server.middlewares.use((req,res,next)=>{
      const asset=ocrAssets[req.url?.replace(/^\/pdf-resources\/ocr\//,'')??'']
      if(req.url?.startsWith('/pdf-resources/ocr/')&&asset){try{res.setHeader('Content-Type',asset.endsWith('.js')?'application/javascript':asset.endsWith('.wasm')?'application/wasm':'application/octet-stream');res.end(readFileSync(new URL(`./node_modules/${asset}`,import.meta.url)))}catch{res.statusCode=404;res.end()}return}
      // PDF.js 6 decodes monochrome scanner images (CCITT/JBIG2) in WASM.
      // Without these lazy, same-origin assets a scan can render as blank.
      const wasm=req.url?.match(/^\/pdf-resources\/wasm\/(jbig2\.wasm|jbig2_nowasm_fallback\.js)$/)
      if(wasm){try{res.setHeader('Content-Type',wasm[1].endsWith('.wasm')?'application/wasm':'application/javascript');res.end(readFileSync(new URL(`./node_modules/pdfjs-dist/wasm/${wasm[1]}`,import.meta.url)))}catch{res.statusCode=404;res.end()}return}
      const match=req.url?.match(/^\/pdf-resources\/cmaps\/([A-Za-z0-9_-]+\.bcmap)$/)
      if(!match)return next()
      try{res.setHeader('Content-Type','application/octet-stream');res.end(readFileSync(new URL(`./node_modules/pdfjs-dist/cmaps/${match[1]}`,import.meta.url)))}catch{res.statusCode=404;res.end()}
    })},
    writeBundle(options){const out=options.dir??'dist';for(const [name,path]of Object.entries(ocrAssets)){const target=`${out}/pdf-resources/ocr/${name}`;mkdirSync(target.slice(0,target.lastIndexOf('/')),{recursive:true});cpSync(new URL(`./node_modules/${path}`,import.meta.url),target)}mkdirSync(`${out}/pdf-resources/wasm`,{recursive:true});for(const name of ['jbig2.wasm','jbig2_nowasm_fallback.js','LICENSE_JBIG2','LICENSE_PDFJS_JBIG2'])cpSync(new URL(`./node_modules/pdfjs-dist/wasm/${name}`,import.meta.url),`${out}/pdf-resources/wasm/${name}`);cpSync(new URL('./node_modules/pdfjs-dist/cmaps',import.meta.url),`${out}/pdf-resources/cmaps`,{recursive:true})},
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
