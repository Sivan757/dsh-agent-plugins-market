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
