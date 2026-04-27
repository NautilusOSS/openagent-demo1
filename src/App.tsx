import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useState } from 'react'
import { formatEther, isAddress, parseEther } from 'viem'
import { useAccount, useBalance, useChainId, useConnect } from 'wagmi'
import {
  useSendTransaction,
  useSignMessage,
  useSwitchChain,
  useWaitForTransactionReceipt,
} from 'wagmi'
import {
  base,
  baseSepolia,
  SUPPORTED_CHAIN_IDS,
  walletConnectProjectId,
} from './wagmi'
import { MicrotipPanel } from './MicrotipPanel'
import './App.css'

const APP_MESSAGE = 'I authorize this app to use my wallet on Base.'

const chainLabel = (id: number | undefined): string => {
  if (id === base.id) return 'Base'
  if (id === baseSepolia.id) return 'Base Sepolia'
  if (id === undefined) return '—'
  return `Chain ID ${id}`
}

function isSupportedNetwork(chainId: number | undefined) {
  if (chainId === undefined) return false
  return SUPPORTED_CHAIN_IDS.some((id) => id === chainId)
}

function getBasescanTxUrl(chainId: number, hash: `0x${string}`) {
  if (chainId === baseSepolia.id) {
    return `https://sepolia.basescan.org/tx/${hash}` as const
  }
  return `https://basescan.org/tx/${hash}` as const
}

function shortAddress(a: `0x${string}`) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

function App() {
  const { address, isConnected } = useAccount()
  const { connectors } = useConnect()
  const chainId = useChainId()
  const { data: balance, isLoading: balanceLoading } = useBalance({
    address,
  })
  const { switchChain, isPending: isSwitching, error: switchError } =
    useSwitchChain()

  const { signMessage, data: signature, isPending: signing, error: signError } =
    useSignMessage()

  const onWrongNetwork = isConnected && !isSupportedNetwork(chainId)
  const canActOnBase = isConnected && isSupportedNetwork(chainId)

  // Form state (send transaction)
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  /** Captured at submit so the explorer link stays correct if the user changes networks while confirming. */
  const [submittedOnChain, setSubmittedOnChain] = useState<number | undefined>()

  const { sendTransaction, isPending: isSending, error: sendError, data: txHash } =
    useSendTransaction()

  const {
    isLoading: isConfirming,
    isSuccess: txSuccess,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  })

  const validateForm = () => {
    if (!isAddress(recipient as `0x${string}`)) {
      return 'Enter a valid Ethereum address (0x…).'
    }
    const n = Number.parseFloat(amount)
    if (Number.isNaN(n) || n <= 0) {
      return 'Enter a positive ETH amount (e.g. 0.001).'
    }
    try {
      parseEther(amount)
    } catch {
      return 'Amount is not a valid number of ETH.'
    }
    return null
  }

  const onSubmitSend = (e: React.FormEvent) => {
    e.preventDefault()
    const err = validateForm()
    if (err) {
      setFieldError(err)
      return
    }
    setFieldError(null)
    setSubmittedOnChain(chainId)
    sendTransaction({
      to: recipient as `0x${string}`,
      value: parseEther(amount),
    })
  }

  const isTxPending = isSending || (Boolean(txHash) && isConfirming)
  const sendFlowError = sendError ?? receiptError
  const missingWalletConnect = !walletConnectProjectId

  return (
    <div className="app">
      <header className="app-header">
        <h1>microtip</h1>
        <p className="lede">
          Connect a wallet, stay on Base or Base Sepolia, sign a message, send
          a little ETH, or on <strong>Base mainnet</strong> use the x402
          microtip flow (USDC) for paid HTTP calls like KeeperHub workflows.
        </p>
        <ConnectButton />
      </header>

      {missingWalletConnect && (
        <section className="card card-warn" aria-live="polite">
          <h2>WalletConnect not configured</h2>
          <p>
            Set <code>VITE_WALLETCONNECT_PROJECT_ID</code> in{' '}
            <code>.env</code> for the WalletConnect modal. Injected wallets
            (e.g. MetaMask) can still be used.
          </p>
        </section>
      )}

      <div className="grid">
        <section className="card">
          <h2>Wallet</h2>
          {!isConnected && (
            <p className="muted">
              Use the button in the header to connect. Injected and WalletConnect
              (mobile) are supported.
            </p>
          )}
          {isConnected && address && (
            <dl className="kv">
              <div>
                <dt>Address</dt>
                <dd title={address}>
                  {shortAddress(address)} <code className="mono-sm">{address}</code>
                </dd>
              </div>
              <div>
                <dt>Network</dt>
                <dd>{chainLabel(chainId)}</dd>
              </div>
              <div>
                <dt>Balance</dt>
                <dd>
                  {balanceLoading
                    ? '…'
                    : balance
                      ? `${formatEther(balance.value)} ${balance.symbol}`
                      : '—'}
                </dd>
              </div>
            </dl>
          )}
          {connectors.length > 0 && (
            <p className="muted sm">
              {connectors.length} connector(s) available (injected, WalletConnect,
              etc. via wagmi + RainbowKit).
            </p>
          )}
        </section>

        <section className="card">
          <h2>Network</h2>
          <p>Supported: Base and Base Sepolia. Default: Base Sepolia.</p>
          {onWrongNetwork && (
            <p className="status-warn" role="alert">
              You are on an unsupported or unexpected network. Switch to Base
              Sepolia to follow the default safe testing path.
            </p>
          )}
          <div className="row">
            <button
              type="button"
              className="btn-primary"
              disabled={!isConnected || isSwitching}
              onClick={() => switchChain({ chainId: baseSepolia.id })}
            >
              {isSwitching ? 'Switching…' : 'Switch to Base Sepolia'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={!isConnected || isSwitching}
              onClick={() => switchChain({ chainId: base.id })}
            >
              Switch to Base
            </button>
          </div>
          {switchError && (
            <p className="status-err" role="alert">
              {switchError.message}
            </p>
          )}
        </section>

        <MicrotipPanel />

        <section className="card">
          <h2>Sign message</h2>
          <p className="message-preview">“{APP_MESSAGE}”</p>
          <button
            type="button"
            className="btn-primary"
            disabled={!canActOnBase || signing}
            onClick={() => signMessage({ message: APP_MESSAGE })}
          >
            {signing ? 'Waiting for wallet…' : 'Sign message in wallet'}
          </button>
          {signError && (
            <p className="status-err" role="alert">
              {signError.message}
            </p>
          )}
          {signature && (
            <p className="wrap-break">
              <span className="label">Signature</span>
              <code>{signature}</code>
            </p>
          )}
        </section>

        <section className="card">
          <h2>Send transaction</h2>
          <p className="muted sm">
            Sends native ETH (no contract call). The wallet will ask you to
            review and sign. Never paste private keys into this or any dapp.
          </p>
          <form onSubmit={onSubmitSend} className="form">
            <label>
              Recipient
              <input
                className="input"
                name="to"
                value={recipient}
                onChange={(e) => {
                  setRecipient(e.target.value.trim())
                  setFieldError(null)
                }}
                placeholder="0x…"
                autoComplete="off"
                disabled={!canActOnBase}
              />
            </label>
            <label>
              Amount (ETH)
              <input
                className="input"
                name="amount"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value)
                  setFieldError(null)
                }}
                placeholder="0.0001"
                inputMode="decimal"
                disabled={!canActOnBase}
              />
            </label>
            {fieldError && (
              <p className="status-err" role="alert">
                {fieldError}
              </p>
            )}
            <button
              type="submit"
              className="btn-primary"
              disabled={!canActOnBase || isTxPending}
            >
              {isTxPending
                ? isSending
                  ? 'Open wallet to confirm…'
                  : 'Confirming on network…'
                : 'Send transaction'}
            </button>
            {isConnected && onWrongNetwork && (
              <p className="status-warn" role="alert">
                Connect to Base or Base Sepolia before sending.
              </p>
            )}
            {sendFlowError && !isTxPending && (
              <p className="status-err" role="alert">
                {sendFlowError.message}
              </p>
            )}
            {txSuccess && txHash && (
              <p className="status-ok" role="status">
                <span>Success.</span>{' '}
                <a
                  href={getBasescanTxUrl(
                    submittedOnChain ?? chainId,
                    txHash,
                  )}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on BaseScan
                </a>
              </p>
            )}
          </form>
        </section>
      </div>
    </div>
  )
}

export default App
