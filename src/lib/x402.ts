import { x402Client, wrapFetchWithPayment, decodePaymentResponseHeader } from '@x402/fetch'
import { encodePaymentRequiredHeader } from '@x402/core/http'
import { ExactEvmScheme, toClientEvmSigner } from '@x402/evm'
import type { PublicClient, WalletClient } from 'viem'
import { khWorkflowCallUrl } from './keeperhub'

/** Base mainnet USDC — must align with `ExactEvmScheme` / facilitator expectations. */
const BASE_MAINNET_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

/** Circle USDC EIP-712 domain for EIP-3009 — required in `accepts[].extra` by `@x402/evm`. */
const USDC_EIP712_EXTRA = {
  name: 'USD Coin',
  version: '2',
} as const

function isPaymentRequiredGatewayBody(body: Record<string, unknown>): boolean {
  if (body.code === 'PAYMENT_REQUIRED') return true
  const err = body.error
  return typeof err === 'string' && err.includes('X-PAYMENT')
}

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof Request) return input.url
  return input.href
}

/** Optional `payTo` / `amount` on the error JSON or nested `details` (server-specific). */
function pickPayToAmountFromBody(parsed: Record<string, unknown>): {
  payTo?: string
  amount?: string
} {
  let payTo: string | undefined =
    typeof parsed.payTo === 'string' ? parsed.payTo : undefined
  let amount: string | undefined =
    typeof parsed.amount === 'string' ? parsed.amount : undefined
  const details = parsed.details
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    const d = details as Record<string, unknown>
    payTo = payTo ?? (typeof d.payTo === 'string' ? d.payTo : undefined)
    amount = amount ?? (typeof d.amount === 'string' ? d.amount : undefined)
  }
  return { payTo, amount }
}

/**
 * When the API returns only `{ code: "PAYMENT_REQUIRED", error: "Missing X-PAYMENT..." }` with no
 * x402 challenge, we cannot discover price/payee unless **`VITE_LOCAL_OPEN_AGENT_X402_PAY_TO`** (and
 * optionally amount) match what the server verifies — see `.env.example`.
 */
function buildSyntheticPaymentRequiredV2(
  resourceUrl: string,
  parsed: Record<string, unknown>,
): Parameters<typeof encodePaymentRequiredHeader>[0] | null {
  const envPayTo = import.meta.env.VITE_LOCAL_OPEN_AGENT_X402_PAY_TO as string | undefined
  const envAmount = import.meta.env.VITE_LOCAL_OPEN_AGENT_X402_AMOUNT as string | undefined
  const picked = pickPayToAmountFromBody(parsed)
  const payToRaw = picked.payTo ?? envPayTo?.trim()
  const amount = picked.amount ?? envAmount?.trim() ?? '1000000'
  if (!payToRaw || !/^0x[a-fA-F0-9]{40}$/i.test(payToRaw)) return null
  return {
    x402Version: 2,
    resource: { url: resourceUrl },
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:8453',
        amount,
        asset: BASE_MAINNET_USDC,
        payTo: payToRaw as `0x${string}`,
        maxTimeoutSeconds: 600,
        extra: { ...USDC_EIP712_EXTRA } as Record<string, unknown>,
      },
    ],
  }
}

/**
 * `@x402/fetch` only starts payment flow on **HTTP 402**. Some APIs wrongly return **400** with
 * `{ code: "PAYMENT_REQUIRED", ... }`. Normalize those to 402 when the response already includes a
 * **`PAYMENT-REQUIRED`** header and/or a parseable **x402** JSON body (`x402Version` 1, or v2 with
 * `accepts` + `resource` so we can synthesize the header).
 */
export function fetchNormalizePaymentRequired400Response(
  inner: typeof fetch = fetch,
): typeof fetch {
  return async (input, init) => {
    const res = await inner(input, init)
    if (res.status !== 400) return res

    const text = await res.text()
    let parsed: Record<string, unknown>
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      return new Response(text, { status: 400, headers: res.headers })
    }

    if (!isPaymentRequiredGatewayBody(parsed)) {
      return new Response(text, { status: 400, headers: res.headers })
    }

    const headers = new Headers(res.headers)

    if (headers.get('PAYMENT-REQUIRED')) {
      return new Response(text, {
        status: 402,
        statusText: 'Payment Required',
        headers,
      })
    }

    if (parsed.x402Version === 1) {
      return new Response(text, {
        status: 402,
        statusText: 'Payment Required',
        headers,
      })
    }

    if (
      parsed.x402Version === 2 &&
      Array.isArray(parsed.accepts) &&
      parsed.resource &&
      typeof parsed.resource === 'object'
    ) {
      const paymentRequired = {
        x402Version: 2 as const,
        error: typeof parsed.error === 'string' ? parsed.error : undefined,
        resource: parsed.resource as { url: string; description?: string; mimeType?: string },
        accepts: parsed.accepts,
        extensions:
          parsed.extensions === null || parsed.extensions === undefined
            ? null
            : (parsed.extensions as Record<string, unknown>),
      }
      try {
        headers.set(
          'PAYMENT-REQUIRED',
          encodePaymentRequiredHeader(
            paymentRequired as Parameters<typeof encodePaymentRequiredHeader>[0],
          ),
        )
      } catch {
        return new Response(text, { status: 400, headers: res.headers })
      }
      return new Response(text, {
        status: 402,
        statusText: 'Payment Required',
        headers,
      })
    }

    const synthetic = buildSyntheticPaymentRequiredV2(
      resolveRequestUrl(input as RequestInfo),
      parsed,
    )
    if (synthetic) {
      try {
        headers.set(
          'PAYMENT-REQUIRED',
          encodePaymentRequiredHeader(synthetic),
        )
        return new Response(text, {
          status: 402,
          statusText: 'Payment Required',
          headers,
        })
      } catch {
        return new Response(text, { status: 400, headers: res.headers })
      }
    }

    return new Response(text, { status: 400, headers: res.headers })
  }
}

/**
 * `@x402/fetch` sends **`PAYMENT-SIGNATURE`** for x402 v2 challenges. Some gateways only accept
 * **`X-PAYMENT`** (v1-style header name). Duplicate the value so both are present on the retry.
 *
 * Avoid `new Request(existingRequest)` on an already-used Request (body consumed); read headers
 * from the live Request and use **`clone()`** only when building a modified outbound request.
 */
export function fetchMirrorPaymentSignatureToXPayment(
  inner: typeof fetch = fetch,
): typeof fetch {
  return (input, init) => {
    if (input instanceof Request) {
      const sig = input.headers.get('PAYMENT-SIGNATURE')
      if (!sig || input.headers.get('X-PAYMENT')) {
        return inner(input, init)
      }
      const headers = new Headers(input.headers)
      headers.set('X-PAYMENT', sig)
      return inner(new Request(input.clone(), { headers }))
    }

    const req = new Request(input as RequestInfo, init)
    const sig = req.headers.get('PAYMENT-SIGNATURE')
    if (!sig || req.headers.get('X-PAYMENT')) {
      return inner(req)
    }
    const headers = new Headers(req.headers)
    headers.set('X-PAYMENT', sig)
    return inner(new Request(req, { headers }))
  }
}
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
  const paidFetch = fetchMirrorPaymentSignatureToXPayment(fetch)
  const with402 = fetchNormalizePaymentRequired400Response(paidFetch)
  return wrapFetchWithPayment(with402, client)
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

/**
 * Default is `khWorkflowCallUrl('microtip')` (Vite dev: same-origin `/keeperhub/...` proxy; prod: public host).
 * Set VITE_X402_TEST_URL to override the host/path.
 */
export function defaultX402TestUrl() {
  return khWorkflowCallUrl('microtip')
}

/**
 * User-facing message for failed x402 `fetch` (network/CORS vs other errors).
 */
export function formatX402ClientError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  const c = e instanceof Error && e.cause instanceof Error ? e.cause.message : ''
  const combined = c ? `${m} (${c})` : m
  const low = combined.toLowerCase()
  if (
    low.includes('failed to fetch') ||
    low.includes('networkerror') ||
    low.includes('load failed') ||
    low.includes('cors')
  ) {
    return (
      combined +
      ' — Often this is CORS: the x402 **retry** sends custom headers (e.g. PAYMENT-SIGNATURE). ' +
      'In dev, use same-origin Vite proxies — `/keeperhub` → KeeperHub paid calls, `/gateway` → workflow gateway — ' +
      'so retries are not blocked. Leave `VITE_X402_TEST_URL` empty for the default KeeperHub proxy.'
    )
  }
  return combined
}
