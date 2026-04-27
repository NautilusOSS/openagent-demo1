# Base Web3 App (React + Vite + wagmi + viem + RainbowKit)

A minimal dapp to connect a wallet, stay on **Base** or **Base Sepolia** (testnet, default), and sign a message or send a small **native ETH** transfer. It uses modern **wagmi v2** and **viem** patterns, so you can later plug in x402, paid API flows, or custom `WalletClient` logic without a large rewrite.

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

Inline comments in `src/wagmi.ts` also note where the **default chain** (Base Sepolia first) and **RPCs** are configured.

## Run (development)

```bash
npm run dev
```

Open the shown local URL, connect with RainbowKit, use **“Switch to Base Sepolia”** to align with the default test network, get testnet ETH from a [Base Sepolia faucet](https://www.alchemy.com/faucets/base-sepolia-faucet), then try **Sign message** and **Send transaction**.

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

- **Base mainnet** and **Base Sepolia** are both configured. The first chain in `src/wagmi.ts` is the **default** (Base Sepolia for safe testing).
- There are **no private keys** in this repo. Users sign in their own wallet; never put a secret key in frontend env or code.

## Safety and extension points

- Default to **Base Sepolia**; switch to mainnet only when you are ready and understand real funds.
- `src/wagmi.ts` is the right place to add a **custom `transport`**, a **faucet-only chain**, or wrap the config for a future **x402** or pay-per-request flow (often by composing viem’s `http` and custom middleware).
- The **Sign message** and **Send transaction** actions use the connected account only; to charge an API, you would add a new hook or server that verifies signatures or on-chain state.

## License

Private / demo project unless you add a license of your choice.
