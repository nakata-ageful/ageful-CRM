import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // The local-only PostgreSQL preview loads WASM/data beside the original package.
  optimizeDeps: { exclude: ['@electric-sql/pglite'] },
  server: {
    port: 5177,
    strictPort: true,
  },
})
