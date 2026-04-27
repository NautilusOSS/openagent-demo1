# Motive: request arguments that change the x402 / 402 `PAYMENT-REQUIRED` amount

**Goal in one line:** the **first** `POST` to a paid workflow includes JSON fields (e.g. units, tier, optional tip, platform-fee model) that **the server** turns into a **concrete USDC price**, which then appears in the **HTTP 402** / `PAYMENT-REQUIRED` (and MPP) leg. The **client** signs **that** quote; the on-chain leg stays whatever x402 + the facilitator require for the **exact** scheme on Base (or MPP on Tempo).

**Why (motive):**

- **Tipping** or “pay-what-you-want” on top of a **base** price without listing many separate workflows.  
- **Per-request** platform fee (fixed or percentage) that is still **enforced in the 402** so the user pays a single, verifiable **total**, not a loose off-chain promise.  
- **Complex pricing** (volume discounts, time windows) driven by **body** or headers while keeping **one** listed endpoint.

**What does *not* require this:** off-chain metadata in the `POST` body (notes, `clientRequestId`, analytics) that **do not** change the USDC amount. Those only need a workflow `inputSchema` and **no** change to payment plumbing. This document is about **variable on-chain (402) price**.

---

## How it would work in principle

1. Client `POST` with a JSON body.  
2. **Server** validates args, runs a **pricing function** (bounds, min/max, anti-abuse).  
3. **Server** returns **402** with **payment requirements** for **that** total.  
4. x402 client signs and **retries**; body (or a **server-issued quote id** echoed in the retry) must **match** the quote.  
5. `recordPayment` and analytics store the **actual** `amountUsdc` charged, not only the static listed default.

**Security:** the **signed** amount must be exactly what the server **advertised** in the 402. The client must not be able to **underpay** by fudging JSON after seeing the challenge.

---

## How this relates to the **KeeperHub** monorepo

On the public architecture (see [KeeperHub/keeperhub](https://github.com/KeeperHub/keeperhub)), current behavior is that **all** of these are driven by a **single** per-workflow field, **`priceUsdcPerCall`**, at rest in the database—not by the call body.

Conceptually, implementation would add a **resolver** (e.g. `resolvePriceForPaidCall(workflow, body)`) and pass its output into every path that **today** only reads `workflow.priceUsdcPerCall`:

| Area | Today | With variable pricing |
|------|--------|------------------------|
| `buildPaymentConfig` in `lib/x402/payment-gate.ts` | `Number(workflow.priceUsdcPerCall)` in `RouteConfig` | Use **resolved** `price` for `accepts.price` |
| `buildDual402Response` in `lib/payments/router.ts` (unpaid, no header) | `price: workflow.priceUsdcPerCall` | **Same resolved** `price` and consistent `buildPaymentRequired` body |
| MPP `charge` in the same router | `amount: workflow.priceUsdcPerCall` | **Same resolved** `amount` |
| `recordPayment` in the MCP call route | `amountUsdc: workflow.priceUsdcPerCall` | **Actual** charged amount |
| Call route | Paid **probe** path can run **before** a full body parse; see below | Reconcile **ordering** for probes vs real calls |

**Ordering tension (important):** the read+paid `POST` path is written so that **certain** unpaid requests (e.g. scanner “probes”) can receive **402** *before* parsing/validating a rich JSON body. If **price depends on body fields**, the server must **either** parse the body (or a minimal “quote” subset) **before** the final 402, **or** define a separate **discovery** vs **quote** flow and accept the tradeoff for existing discovery behavior. This is a **product/compat** choice, not only a few lines in `buildPaymentConfig`.

**Platform fee:** if a fee is a **separate** line item, settlement might need **one** `payTo` and amount (already there), a **split** in policy (on-chain + bookkeeping), or future protocol support. That is a **separate** design on top of “one resolved total” for the 402.

---

## This **microtip** repository

The **Vite** app here implements the **browser buyer** with `@x402/fetch` and a fixed default URL. It does **not** implement KeeperHub server-side **variable** pricing. Any change to **body-driven** quotes is **server work** in the KeeperHub repo (or your fork) plus, if the API changes, a **small** client update in microtip to send the new JSON fields.

For the original discussion that motivated this note (extra in payment, variable platform fee, 402 leg), see the in-repo `docs/index.md` and the conversation that led to this file.

---

## See also

- [docs/index.md](./index.md) — main x402 / microtip / KeeperHub index.  
- [x402 (Coinbase CDP)](https://docs.cdp.coinbase.com/x402) — client and facilitator concepts.  
- [Paid Workflows (KeeperHub product docs)](https://docs.keeperhub.com/workflows/paid-workflows) — creator view of per-call USDC.  

*This file is a design note for the microtip repo, not an official KeeperHub spec. Validate against the branch of [KeeperHub/keeperhub](https://github.com/KeeperHub/keeperhub) you use before implementing.*
