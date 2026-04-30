import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatUnits } from 'viem'
import { useAccount, useChainId, usePublicClient, useReadContract, useWalletClient } from 'wagmi'
import { base } from 'wagmi/chains'
import {
  fetchKeeperhubWorkflows,
  khPublicWorkflowCallUrl,
  khWorkflowCallUrl,
  type KHWorkflowListItem,
  type WorkflowPickerSlug,
  WORKFLOW_PICKER_SLUGS,
} from './lib/keeperhub'
import {
  createX402Fetch,
  formatX402ClientError,
  tryDecodePaymentFromResponse,
} from './lib/x402'
import { defaultWorkflowExecuteBody } from './lib/workflow-default-body'

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

  const [selectedWorkflow, setSelectedWorkflow] =
    useState<WorkflowPickerSlug>('microtip')
  const [url, setUrl] = useState(() => khWorkflowCallUrl('microtip'))
  const [jsonBody, setJsonBody] = useState('{}')
  const [status, setStatus] = useState<MicrotipStatus>('idle')
  const [err, setErr] = useState<string | null>(null)
  const [resultText, setResultText] = useState<string | null>(null)
  const [paymentInfo, setPaymentInfo] = useState<string | null>(null)
  const [catalogBySlug, setCatalogBySlug] = useState<
    Partial<Record<WorkflowPickerSlug, KHWorkflowListItem>>
  >({})
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchKeeperhubWorkflows()
      .then((items) => {
        if (cancelled) return
        const next: Partial<Record<WorkflowPickerSlug, KHWorkflowListItem>> = {}
        for (const slug of WORKFLOW_PICKER_SLUGS) {
          const found = items.find((i) => i.listedSlug === slug)
          if (found) next[slug] = found
        }
        setCatalogBySlug(next)
      })
      .catch((e) => {
        if (cancelled) return
        setCatalogError(
          e instanceof Error ? e.message : 'Could not load workflow list.',
        )
      })
      .finally(() => {
        if (cancelled) return
        setCatalogLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onPickWorkflow = (slug: WorkflowPickerSlug) => {
    setSelectedWorkflow(slug)
    setUrl(khWorkflowCallUrl(slug))
    setJsonBody(defaultWorkflowExecuteBody())
  }

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
      setErr(formatX402ClientError(e))
      setStatus('err')
    }
  }, [fetchWithPay, jsonBody, url])

  return (
    <section className="card">
      <h2>KeeperHub paid workflows</h2>
      <p className="muted sm">
        Paid workflow calls use <code>@x402/fetch</code> +{' '}
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
      <p className="label">Workflow</p>
      {catalogError && (
        <p className="muted sm" role="status">
          Catalog: {catalogError} (cards still use the call URL for each slug.)
        </p>
      )}
      {catalogLoading && (
        <p className="muted sm" aria-live="polite">
          Loading workflow descriptions from KeeperHub…
        </p>
      )}
      <div
        className="workflow-pick"
        role="group"
        aria-label="KeeperHub workflow to call"
      >
        {WORKFLOW_PICKER_SLUGS.map((slug) => {
          const row = catalogBySlug[slug]
          const name = row?.name ?? slug
          const desc =
            row?.description?.trim() ??
            'Not returned in the public list yet; the POST URL still targets this slug. Try Pay and call if your org listed it.'
          const price =
            row?.priceUsdcPerCall != null && row.priceUsdcPerCall !== ''
              ? `${row.priceUsdcPerCall} USDC / call`
              : '—'
          const isSelected = selectedWorkflow === slug
          return (
            <button
              type="button"
              key={slug}
              className={
                isSelected
                  ? 'workflow-card workflow-card--selected'
                  : 'workflow-card'
              }
              onClick={() => onPickWorkflow(slug)}
              aria-pressed={isSelected}
            >
              <div className="workflow-card__title">
                {name}
              </div>
              <p className="workflow-card__slug mono-sm">/{slug}</p>
              <p className="workflow-card__desc">{desc}</p>
              <div className="workflow-card__foot">
                <span className="workflow-card__price">{price}</span>
                {isSelected && (
                  <span className="workflow-card__sel">Selected</span>
                )}
              </div>
            </button>
          )
        })}
      </div>
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
      {import.meta.env.DEV && (
        <p className="muted sm" role="note">
          <strong>Local dev</strong> uses same-origin Vite proxies so x402 retries are not blocked
          by CORS:{' '}
          <code>{globalThis.location?.origin}/keeperhub/api/mcp/workflows/…/call</code> →
          app.keeperhub.com.
        </p>
      )}
      {import.meta.env.DEV && (
        <p className="muted sm">
          Public endpoint (for reference):{' '}
          <code className="mono-sm">
            {khPublicWorkflowCallUrl(selectedWorkflow)}
          </code>
        </p>
      )}
      <p className="muted sm">
        Production and <code>preview</code> use{' '}
        <code>https://app.keeperhub.com/…/call</code> unless you set{' '}
        <code>VITE_X402_TEST_URL</code> or a reverse proxy.
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
