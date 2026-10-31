/**
 * The client's request-failure vocabulary.
 *
 * Kept out of the wire module so a panel can identify a timeout without
 * importing — and mocking — the whole API surface.
 *
 * @module client/request-error
 */

/** One request that stopped waiting. The host may still be working on it. */
export class RequestTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`request timed out after ${Math.round(timeoutMs / 1000)}s`)
    this.name = 'RequestTimeoutError'
  }
}

/**
 * A request the host answered with a failure status.
 *
 * The message keeps the route label and the code for logs; a panel renders the
 * localized sentence and the code, because `MCP status failed: 502` in a Chinese
 * panel says nothing a reader can act on.
 */
export class RequestFailedError extends Error {
  readonly status: number
  constructor(label: string, status: number) {
    super(`${label}: ${status}`)
    this.name = 'RequestFailedError'
    this.status = status
  }
}
