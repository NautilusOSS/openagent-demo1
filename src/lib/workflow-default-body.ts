/**
 * Default JSON body for the x402 microtip POST (KeeperHub MCP call endpoints).
 * Paid gateway workflows use the Gateway execute panel instead.
 */
export function defaultWorkflowExecuteBody(): string {
  return '{}'
}
