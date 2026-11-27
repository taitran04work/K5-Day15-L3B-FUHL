import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const api = process.env.VITE_API_PROXY ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('react-router')) return 'vendor-router'
          if (id.includes('@tanstack/react-query')) return 'vendor-query'
          if (id.includes('i18next')) return 'vendor-i18n'
          if (id.includes('radix-ui') || id.includes('lucide-react')) return 'vendor-ui'
          if (id.includes('date-fns') || id.includes('react-day-picker')) return 'vendor-date'
          if (id.includes('react-dom') || id.includes('node_modules/react/')) return 'vendor-react'
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/files': { target: api, changeOrigin: true },
      '/hubs': { target: api, changeOrigin: true, ws: true },
      '/swagger': { target: api, changeOrigin: true },
    },
  },
})
