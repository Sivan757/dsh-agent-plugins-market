/** One operation lease per asynchronous workflow; nested requests cannot dismiss another lease. */
export interface BusyOperation {
  id: number
  target: HTMLElement | null
  blocking: boolean
}

interface BusyOptions {
  /** Mutations block repeat input immediately; reads only show delayed, nonblocking feedback. */
  blocking?: boolean
}
const pending = new Map<number, BusyOperation>()
const listeners = new Set<() => void>()
let nextId = 0
let snapshot: readonly BusyOperation[] = []

function publish(): void {
  snapshot = [...pending.values()]
  listeners.forEach(listener => listener())
}

export function operationTarget(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(node => node.getClientRects().length > 0)
  return dialogs.at(-1) ?? document.querySelector<HTMLElement>('[data-agent-plugins-workspace]')
}

export function beginBusyOperation(target = operationTarget(), { blocking = true }: BusyOptions = {}): () => void {
  const id = ++nextId
  pending.set(id, { id, target, blocking })
  publish()
  return () => {
    if (pending.delete(id)) publish()
  }
}

export async function withBusyOperation<T>(work: () => Promise<T>, options?: BusyOptions): Promise<T> {
  const end = beginBusyOperation(undefined, options)
  try {
    return await work()
  } finally {
    end()
  }
}

export function subscribeBusy(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function busySnapshot(): readonly BusyOperation[] {
  return snapshot
}
