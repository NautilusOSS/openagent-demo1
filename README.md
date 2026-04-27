# microtip (React + Vite + wagmi + viem + RainbowKit + x402)

A minimal dapp: connect a wallet, stay on **Base** or **Base Sepolia** (testnet, default), sign a message, send a little **ETH**, and on **Base mainnet** run an **x402** paid `POST` to the [KeeperHub](https://app.keeperhub.com) `microtip` workflow (`/api/mcp/workflows/microtip/call`) using **USDC** and `@x402/fetch` + `@x402/evm`. See `docs/index.md` and `src/lib/x402.ts`.

## Install

```bash
npm install
```

## Configure environment

1. Copy the example file and set your values:

   ```bash
   cp .env.example .env
   ```

2. In `.env` at minimum set **`VITE_WALLETCONNECT_PROJECT_ID`**. Injected browser wallets (e.g. MetaMask) work without it, but the WalletConnect path needs a [Reown (WalletConnect Cloud)](https://cloud.reown.com/) project ID.

3. Optionally set `VITE_BASE_SEPOLIA_RPC_URL` and/or `VITE_BASE_MAINNET_RPC_URL` if you want a dedicated JSON-RPC (recommended for production).

4. For **x402** in production or `vite preview` (no dev proxy), set `VITE_X402_TEST_URL` to the full paid endpoint URL, or run a reverse proxy that rewrites the path like `vite.config.ts` does for `/keeperhub`.

Inline comments in `src/wagmi.ts` also note where the **default chain** (Base Sepolia first) and **RPCs** are configured.

## Run (development)

```bash
npm run dev
```

Open the shown local URL, connect with RainbowKit, use **“Switch to Base Sepolia”** for the default test path: get testnet ETH from a [Base Sepolia faucet](https://www.alchemy.com/faucets/base-sepolia-faucet), then try **Sign message** and **Send transaction**. For **x402 microtip**, use **“Switch to Base”** and a small **USDC** balance on Base mainnet, then **Pay and call** (the dev server proxies `/keeperhub` to app.keeperhub.com so the default URL avoids CORS).

## Build (production)

```bash
npm run build
npm run preview
```

## Stack

| Area            | Library / tool                          |
| --------------- | ---------------------------------------- |
| UI              | React, TypeScript, Vite                  |
| Ethereum state  | wagmi, @tanstack/react-query             |
| Chains + crypto | viem                                     |
| Connect / UX    | @rainbow-me/rainbowkit (WalletConnect + injected) |
| x402 (buy)      | `@x402/fetch`, `@x402/evm` (`src/lib/x402.ts`) |

- **Base mainnet** and **Base Sepolia** are both configured. The first chain in `src/wagmi.ts` is the **default** (Base Sepolia for safe testing). **x402** calls use **Base mainnet** USDC to `microtip` /call; switch with the Network card.
- There are **no private keys** in this repo. Users sign in their own wallet; never put a secret key in frontend env or code.

## Safety and extension points

- Default to **Base Sepolia**; switch to **Base** for the **x402 microtip** with real (small) USDC when you are ready.
- `src/wagmi.ts` holds the RPC overrides and `appName` for RainbowKit. **x402** is wired in `src/lib/x402.ts` and `src/MicrotipPanel.tsx` (CORS: dev **proxy** in `vite.config.ts` or `VITE_X402_TEST_URL`).
- **Sign message** and **ETH send** are separate from the **x402** flow (USDC EIP-3009 via the `ExactEvmScheme` path).

## License

Private / demo project unless you add a license of your choice.
