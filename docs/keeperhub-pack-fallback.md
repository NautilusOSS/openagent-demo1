# Alternative: workflow “packs” (no KeeperHub 1.0 app update)

**Motive:** achieve **different effective prices** and **room for platform fee** without changing the [KeeperHub](https://github.com/KeeperHub/keeperhub) **MCP / call** route, **x402** `buildPaymentConfig` plumbing, or **402-before-body** ordering.

**Idea in one line:** do **not** make one URL emit a **dynamic** `PAYMENT-REQUIRED` amount. Instead, publish **several listed read workflows**—**packs** of different **fixed** per-call USDC (each still uses today’s `priceUsdcPerCall` only). The **agent or UI** picks the **smallest pack** that “covers” the job, calls **`POST` …/workflows/{pack-slug}/call**, and x402 still verifies an **exact** on-chain USDC leg for that pack’s list price.

---

## How packs satisfy “repayment” (coverage)

- Each pack is a **separate** workflow row: e.g. `microtip-s`, `microtip-m`, `microtip-l` (names illustrative), each with its own `listedSlug` and `priceUsdcPerCall` (e.g. $0.01, $0.05, $0.25).  
- **OpenAPI** / `search_workflows` lists them as distinct, priced endpoints.  
- The caller chooses a pack by **which slug to invoke**; no server-side formula is required in KeeperHub 1.0.  
- **Satisfy the repayment** means: pay **exactly** the pack’s x402-quoted USDC, which the platform already supports.

**Tradeoff:** the client must know **pack boundaries** and selection rules (documentation, skills, or a thin **router** that is **not** KeeperHub—e.g. your app maps “I need a heavy run” → `.../microtip-l/call`).

---

## “Fee retained and change returned” (interpret carefully)

A single **x402** **exact** USDC transfer on Base generally sends **one** `amount` to the **stated** `payTo` for that request. The protocol does **not** by itself return **physical “change”** in the same way as a cash register.

**Meaningful interpretations that fit “no app update” or light off-product work:**

| What you want | How it can look in practice |
|----------------|-----------------------------|
| **Platform takes a cut** of what the user paid for the **pack** | The **org wallet** (creator) receives the **full** pack USDC on-chain. **Fee** is a **product** term: a **pre-negotiated split** you settle **off-chain** (accounting, rev-share) or a **separate** billing relationship—not automatically enforced by a single 402 to one `payTo` without extra contracts or multi-recipient support. Be explicit: “retained” here often means **booked**, not a second on-chain split in the same call. |
| **“Change” to the end user** | Not part of the **single** 402 leg. A natural fit with KeeperHub: the **read workflow** itself, after the paid run, includes an automated **on-chain USDC transfer** (refund) to the **payer**—see [Automatic refund in the workflow](#automatic-refund-in-the-workflow) below. Other options: **(b)** in-app **credit** only, **(c)** no refund (all-or-nothing margin). |
| **Net economic “change”** | e.g. pack **$0.25**; after the job you compute **retained platform fee** + **refund of remainder**; the **refund** leg can be a dedicated workflow node so “change” is a **second transaction**, not manual ops. |

**Docs discipline:** if you market “we return change,” be explicit: **on-chain** refund tx (workflow-driven), **credit** only, or no return.

---

## Automatic refund in the workflow

A practical way to make **“fee retained, change returned”** real—**without** changing the **MCP / x402 call route**—is to build it into the **workflow** that the pack invokes:

1. The **payer** still completes **x402** and pays the **full** pack USDC to the **creator** `payTo` (unchanged, single exact payment).  
2. The workflow runs its main logic and computes, in your own rules: **refundUSDC = packPrice − platformFee − …** (or any formula you own).  
3. A **Web3 / transfer** step in the same workflow (or a chained step) sends **`refundUSDC`** in **USDC** from the **organization wallet** (the one that received funds or a treasury you control) **back to the payer’s address**—i.e. an **automatic refund transaction** triggered by the workflow, not a separate manual process.

**Why this does not require a “KeeperHub 1.0” fork of the 402 path:** the **first** on-chain event remains today’s per-workflow `priceUsdcPerCall` + `withX402`. The **refund** is a **subsequent** transaction executed by the **keeper / workflow engine** (Para-backed org wallet, etc.) as a normal **“Transfer tokens / funds”**-style action.

**You must design for:**

- **Payer address** — the workflow must know who to refund: e.g. a field in the **JSON body** (`payerAddress`), metadata from your integration, or the same **decode** approach as `extractPayerAddress` in [`lib/x402/payment-gate.ts`](https://github.com/KeeperHub/keeperhub/blob/main/lib/x402/payment-gate.ts) (from the `PAYMENT-SIGNATURE` payload) if the execution receives it.  
- **Sufficient USDC (and gas)** in the org wallet to send the refund.  
- **Failed refund** — retry / alert in the workflow; partial failure of the business step should not claim success without accounting.  
- **Regulatory and copy** — “refund” vs “best-effort automated transfer”; terms for when refund is $0 (whole pack = fee + margin with no return).

**Contrast:** this is **automation in the product workflow**, not a new **dynamic-402** implementation on the `call` route ([keeperhub-variable-pricing-and-402.md](./keeperhub-variable-pricing-and-402.md)).

---

## When this is a good fit

- You are OK with a **discrete** price ladder, not a continuous “any amount to the cent” quote.  
- You can **route** the client to the right `slug` without a dynamic 402.  
- You accept that **on-chain “change”** is a **separate** transaction from the x402 leg, but you are fine implementing it as an **automated refund step** in the same workflow (see [above](#automatic-refund-in-the-workflow)).

---

## Contrast with body-driven 402 (other doc)

[keeperhub-variable-pricing-and-402.md](./keeperhub-variable-pricing-and-402.md) describes **one** call URL whose **server** sets the amount from **body** and **400**-family validation—requires **KeeperHub** (or fork) work.

This **pack** model avoids that: **N fixed workflows**, **N** fixed 402s, same upstream behavior as today.

---

## This **microtip** app

**microtip** is still a **single** default URL; a **pack**-aware client would set `VITE_X402_TEST_URL` (or the POST URL field) to the chosen pack’s `/api/mcp/workflows/{slug}/call` before **Pay and call**, or you ship multiple saved presets. No code change in KeeperHub is **required** for the pack list itself—only **org** workflow design and **listing** in the app.

## See also

- [docs/index.md](./index.md)  
- [keeperhub-variable-pricing-and-402.md](./keeperhub-variable-pricing-and-402.md)

*Design note for this repo, not a KeeperHub policy statement.*
