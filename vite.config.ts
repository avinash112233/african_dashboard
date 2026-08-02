import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('leaflet') || id.includes('react-leaflet')) return 'leaflet';
            if (id.includes('@mui') || id.includes('@emotion')) return 'mui';
            if (
              id.includes('chart.js') ||
              id.includes('react-chartjs') ||
              id.includes('chartjs-plugin')
            ) {
              return 'charts';
            }
            if (id.includes('react-router')) return 'router';
            return 'vendor';
          }
        },
      },
    },
  },
  server: {
    // Port will be auto-detected or use 5173
    proxy: {
      // AERONET + AAQE — proxy through backend (cached, same as MERRA2/OpenAQ).
      '^/api/aeronet': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Proxy GIBS tiles (NASA VIIRS/MODIS) - avoids 403/CORS when loading from browser
      '^/api/gibs': {
        target: 'https://gibs.earthdata.nasa.gov',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/gibs/, ''),
      },
      // Proxy MERRA2 API to backend (run `npm run api` for real GES DISC data)
      '^/api/merra2': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '^/api/washu': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '^/api/openaq': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // FIRMS — same as production nginx: backend serves compact /fires7day + proxies NASA WFS/CSV.
      '^/api/firms': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
