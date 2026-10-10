/** Observe durable selection markers through the published SessionBinding event source. */
export interface SelectionCommit {
  ownerId: string
  revision: number
  requestRevision?: number
}
export interface SelectionCommitBinding {
  sessionId: string
  eventSource: {
    getSnapshot(): { entries: readonly unknown[]; change: { kind: string; entries?: readonly unknown[] }; revision: number }
    subscribe(listener: () => void): () => void
  }
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}
function positiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
function committedMessages(entry: unknown): unknown[] {
  const envelope = record(entry)
  if (envelope?.type !== 'event') return []
  const event = record(envelope.event)
  const data = record(event?.data)
  if (event?.type === 'user/message') return [data]
  return event?.type === 'agent/inbox/spliced' && Array.isArray(data?.inserted) ? data.inserted : []
}

/**
 * Report the latest own commit in the initial window, appended entries, or a replaced window.
 * Replay and historical pages do not repeat callbacks. The caller confirms effective state
 * before applying effects because durable publication can precede the server commit callback.
 * Unsubscribe when the borrowed binding is replaced or released. No Session is retained here.
 */
export function watchSelectionCommits(binding: SelectionCommitBinding, onCommit: (commit: SelectionCommit) => void): () => void {
  let latest = 0
  let stopped = false
  const scan = (entries: readonly unknown[]): void => {
    let next: SelectionCommit | undefined
    for (const entry of entries)
      for (const message of committedMessages(entry)) {
        const source = record(record(message)?.source)
        const value = record(source?.binding)
        if (source?.kind !== 'market-extension-selection' || value?.version !== 1 || value.phase !== 'committed' || value.ownerId !== binding.sessionId) continue
        if (!positiveRevision(value.revision) || value.revision <= (next?.revision ?? latest)) continue
        if (value.requestRevision !== undefined && !positiveRevision(value.requestRevision)) continue
        next = { ownerId: binding.sessionId, revision: value.revision, ...(value.requestRevision === undefined ? {} : { requestRevision: value.requestRevision }) }
      }
    if (stopped || !next) return
    latest = next.revision
    onCommit(next)
  }
  const off = binding.eventSource.subscribe(() => {
    const snapshot = binding.eventSource.getSnapshot()
    if (snapshot.change.kind === 'replace') scan(snapshot.entries)
    else if (snapshot.change.kind === 'append') scan(snapshot.change.entries ?? [])
  })
  try {
    scan(binding.eventSource.getSnapshot().entries)
  } catch (error) {
    off()
    throw error
  }
  return () => {
    stopped = true
    off()
  }
}
