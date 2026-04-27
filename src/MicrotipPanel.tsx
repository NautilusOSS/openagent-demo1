import { useCallback, useMemo, useState } from 'react'
import { formatUnits } from 'viem'
import { useAccount, useChainId, usePublicClient, useReadContract, useWalletClient } from 'wagmi'
import { base } from 'wagmi/chains'
import {
  createX402Fetch,
  defaultX402TestUrl,
  tryDecodePaymentFromResponse,
} from './lib/x402'

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const

const erc20BalanceAbi = [
  {
    name: 'balanceOf',
    type: 'function' as const,
    stateMutability: 'view' as const,
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
] as const

type MicrotipStatus = 'idle' | 'paying' | 'done' | 'err'

export function MicrotipPanel() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const onBaseMainnet = isConnected && chainId === base.id

  const { data: usdcRaw } = useReadContract({
    address: USDC_BASE,
    abi: erc20BalanceAbi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && onBaseMainnet) },
  })

  const [url, setUrl] = useState(() => defaultX402TestUrl())
  const [jsonBody, setJsonBody] = useState('{}')
  const [status, setStatus] = useState<MicrotipStatus>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [resultText, setResultText] = useState<string | null>(null)
  const [paymentInfo, setPaymentInfo] = useState<string | null>(null)

  const fetchWithPay = useMemo(() => {
    if (!onBaseMainnet || !walletClient || !publicClient) return null
    try {
      return createX402Fetch(walletClient, publicClient)
    } catch {
      return null
    }
  }, [onBaseMainnet, walletClient, publicClient])

  const usdcLabel = (() => {
    if (!onBaseMainnet || usdcRaw === undefined) return '—'
    return `${formatUnits(usdcRaw, 6)} USDC`
  })()

  const run = useCallback(async () => {
    if (!fetchWithPay) {
      setErr('Connect a wallet and switch to Base mainnet.')
      return
    }
    let body: string
    try {
      const parsed = JSON.parse(jsonBody) as unknown
      body = JSON.stringify(parsed)
    } catch {
      setErr('Body must be valid JSON (e.g. {} for no inputs).')
      return
    }
    setErr(null)
    setResultText(null)
    setPaymentInfo(null)
    setStatus('paying')
    try {
      const res = await fetchWithPay(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      const text = await res.text()
      const payment = tryDecodePaymentFromResponse(res)
      if (payment) {
        setPaymentInfo(
          typeof payment === 'object'
            ? JSON.stringify(payment, null, 2)
            : String(payment),
        )
      }
      if (!res.ok) {
        setErr(
          `HTTP ${res.status}: ${text.slice(0, 400)}${text.length > 400 ? '…' : ''}`,
        )
        setStatus('err')
        return
      }
      setResultText(text)
      setStatus('done')
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setErr(m)
      setStatus('err')
    }
  }, [fetchWithPay, jsonBody, url])

  return (
    <section className="card">
      <h2>x402 microtip</h2>
      <p className="muted sm">
        <strong>microtip</strong> uses <code>@x402/fetch</code> +{' '}
        <code>ExactEvmScheme</code> (EIP-3009 USDC on Base). After a 402, your
        wallet signs typed data, then the request retries with a payment
        header. This matches how paid workflow calls (e.g. on{' '}
        <a
          href="https://app.keeperhub.com"
          target="_blank"
          rel="noreferrer"
        >
          KeeperHub
        </a>
        ) expect x402.
      </p>
      <dl className="kv">
        <div>
          <dt>USDC on Base (mainnet)</dt>
          <dd>{onBaseMainnet ? usdcLabel : 'Connect and switch to Base'}</dd>
        </div>
        <div>
          <dt>Token</dt>
          <dd>
            <code className="mono-sm">{USDC_BASE}</code>
          </dd>
        </div>
      </dl>
      {!onBaseMainnet && isConnected && (
        <p className="status-warn" role="status">
          Switch to <strong>Base</strong> (not Sepolia) and fund a small USDC
          balance for the paid call. USDC: Coinbase, bridge, or exchange to
          your address.
        </p>
      )}
      <label>
        POST URL
        <input
          className="input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          autoComplete="off"
          disabled={!onBaseMainnet}
        />
      </label>
      <p className="muted sm">
        In <code>npm run dev</code> the default path is proxied to app.keeperhub
        (see <code>vite.config.ts</code>) to avoid browser CORS. For{' '}
        <code>preview</code> / static hosting, set <code>VITE_X402_TEST_URL</code>
        or put a reverse proxy in front.
      </p>
      <label>
        JSON body
        <textarea
          className="input"
          style={{ minHeight: '4.5rem', fontFamily: 'var(--mono, monospace)' }}
          value={jsonBody}
          onChange={(e) => setJsonBody(e.target.value)}
          disabled={!onBaseMainnet}
        />
      </label>
      {err && (
        <p className="status-err" role="alert">
          {err}
        </p>
      )}
      <div className="row">
        <button
          type="button"
          className="btn-primary"
          disabled={!onBaseMainnet || !fetchWithPay || status === 'paying'}
          onClick={() => void run()}
        >
          {status === 'paying' ? 'Paying (sign in wallet if prompted)…' : 'Pay and call'}
        </button>
      </div>
      {paymentInfo && (
        <p className="wrap-break">
          <span className="label">PAYMENT-RESPONSE (decoded if possible)</span>
          <code>{paymentInfo}</code>
        </p>
      )}
      {resultText && (
        <p className="wrap-break">
          <span className="label">Response body</span>
          <code>{resultText}</code>
        </p>
      )}
    </section>
  )
}
