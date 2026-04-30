/**
 * KeeperHub public API helpers (listed workflows, call URLs) for the demo app.
 * List: GET /api/mcp/workflows — see OpenAPI info.x-guidance on app.keeperhub.com.
 */

/** Workflows the UI offers as pickable “demo” options (order preserved in the picker). */
export const WORKFLOW_PICKER_SLUGS = [
  'microtip',
  'pack-0-10-demo',
] as const

export type WorkflowPickerSlug = (typeof WORKFLOW_PICKER_SLUGS)[number]

export type KHWorkflowListItem = {
  name: string
  description: string
  listedSlug: string
  priceUsdcPerCall: string
  isListed?: boolean
}

type KHWorkflowsResponse = { items: KHWorkflowListItem[] }

const CALL_PATH = (slug: string) =>
  `/api/mcp/workflows/${encodeURIComponent(slug)}/call`

const LIST_PATH = '/api/mcp/workflows'

export const KH_PROD_ORIGIN = 'https://app.keeperhub.com' as const

/**
 * Same-origin dev prefix → local gateway (`localhost:3001`) via `vite.config.ts` (`/local-aave` proxy).
 * Used to merge `GET /workflows` from a local server into the KeeperHub catalog in dev.
 */
export const LOCAL_OPEN_AGENT_DEV_PROXY_PREFIX = '/local-aave' as const

/**
 * Public `https://app.keeperhub.com/.../call` (for display / docs; not necessarily the URL the
 * browser should use in local dev — see `khWorkflowCallUrl`).
 */
export function khPublicWorkflowCallUrl(slug: string): string {
  return `${KH_PROD_ORIGIN}${CALL_PATH(slug)}`
}

/**
 * x402 `POST` target for a given listed workflow `slug`.
 *
 * In **`npm run dev`**, when `VITE_X402_TEST_URL` is unset, this returns a **same-origin** path
 * (`/keeperhub/.../call` via the Vite proxy) so the **retry after signing** (with
 * `PAYMENT-SIGNATURE`) is not blocked by CORS. In production builds it uses the public host.
 * Set `VITE_X402_TEST_URL` to force a different base.
 */
export function khWorkflowCallUrl(slug: string): string {
  const path = CALL_PATH(slug)
  const fromEnv = import.meta.env.VITE_X402_TEST_URL as string | undefined
  if (fromEnv) {
    try {
      const u = new URL(fromEnv)
      u.pathname = path
      return u.toString()
    } catch {
      if (/\/workflows\//.test(fromEnv)) {
        return fromEnv.replace(
          /\/workflows\/[^/]+\/call/,
          `/workflows/${encodeURIComponent(slug)}/call`,
        )
      }
    }
  }
  if (import.meta.env.DEV) {
    return `${globalThis.location.origin}/keeperhub${path}`
  }
  return `${KH_PROD_ORIGIN}${path}`
}

/**
 * `GET` URL for the public catalog (name, description, `listedSlug`, `priceUsdcPerCall`, …).
 * In dev, uses the Vite `/keeperhub` proxy so the list loads same-origin. Without
 * that, falls back to the public host. If the request fails, the UI still shows the two
 * slugs with a short fallback description.
 */
export function khWorkflowsListUrl(): string {
  if (import.meta.env.DEV) {
    return `${globalThis.location.origin}/keeperhub${LIST_PATH}`
  }
  const fromEnv = import.meta.env.VITE_X402_TEST_URL as string | undefined
  if (fromEnv) {
    try {
      return new URL(LIST_PATH, new URL(fromEnv).origin + '/').href
    } catch {
      /* fall through to public */
    }
  }
  return `${KH_PROD_ORIGIN}${LIST_PATH}`
}

/** Best-effort parse for `GET /workflows` on the local open-agent server (shape may vary). */
function parseLocalWorkflowsList(json: unknown): KHWorkflowListItem[] {
  const rows: unknown[] = []
  if (Array.isArray(json)) {
    rows.push(...json)
  } else if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>
    if (Array.isArray(o.workflows)) rows.push(...o.workflows)
    else if (Array.isArray(o.items)) rows.push(...o.items)
    else if (Array.isArray(o.data)) rows.push(...o.data)
  }
  const picker = WORKFLOW_PICKER_SLUGS as readonly string[]
  const out: KHWorkflowListItem[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const rawId = r.listedSlug ?? r.slug ?? r.id ?? r.workflowId
    const id = typeof rawId === 'string' ? rawId : ''
    if (!id || !picker.includes(id)) continue
    const name =
      typeof r.name === 'string'
        ? r.name
        : typeof r.title === 'string'
          ? r.title
          : id
    const description = typeof r.description === 'string' ? r.description : ''
    let priceUsdcPerCall = ''
    if (typeof r.priceUsdcPerCall === 'string') priceUsdcPerCall = r.priceUsdcPerCall
    else if (typeof r.price === 'string' || typeof r.price === 'number')
      priceUsdcPerCall = String(r.price)
    out.push({ listedSlug: id, name, description, priceUsdcPerCall })
  }
  return out
}

export async function fetchKeeperhubWorkflows(): Promise<KHWorkflowListItem[]> {
  const res = await fetch(khWorkflowsListUrl())
  if (!res.ok) {
    throw new Error(`GET workflows: HTTP ${res.status}`)
  }
  const data = (await res.json()) as KHWorkflowsResponse
  let items = data.items ?? []

  if (import.meta.env.DEV) {
    try {
      const localListUrl = `${globalThis.location.origin}${LOCAL_OPEN_AGENT_DEV_PROXY_PREFIX}/workflows`
      const lr = await fetch(localListUrl)
      if (lr.ok) {
        const localRows = parseLocalWorkflowsList(await lr.json())
        const bySlug = new Map(items.map((i) => [i.listedSlug, i]))
        for (const row of localRows) {
          bySlug.set(row.listedSlug, row)
        }
        items = [...bySlug.values()]
      }
    } catch {
      /* optional local GET /workflows */
    }
  }

  return items
}
