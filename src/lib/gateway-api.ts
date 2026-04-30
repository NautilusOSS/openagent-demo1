/**
 * Paid workflow gateway HTTP API (execute, list, health).
 *
 * Schema reference: **`lendpay-backend`** (`WorkflowDefinition`, `executeWorkflowBodySchema`, routes).
 * - `GET /workflows` — JSON array of `{ id, name, description, paymentMinUsd, paymentMaxUsd, requiredFields }`
 * - `POST /workflows/:workflowId/execute` — body `{ chain, protocol, action, targetAddress, asset, amount }` (strings;
 *   `targetAddress` must match `/^0x[a-fA-F0-9]{40}$/`. Body `amount` (USD) is the x402 USDC charge
 *   and must fall in each workflow’s `paymentMinUsd`–`paymentMaxUsd` from `GET /workflows`.
 *
 * `BASE_URL` is configurable via env or dev `/gateway` proxy (see `GatewayExecutePanel`).
 */

/** Mirrors lendpay-backend `src/types/workflow.ts` — `WorkflowDefinition`. */
export type LendpayWorkflowDefinition = {
  id: string
  name: string
  description: string
  paymentMinUsd: string
  paymentMaxUsd: string
  requiredFields: string[]
}

export const GATEWAY_WORKFLOW_IDS = [
  'aave-repay',
  'compound-repay',
  'bridge-and-repay',
  'dorkfi-repay',
] as const

export type GatewayWorkflowId = (typeof GATEWAY_WORKFLOW_IDS)[number]

export type ExecuteRequestBody = {
  chain: string
  protocol: string
  action: string
  targetAddress: string
  asset: string
  amount: string
}

/** Catalog row: lendpay shape plus legacy aliases used elsewhere. */
export type GatewayWorkflowRow = Partial<LendpayWorkflowDefinition> & {
  workflowId?: string
  slug?: string
  listedSlug?: string
  /** @deprecated Older lendpay catalog — prefer paymentMinUsd / paymentMaxUsd */
  priceUsd?: number
  price?: string
  priceUsdcPerCall?: string
}

/** Price line for workflow cards — variable gateway fee range from lendpay GET /workflows */
export function formatGatewayWorkflowPrice(row: GatewayWorkflowRow | undefined): string {
  if (!row) return '—'
  const min = row.paymentMinUsd
  const max = row.paymentMaxUsd
  if (typeof min === 'string' && typeof max === 'string' && min.trim() && max.trim()) {
    return `$${min.trim()}–$${max.trim()} USD`
  }
  if (typeof row.priceUsd === 'number' && Number.isFinite(row.priceUsd)) {
    return `$${row.priceUsd.toFixed(2)} USD`
  }
  const legacy = row.priceUsdcPerCall ?? row.price
  if (legacy != null && String(legacy).trim() !== '') return String(legacy)
  return '—'
}

/** Legacy stub for backends that accept any non-empty `X-PAYMENT`. Prefer x402 `fetch` + `executeGatewayWorkflowWithFetch`. */
export const GATEWAY_X_PAYMENT_STUB = 'stub'

function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/, '')
}

/**
 * Default origin for gateway calls.
 * - `VITE_GATEWAY_BASE_URL` — full base (e.g. `http://localhost:3001`).
 * - Dev without env: same-origin `/gateway` → Vite proxy to localhost:3001.
 * - Prod build without env: `http://localhost:3001`.
 */
export function gatewayBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_GATEWAY_BASE_URL as string | undefined
  if (fromEnv?.trim()) return stripTrailingSlash(fromEnv.trim())
  if (import.meta.env.DEV) {
    return `${globalThis.location.origin}/gateway`
  }
  return 'http://localhost:3001'
}

export function gatewayUrl(path: string): string {
  const base = gatewayBaseUrl()
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

export function workflowsListUrl(): string {
  return gatewayUrl('/workflows')
}

export function healthUrl(): string {
  return gatewayUrl('/health')
}

export function executeUrl(workflowId: string): string {
  const id = encodeURIComponent(workflowId)
  return gatewayUrl(`/workflows/${id}/execute`)
}

export async function fetchGatewayHealth(): Promise<Response> {
  return fetch(healthUrl(), { method: 'GET' })
}

/** Normalizes GET /workflows — lendpay returns a bare JSON array */
export function parseWorkflowsResponse(json: unknown): GatewayWorkflowRow[] {
  if (Array.isArray(json)) return json as GatewayWorkflowRow[]
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>
    if (Array.isArray(o.workflows)) return o.workflows as GatewayWorkflowRow[]
    if (Array.isArray(o.items)) return o.items as GatewayWorkflowRow[]
    if (Array.isArray(o.data)) return o.data as GatewayWorkflowRow[]
  }
  return []
}

export async function fetchGatewayWorkflows(): Promise<GatewayWorkflowRow[]> {
  const res = await fetch(workflowsListUrl(), { method: 'GET' })
  if (!res.ok) {
    throw new Error(`GET /workflows: HTTP ${res.status}`)
  }
  const data = (await res.json()) as unknown
  return parseWorkflowsResponse(data)
}

export type ExecuteGatewayOptions = {
  workflowId: string
  body: ExecuteRequestBody
  bearerToken: string
  /** Override default stub */
  xPayment?: string
}

export async function executeGatewayWorkflow(
  opts: ExecuteGatewayOptions,
): Promise<Response> {
  const token = opts.bearerToken.trim()
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'X-PAYMENT': (opts.xPayment ?? GATEWAY_X_PAYMENT_STUB).trim() || GATEWAY_X_PAYMENT_STUB,
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  return fetch(executeUrl(opts.workflowId), {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body),
  })
}

/** POST execute using a paid `fetch` (e.g. `createX402Fetch`) — no stub `X-PAYMENT`. */
export async function executeGatewayWorkflowWithFetch(
  fetchImpl: typeof fetch,
  opts: Pick<ExecuteGatewayOptions, 'workflowId' | 'body' | 'bearerToken'>,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const token = opts.bearerToken.trim()
  if (token) headers.Authorization = `Bearer ${token}`
  return fetchImpl(executeUrl(opts.workflowId), {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body),
  })
}

/** Workflow id → default chain / protocol / action for the form when picking a card */
export const WORKFLOW_DEFAULT_PROTOCOL_ACTION: Record<
  GatewayWorkflowId,
  { chain: string; protocol: string; action: string }
> = {
  'aave-repay': { chain: 'base', protocol: 'aave', action: 'repay' },
  'compound-repay': { chain: 'base', protocol: 'compound', action: 'repay' },
  'bridge-and-repay': { chain: 'base', protocol: 'bridge', action: 'repay' },
  'dorkfi-repay': { chain: 'algorand', protocol: 'dorkfi', action: 'repay' },
}

export function workflowRowId(row: GatewayWorkflowRow): string | undefined {
  return (
    (typeof row.workflowId === 'string' && row.workflowId) ||
    (typeof row.id === 'string' && row.id) ||
    (typeof row.slug === 'string' && row.slug) ||
    (typeof row.listedSlug === 'string' && row.listedSlug) ||
    undefined
  )
}
