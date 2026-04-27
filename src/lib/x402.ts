import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from '@x402/fetch'
import { ExactEvmScheme, toClientEvmSigner } from '@x402/evm'
import type { PublicClient, WalletClient } from 'viem'
/**
 * x402 on Base mainnet (USDC via EIP-3009). This CAIP-2 id must match the
 * payment requirement from the 402 response (e.g. KeeperHub paid calls).
 */
export const X402_BASE_NETWORK = 'eip155:8453' as const

/**
 * Create a `fetch` that, on 402, builds a PAYMENT-SIGNATURE and retries
 * (see @x402/fetch, Coinbase / x402 Foundation client flow).
 * Requires a connected **Base mainnet** account with USDC for the priced call.
 */
export function createX402Fetch(
  walletClient: WalletClient,
  publicClient: PublicClient,
) {
  const acc = walletClient.account
  if (!acc) {
    throw new Error('Wallet is not connected')
  }
  // — Optional `rpcUrl` backs on-chain reads for Permit2 / extension paths; set VITE_BASE_MAINNET_RPC_URL in .env. —
  const mainnetRpc = import.meta.env.VITE_BASE_MAINNET_RPC_URL

  const evmSigner = toClientEvmSigner(
    {
      address: acc.address,
      signTypedData: (msg) =>
        walletClient.signTypedData({
          account: acc,
          domain: msg.domain,
          types: msg.types,
          primaryType: msg.primaryType,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          message: msg.message as any,
        }),
    },
    publicClient,
  )

  const client = new x402Client().register(
    X402_BASE_NETWORK,
    new ExactEvmScheme(evmSigner, { rpcUrl: mainnetRpc }),
  )
  return wrapFetchWithPayment(fetch, client)
}

export { decodePaymentResponseHeader }

/**
 * If present, the successful response can include a settlement reference (e.g. tx id).
 * Pass `response.headers.get.bind(response.headers)`.
 */
export function tryDecodePaymentFromResponse(response: Response) {
  const raw = response.headers.get('PAYMENT-RESPONSE')
  if (!raw) return null
  try {
    return decodePaymentResponseHeader(raw) as unknown
  } catch {
    return { raw }
  }
}

export const KH_DEMO_PATH = '/keeperhub/api/mcp/workflows/microtip/call'

/**
 * In dev, use the Vite-proxied path to avoid CORS. In build / prod, set
 * VITE_X402_TEST_URL to a reachable URL (or host with CORS) when not using a reverse proxy.
 */
export function defaultX402TestUrl() {
  const fromEnv = import.meta.env.VITE_X402_TEST_URL
  if (fromEnv) return fromEnv
  if (import.meta.env.DEV) {
    return `${globalThis.location.origin}${KH_DEMO_PATH}`
  }
  return 'https://app.keeperhub.com/api/mcp/workflows/microtip/call'
}
