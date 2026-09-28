/** Request-order guard for asynchronously loaded suite detail content. */

/** A small monotonic guard that invalidates stale detail responses. */
export interface LatestRequestGuard {
  next(): number
  invalidate(): void
  isCurrent(requestId: number): boolean
}

/** Create a request guard for one detail modal instance. */
export function createLatestRequestGuard(): LatestRequestGuard {
  let revision = 0
  return {
    next: () => ++revision,
    invalidate: () => {
      revision++
    },
    isCurrent: requestId => requestId === revision
  }
}
