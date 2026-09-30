import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Override with API_TARGET=http://127.0.0.1:8001 when port 8000 is taken.
const apiTarget = process.env.API_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': apiTarget,
    },
  },
})
