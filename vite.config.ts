import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/new_web/african_dashboard",
  server: {
    proxy: {
      // Add API proxies here as needed for development
      '/api': {
        target: 'https://api.example.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
