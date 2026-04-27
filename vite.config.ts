import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// — Dev proxy: call KeeperHub (or any host) from same origin so the browser
//   x402 client is not blocked by CORS. Path prefix is stripped when forwarding. —
const keeperhubTarget = 'https://app.keeperhub.com'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/keeperhub': {
        target: keeperhubTarget,
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/keeperhub/, '') || '/',
      },
    },
  },
  preview: {
    proxy: {
      '/keeperhub': {
        target: keeperhubTarget,
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/keeperhub/, '') || '/',
      },
    },
  },
})
