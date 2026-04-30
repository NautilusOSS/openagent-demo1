import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatUnits, isAddress } from 'viem'
import { base } from 'wagmi/chains'
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useWalletClient,
} from 'wagmi'
import {
  executeGatewayWorkflowWithFetch,
  fetchGatewayHealth,
  fetchGatewayWorkflows,
  formatGatewayWorkflowPrice,
  gatewayBaseUrl,
  GATEWAY_WORKFLOW_IDS,
  type ExecuteRequestBody,
  type GatewayWorkflowRow,
  workflowRowId,
  WORKFLOW_DEFAULT_PROTOCOL_ACTION,
  workflowsListUrl,
} from './lib/gateway-api'
import {
  createX402Fetch,
  formatX402ClientError,
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

type PanelStatus = 'idle' | 'paying' | 'done' | 'err'

type GatewayErrorPayload = {
  error?: string
  code?: string
  details?: unknown
}

function parseErrorPayload(text: string): GatewayErrorPayload | null {
  try {
    const j = JSON.parse(text) as unknown
    return j && typeof j === 'object' ? (j as GatewayErrorPayload) : null
  } catch {
    return null
  }
}

export function GatewayExecutePanel() {
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

  const fetchWithPay = useMemo(() => {
    if (!onBaseMainnet || !walletClient || !publicClient) return null
    try {
      return createX402Fetch(walletClient, publicClient)
    } catch {
      return null
    }
  }, [onBaseMainnet, walletClient, publicClient])

  const [baseUrlNote] = useState(() => gatewayBaseUrl())

  const [workflowId, setWorkflowId] = useState<string>(GATEWAY_WORKFLOW_IDS[0])
  const [bearerToken, setBearerToken] = useState(
    () => (import.meta.env.VITE_GATEWAY_API_TOKEN as string | undefined)?.trim() ?? '',
  )
  const [chain, setChain] = useState(WORKFLOW_DEFAULT_PROTOCOL_ACTION['aave-repay'].chain)
  const [protocol, setProtocol] = useState(WORKFLOW_DEFAULT_PROTOCOL_ACTION['aave-repay'].protocol)
  const [action, setAction] = useState(WORKFLOW_DEFAULT_PROTOCOL_ACTION['aave-repay'].action)
  const [targetAddress, setTargetAddress] = useState('')
  const [asset, setAsset] = useState('USDC')
  const [amount, setAmount] = useState('10.00')

  const [catalog, setCatalog] = useState<GatewayWorkflowRow[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogErr, setCatalogErr] = useState<string | null>(null)

  const [healthStatus, setHealthStatus] = useState<'idle' | 'ok' | 'err' | 'checking'>('idle')
  const [healthDetail, setHealthDetail] = useState<string | null>(null)

  const [status, setStatus] = useState<PanelStatus>('idle')
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [successPayload, setSuccessPayload] = useState<string | null>(null)
  const [paymentInfo, setPaymentInfo] = useState<string | null>(null)

  const usdcLabel = (() => {
    if (!onBaseMainnet || usdcRaw === undefined) return '—'
    return `${formatUnits(usdcRaw, 6)} USDC`
  })()

  /** Falls back to connected wallet when the field is left empty */
  const resolvedTargetAddress = useMemo(() => {
    const t = targetAddress.trim()
    if (t) return t
    return address?.trim() ?? ''
  }, [targetAddress, address])

  const applyWorkflowDefaults = useCallback((id: string) => {
    if (id in WORKFLOW_DEFAULT_PROTOCOL_ACTION) {
      const d = WORKFLOW_DEFAULT_PROTOCOL_ACTION[id as keyof typeof WORKFLOW_DEFAULT_PROTOCOL_ACTION]
      setChain(d.chain)
      setProtocol(d.protocol)
      setAction(d.action)
    }
  }, [])

  const loadWorkflows = useCallback(() => {
    setCatalogLoading(true)
    setCatalogErr(null)
    void fetchGatewayWorkflows()
      .then((rows) => setCatalog(rows))
      .catch((e: unknown) => {
        setCatalogErr(
          e instanceof Error ? e.message : 'Could not load workflows.',
        )
      })
      .finally(() => setCatalogLoading(false))
  }, [])

  /* eslint-disable react-hooks/set-state-in-effect -- mount fetch for GET /workflows catalog */
  useEffect(() => {
    void loadWorkflows()
  }, [loadWorkflows])
  /* eslint-enable react-hooks/set-state-in-effect */

  const checkHealth = useCallback(async () => {
    setHealthStatus('checking')
    setHealthDetail(null)
    try {
      const res = await fetchGatewayHealth()
      const text = await res.text()
      if (res.ok) {
        setHealthStatus('ok')
        setHealthDetail(text.slice(0, 200))
      } else {
        setHealthStatus('err')
        setHealthDetail(`HTTP ${res.status}: ${text.slice(0, 200)}`)
      }
    } catch (e) {
      setHealthStatus('err')
      setHealthDetail(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const catalogIds = useMemo(() => {
    const ids = new Set<string>()
    for (const row of catalog) {
      const id = workflowRowId(row)
      if (id) ids.add(id)
    }
    return ids
  }, [catalog])

  const presetIds = useMemo(() => new Set<string>(GATEWAY_WORKFLOW_IDS), [])

  const bodyForSubmit = useMemo((): ExecuteRequestBody => {
    return {
      chain: chain.trim(),
      protocol: protocol.trim(),
      action: action.trim(),
      targetAddress: resolvedTargetAddress,
      asset: asset.trim(),
      amount: amount.trim(),
    }
  }, [chain, protocol, action, resolvedTargetAddress, asset, amount])

  const runExecute = useCallback(async () => {
    if (!fetchWithPay) {
      setErrMsg('Connect a wallet and switch to Base mainnet to pay via x402.')
      setStatus('err')
      return
    }

    setErrMsg(null)
    setSuccessPayload(null)
    setPaymentInfo(null)

    const ta = bodyForSubmit.targetAddress
    if (!ta || !isAddress(ta as `0x${string}`)) {
      setErrMsg(
        'Enter a valid targetAddress (0x + 40 hex), or connect a wallet to use your address.',
      )
      setStatus('err')
      return
    }

    setStatus('paying')
    try {
      const res = await executeGatewayWorkflowWithFetch(fetchWithPay, {
        workflowId,
        body: bodyForSubmit,
        bearerToken,
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
        const parsed = parseErrorPayload(text)
        const parts: string[] = [`HTTP ${res.status}`]
        if (parsed?.code) parts.push(parsed.code)
        if (parsed?.error) parts.push(parsed.error)
        else if (text) parts.push(text.slice(0, 500))
        setErrMsg(parts.filter(Boolean).join(': '))
        setStatus('err')
        return
      }
      setSuccessPayload(text || '{}')
      setStatus('done')
    } catch (e) {
      setErrMsg(formatX402ClientError(e))
      setStatus('err')
    }
  }, [workflowId, bodyForSubmit, bearerToken, fetchWithPay])

  return (
    <section className="card gateway-panel">
      <h2>Workflow gateway (execute)</h2>
      <p className="muted sm">
        Same flow as <strong>KeeperHub paid workflows</strong>: <code>@x402/fetch</code> + EIP-3009 USDC on Base.{' '}
        <code>GET /workflows</code> lists <code>paymentMinUsd</code>/<code>paymentMaxUsd</code>;{' '}
        <strong>amount</strong> in the body is the USDC gateway fee (within that range). The gateway returns
        an x402 challenge on the first <code>POST …/execute</code> without payment; after you sign, the client
        retries with <code>PAYMENT-SIGNATURE</code> / <code>X-PAYMENT</code>. Body matches{' '}
        <strong>lendpay-backend</strong> <code>executeWorkflowBodySchema</code>. Optional{' '}
        <code>Authorization: Bearer …</code> is the KeeperHub API key. Base URL:{' '}
        <code>VITE_GATEWAY_BASE_URL</code>, or dev same-origin <code>/gateway</code> → localhost:3001.
        Effective base: <strong>{baseUrlNote}</strong>
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
          Switch to <strong>Base</strong> mainnet and keep enough USDC — you pay the{' '}
          <strong>amount</strong> field (within each workflow’s min/max from <code>GET /workflows</code>).
        </p>
      )}

      <div className="gateway-toolbar">
        <button
          type="button"
          className="btn-ghost"
          disabled={healthStatus === 'checking'}
          onClick={() => void checkHealth()}
        >
          {healthStatus === 'checking' ? 'Checking…' : 'GET /health'}
        </button>
        <button type="button" className="btn-ghost" onClick={() => loadWorkflows()}>
          {catalogLoading ? 'Loading…' : 'Refresh workflows'}
        </button>
        <span className="gateway-health" aria-live="polite">
          {healthStatus === 'ok' && (
            <span className="status-ok gateway-health-dot" title={healthDetail ?? ''}>
              Health OK
            </span>
          )}
          {healthStatus === 'err' && (
            <span className="status-err gateway-health-dot" title={healthDetail ?? ''}>
              Health failed
            </span>
          )}
        </span>
      </div>
      {healthDetail && healthStatus !== 'idle' && (
        <p className="muted sm wrap-break" role="status">
          <code>{healthDetail}</code>
        </p>
      )}

      <p className="label">Workflow</p>
      {catalogErr && (
        <p className="muted sm" role="status">
          Catalog: {catalogErr} — using built-in ids below.
        </p>
      )}
      <div className="workflow-pick" role="group" aria-label="Gateway workflow">
        {GATEWAY_WORKFLOW_IDS.map((id) => {
          const row =
            catalog.find((r) => workflowRowId(r) === id) ?? undefined
          const name = row?.name ?? id
          const desc =
            row?.description?.trim() ??
            (catalogIds.has(id) ? 'Listed on gateway.' : 'Default preset.')
          const price = formatGatewayWorkflowPrice(row)
          const selected = workflowId === id
          return (
            <button
              key={id}
              type="button"
              className={
                selected ? 'workflow-card workflow-card--selected' : 'workflow-card'
              }
              aria-pressed={selected}
              onClick={() => {
                setWorkflowId(id)
                applyWorkflowDefaults(id)
              }}
            >
              <div className="workflow-card__title">{name}</div>
              <p className="workflow-card__slug mono-sm">/{id}</p>
              <p className="workflow-card__desc">{desc}</p>
              <div className="workflow-card__foot">
                <span className="workflow-card__price">{price}</span>
                {selected && <span className="workflow-card__sel">Selected</span>}
              </div>
            </button>
          )
        })}
      </div>

      <label className="gateway-field">
        workflowId (override or type a custom id)
        <input
          className="input mono-sm"
          value={workflowId}
          onChange={(e) => {
            const v = e.target.value.trim()
            setWorkflowId(v)
            if (presetIds.has(v)) applyWorkflowDefaults(v)
          }}
          autoComplete="off"
        />
      </label>

      <label className="gateway-field">
        API bearer token
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder="KeeperHub-style API key"
          value={bearerToken}
          onChange={(e) => setBearerToken(e.target.value)}
        />
      </label>

      <div className="gateway-grid">
        <label>
          chain
          <input
            className="input"
            value={chain}
            onChange={(e) => setChain(e.target.value)}
          />
        </label>
        <label>
          protocol
          <input
            className="input"
            value={protocol}
            onChange={(e) => setProtocol(e.target.value)}
          />
        </label>
        <label>
          action
          <input
            className="input"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
        </label>
        <label className="gateway-span-2">
          targetAddress (optional if wallet connected)
          <input
            className="input mono-sm"
            value={targetAddress}
            onChange={(e) => setTargetAddress(e.target.value.trim())}
            placeholder={address ? `Default ${address.slice(0, 6)}…${address.slice(-4)}` : '0x…'}
          />
        </label>
        <label>
          asset
          <input
            className="input"
            value={asset}
            onChange={(e) => setAsset(e.target.value)}
          />
        </label>
        <label>
          amount (USD gateway fee — must match signed payment)
          <input
            className="input"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
          />
        </label>
      </div>

      <p className="muted sm">
        <code>GET /workflows</code> (same host):{' '}
        <code className="mono-sm">{workflowsListUrl()}</code> — lendpay-backend returns{' '}
        <code>paymentMinUsd</code>/<code>paymentMaxUsd</code>, <code>requiredFields</code>, etc. Local gateway
        must set <code>X402_RECEIVING_ADDRESS</code> so missing <code>X-PAYMENT</code> responses include an
        x402 v2 challenge (amount matches body <code>amount</code> within range).
      </p>

      <div className="row">
        <button
          type="button"
          className="btn-primary"
          disabled={!fetchWithPay || status === 'paying'}
          onClick={() => void runExecute()}
        >
          {status === 'paying' ? 'Paying (sign if prompted)…' : 'Pay and execute workflow'}
        </button>
      </div>

      {errMsg && (
        <p className="status-err" role="alert">
          {errMsg}
        </p>
      )}
      {paymentInfo && (
        <p className="wrap-break">
          <span className="label">PAYMENT-RESPONSE (decoded if possible)</span>
          <code>{paymentInfo}</code>
        </p>
      )}
      {successPayload && status === 'done' && (
        <p className="wrap-break" role="status">
          <span className="label">Response</span>
          <code>{successPayload}</code>
        </p>
      )}
    </section>
  )
}
