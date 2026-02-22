import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Port will be auto-detected or use 5173
    proxy: {
      // Proxy AERONET API requests to avoid CORS issues
      // Match /api/aeronet regardless of base path
      '^/api/aeronet': {
        target: 'https://aeronet.gsfc.nasa.gov',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => {
          // Remove /api/aeronet prefix and keep the rest of the path
          // /api/aeronet/cgi-bin/print_site_table_v3 -> /cgi-bin/print_site_table_v3
          const newPath = path.replace(/^\/api\/aeronet/, '');
          console.log('[Vite Proxy] Rewrite:', path, '->', newPath);
          return newPath;
        },
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.error('[Vite Proxy] Error:', err.message);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('[Vite Proxy] Intercepted:', req.method, req.url);
            console.log('[Vite Proxy] Forwarding to:', 'https://aeronet.gsfc.nasa.gov' + proxyReq.path);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('[Vite Proxy] Response:', proxyRes.statusCode, req.url);
          });
        },
      },
      // Proxy FIRMS API requests to avoid CORS issues
      '^/api/firms': {
        target: 'https://firms.modaps.eosdis.nasa.gov',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => {
          // Remove /api/firms prefix and keep the rest of the path
          // /api/firms/data/active_fire/... -> /data/active_fire/...
          const newPath = path.replace(/^\/api\/firms/, '');
          console.log('[Vite Proxy] FIRMS Rewrite:', path, '->', newPath);
          return newPath;
        },
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.error('[Vite Proxy FIRMS] Error:', err.message);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('[Vite Proxy FIRMS] Intercepted:', req.method, req.url);
            console.log('[Vite Proxy FIRMS] Forwarding to:', 'https://firms.modaps.eosdis.nasa.gov' + proxyReq.path);
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('[Vite Proxy FIRMS] Response:', proxyRes.statusCode, req.url);
          });
        },
      },
    },
  },
})
