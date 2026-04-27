# x402 payment work: KeeperHub workflows

This document describes the **work required to complete** [x402](https://www.x402.org) payments for [KeeperHub](https://github.com/KeeperHub/keeperhub) paid workflows, using the public product docs and the platform’s `staging` `specs/` as reference. It ties together protocol basics, the KeeperHub HTTP/MCP call path, and what you must implement on the **caller** side (agent or app) versus **platform** work in a self-hosted fork.

> **Source of truth (upstream)**  
> - Repository: [github.com/KeeperHub/keeperhub](https://github.com/KeeperHub/keeperhub) (Next.js app, `keeperhub-executor/`, `plugins/`, `app/api/`, `docs/`, `specs/`).  
> - x402 (Coinbase CDP): [CDP x402 documentation](https://docs.cdp.coinbase.com/x402).  
> - KeeperHub agent wallets overview: [x402 Wallets for AI Agents](https://docs.keeperhub.com/ai-tools/agent-wallets) (content mirrors `docs/ai-tools/agent-wallets.md` in the repo on `staging`).  
> - Creator-side paid flows: [Paid Workflows](https://docs.keeperhub.com/workflows/paid-workflows) (`docs/workflows/paid-workflows.md`).

---

## 1. How KeeperHub charges for a workflow call (x402 on Base)

Paid **read** workflows are invoked over HTTP, typically as:

- `POST https://app.keeperhub.com/api/mcp/workflows/{slug}/call`  
- With JSON `body` matching the workflow’s `inputSchema` (from [`/openapi.json`](https://app.keeperhub.com/openapi.json) or the MCP `search_workflows` / `call_workflow` tools).

**Without payment or an invalid attempt**, the route responds with **HTTP 402 Payment Required** and a machine-readable challenge. The **x402** path settles in **USDC on Base (chain id 8453)**. The canonical **Base mainnet USDC** contract used in challenges is **`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`** (also referenced in the [@keeperhub/wallet](https://github.com/KeeperHub/agentic-wallet) safety allowlist).

**Completing the payment** means: parse the 402 + payment instructions, have a wallet that can sign the **EIP-3009 USDC `transferWithAuthorization`–style** authorization the facilitator expects, **retry the same `POST` with the signed payload** in the appropriate header (per x402 v2, commonly `PAYMENT-SIGNATURE`; vendor docs may also mention `X-PAYMENT`—always follow the challenge the server issues). The server (or a **facilitator** it trusts) verifies and settles, then returns **200** with the workflow result.

> **This is not “send native ETH.”** The minimal Base dapp in the root of this repository connects with wagmi and sends **ETH**; x402 for KeeperHub is **USDC (ERC-20) with typed-data signing** and a 402/ retry loop, which is a different integration surface.

KeeperHub can also offer **MPP** (Machine Payment Protocol) for **Tempo** USDC.e; callers choose protocol based on which wallet/chain they fund. See the dual-protocol spec in the upstream repo: `specs/x402-mpp-dual-protocol.md` (if present on the branch you track).

---

## 2. Work: AI agents and MCP (recommended path for “complete” x402)

For agents, “complete” usually means **use an x402-capable wallet and fund Base USDC**, then call `call_workflow` (or the HTTP endpoint) and let the stack attach payment.

### 2.1 KeeperHub agentic wallet (official OSS path)

1. **Install the skill and safety hook** (idempotent):

   `npx @keeperhub/wallet skill install`

2. **Provision a wallet** (creates `~/.keeperhub/wallet.json` with HMAC to the signing proxy; no app account required for basic use):

   `npx @keeperhub/wallet add`

3. **Fund Base USDC** (test or small mainnet balance as appropriate):

   `npx @keeperhub/wallet fund`  
   `npx @keeperhub/wallet balance`

4. **Call paid workflows** via your agent’s MCP/HTTP path to `app.keeperhub.com` (or your deployment). The wallet package is built to pay **HTTP 402** (x402 on Base, MPP on Tempo where applicable) through KeeperHub’s **server-proxied Turnkey** model so the **private key never lives in the client**.

5. **Configure safety** in `~/.keeperhub/safety.json` (auto/ask/block thresholds, contract allowlist) for production use.

**References:** [Agentic wallet](https://docs.keeperhub.com/ai-tools/agentic-wallet), package [github.com/KeeperHub/agentic-wallet](https://github.com/KeeperHub/agentic-wallet), skill [keeperhub-wallet / SKILL.md](https://github.com/KeeperHub/agentic-wallet) (x402 + MPP, same allowlist addresses as in docs).

### 2.2 Alternatives (third party)

- **agentcash** — `npx agentcash add https://app.keeperhub.com` (OpenAPI-driven skills; **plaintext test wallet**; do not use for real funds).  
- **Coinbase agentic wallet skills** — `npx skills add coinbase/agentic-wallet-skills` (CDP wallet; `pay-for-service` / `x402` style flows).

**Docs:** [x402 Wallets for AI Agents](https://docs.keeperhub.com/ai-tools/agent-wallets) lists these options and when to use each.

### 2.3 End-to-end check

- Discover a paid read workflow: OpenAPI, `search_workflows`, or GET [`/openapi.json`](https://app.keeperhub.com/openapi.json).  
- **Dogfood:** listed workflow `mcp-test` at the URL pattern in [Paid Workflows](https://docs.keeperhub.com/workflows/paid-workflows) (small per-call USDC, accepts both x402 and MPP for integration testing).  
- Confirm success: 200 with execution result; optional BaseScan of settlement via facilitator receipt where exposed.

---

## 3. Work: browser / this repo (Vite + wagmi “Base Web3” dapp)

To add **x402** here (instead of or in addition to the current **ETH + message** demo), you need non-trivial extra scope:

| Gap | What to do |
|-----|------------|
| **Asset** | Add **USDC (ERC-20) on Base** in wagmi/viem config, not only native `value` transfers. |
| **Protocol** | Implement a **client loop**: `POST` → on **402**, decode `PAYMENT-REQUIRED` (or current header set), build **EIP-3009** authorization, sign with the connected account, **retry** with `PAYMENT-SIGNATURE` (or the header the 402 response specifies). Use [CDP / x402 client libraries](https://docs.cdp.coinbase.com/x402) or an ecosystem helper rather than reimplementing from scratch. |
| **Key custody** | Browser wallets are OK for dev; for automation parity with **KeeperHub’s** agent story, a **server-proxied** or **MPC** pattern (like **Turnkey** via `@keeperhub/wallet`) is often preferred. |
| **Test vs prod** | Use **Base Sepolia** only if the paid endpoint you target explicitly supports a testnet facilitator; hosted KeeperHub paid calls are **Base mainnet USDC** per current docs. |

**Concrete tasks (checklist):** wire USDC in `src/wagmi.ts`; add an `x402Fetch` (or `payAndCallWorkflow`) helper; point at a known paid `POST` URL; handle errors and `PAYMENT-RESPONSE` / settlement headers; document `VITE_*` for any facilitator API key if your client requires it.

---

## 4. Work: self-hosting or extending the KeeperHub monorepo

If you are modifying **github.com/KeeperHub/keeperhub** itself, platform work is larger than a single 402 call. The internal spec **`specs/x402-mpp-dual-protocol.md` (KEEP-176)** outlines items such as:

- OpenAPI 3.1 at `/api/openapi` and optional `GET /.well-known/x402` for discoverability.  
- A **payment router** (`lib/payments/router.ts`) to distinguish **x402** vs **MPP** from request headers, dual-402 challenges when unauthenticated, idempotency keyed by `PAYMENT-SIGNATURE` (and MPP’s `Authorization: Payment` form).  
- `workflow_payments` (or equivalent) schema: `protocol`, `chain`, hashed idempotency keys.  
- Refactor of `app/api/mcp/workflows/[slug]/call/route.ts` paid path to route through the gate, **without** changing write-workflow (calldata) behavior.  
- MPP: `mppx` + `MPP_SECRET_KEY` in env; receipt headers, CORS for `Payment-Receipt`, etc.  
- Post-deploy: register with [x402scan.com](https://x402scan.com) / mpp scan tools as described in that spec.

Treat that file on the `staging` branch (or the release you use) as the **implementation checklist** for dual-protocol and discovery—not every item may be merged on `main` yet; compare with your checked-out tree.

---

## 5. Summary checklists

### For an agent to “complete” a paid KeeperHub workflow (x402)

- [ ] Install and fund an **x402-capable** wallet (e.g. `@keeperhub/wallet` or listed alternative) with **Base USDC** where the endpoint expects mainnet.  
- [ ] **Authorize** the MCP/HTTP client against `app.keeperhub.com` if using OAuth (browser flow for Code).  
- [ ] **Discover** the workflow slug, price, and `inputSchema`; **POST** to `/api/mcp/workflows/{slug}/call` with the correct body.  
- [ ] Rely on the wallet/tooling to perform **402 → sign → retry**; verify 200 and execution id / output.  
- [ ] (Optional) Support **Tempo MPP** if the client stack pays via MPP instead of x402.

### For this repository (openagent-demo) to “complete” x402 in-app

- [ ] Add **USDC** + x402 **402/ retry** client, or delegate to a backend that runs `@keeperhub/wallet` / facilitator logic.  
- [ ] **Do not** conflate the existing **ETH transfer** form with x402; document both separately.

### For a developer extending KeeperHub upstream

- [ ] Read **`specs/x402-mpp-dual-protocol.md`** and align with **`docs/workflows/paid-workflows.md`** and **`docs/ai-tools/agent-wallets.md`**.  
- [ ] Implement or verify **OpenAPI** + call-route **router** + **idempotency** for your branch.  
- [ ] Add CI/e2e that hits a **low-price listed workflow** with a test wallet, if the team provides such a harness.

---

## 6. Related reading

- [keeperhub/keeperhub — README (staging)](https://raw.githubusercontent.com/KeeperHub/keeperhub/staging/README.md) (architecture, executor, local dev).  
- [Coinbase: x402 documentation](https://docs.cdp.coinbase.com/x402).  
- [x402.org](https://www.x402.org/) (protocol positioning).  
- [KeeperHub/agentic-wallet](https://github.com/KeeperHub/agentic-wallet) (npm: `@keeperhub/wallet`).

This doc is project-local note-taking for **NautilusOSS / openagent-demo-1** and should be **re-validated** against the live [KeeperHub docs](https://docs.keeperhub.com) and the exact branch you use from [KeeperHub/keeperhub](https://github.com/KeeperHub/keeperhub) before production or compliance decisions.
