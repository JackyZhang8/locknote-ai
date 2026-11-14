import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const backend = loadEnv('', '.', 'LOCKNOTE_MCP_').LOCKNOTE_MCP_ADDR || '127.0.0.1:7420'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: `http://${backend}`, changeOrigin: true },
      '/mcp': { target: `http://${backend}`, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
  },
})
