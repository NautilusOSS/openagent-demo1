import type { ClientRequest, IncomingMessage } from 'node:http'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// — Dev proxy: call KeeperHub (or any host) from same origin so the browser
//   x402 client is not blocked by CORS. Path prefix is stripped when forwarding. —
const keeperhubTarget = 'https://app.keeperhub.com'
/** Local open-agent API (`GET /workflows`, `POST /workflows/:id/execute`, …). */
const localOpenAgentTarget = 'http://localhost:3001'

const proxyKeeperhub = {
  target: keeperhubTarget,
  changeOrigin: true,
  secure: true,
  rewrite: (path: string) => path.replace(/^\/keeperhub/, '') || '/',
} as const

const proxyLocalOpenAgent = {
  target: localOpenAgentTarget,
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/local-aave/, '') || '/',
} as const

type GatewayProxy = {
  on(
    event: 'proxyReq',
    listener: (proxyReq: ClientRequest, req: IncomingMessage) => void,
  ): void
}

/** Same target — semantic alias for paid workflow gateway UI (`src/lib/gateway-api.ts`). */
const proxyGateway = {
  target: localOpenAgentTarget,
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/gateway/, '') || '/',
  configure: (proxy: GatewayProxy) => {
    proxy.on('proxyReq', (proxyReq: ClientRequest, req: IncomingMessage) => {
      const host = req.headers.host
      if (host) proxyReq.setHeader('X-Forwarded-Host', host)
      const proto =
        (req.headers['x-forwarded-proto'] as string | undefined) ?? 'http'
      proxyReq.setHeader('X-Forwarded-Proto', proto)
      proxyReq.setHeader('X-Gateway-Public-Path-Prefix', '/gateway')
    })
  },
} as const

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/keeperhub': proxyKeeperhub,
      '/local-aave': proxyLocalOpenAgent,
      '/gateway': proxyGateway,
    },
  },
  preview: {
    proxy: {
      '/keeperhub': proxyKeeperhub,
      '/local-aave': proxyLocalOpenAgent,
      '/gateway': proxyGateway,
    },
  },
})
