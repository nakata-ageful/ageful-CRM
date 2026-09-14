import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import {readFileSync} from 'node:fs'

export default defineConfig(({mode})=>({
  plugins: [react(),...(mode==='rehearsal'?[{name:'deny-real-actions',enforce:'pre' as const,
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
