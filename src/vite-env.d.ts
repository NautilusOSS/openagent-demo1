/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set for WalletConnect + RainbowKit (mobile / QR). https://cloud.reown.com */
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string
  /** Optional: override the default public RPC for Base Sepolia. */
  readonly VITE_BASE_SEPOLIA_RPC_URL?: string
  /** Optional: override the default public RPC for Base mainnet. */
  readonly VITE_BASE_MAINNET_RPC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
