import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { base, baseSepolia } from 'wagmi/chains'
import { http } from 'viem'

/**
 * — Default target chain: Base Sepolia (testnet) for safe experimentation. —
 * To default to Base mainnet instead, put `base` as the first entry in the `chains` array below
 * (wagmi and RainbowKit use the first chain as the default for new sessions).
 */
const defaultChains = [baseSepolia, base] as const

// —— RPC URLs: set `VITE_BASE_SEPOLIA_RPC_URL` and `VITE_BASE_MAINNET_RPC_URL` in `.env`, or add URLs here. ——
// Without overrides, viem’s built-in public RPCs are used; they are fine for dev but rate-limited in production.
const sepoliaRpc = import.meta.env.VITE_BASE_SEPOLIA_RPC_URL
const mainnetRpc = import.meta.env.VITE_BASE_MAINNET_RPC_URL

// —— Reown (WalletConnect): get a project ID at https://cloud.reown.com and set VITE_WALLETCONNECT_PROJECT_ID in `.env`. ——
const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? ''

export const config = getDefaultConfig({
  appName: 'Base Web3 App',
  projectId: walletConnectProjectId,
  chains: defaultChains,
  transports: {
    [baseSepolia.id]: sepoliaRpc ? http(sepoliaRpc) : http(),
    [base.id]: mainnetRpc ? http(mainnetRpc) : http(),
  },
  ssr: false,
})

/** These chain IDs are treated as "correct" in the Network section; anything else shows a wrong-network warning. */
export const SUPPORTED_CHAIN_IDS = [base.id, baseSepolia.id] as const

export { base, baseSepolia, walletConnectProjectId }
