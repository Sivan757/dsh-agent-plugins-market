/** One operation lease per asynchronous workflow; nested requests cannot dismiss another lease. */
export interface BusyOperation {
  id: number
  target: HTMLElement | null
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

export function beginBusyOperation(target = operationTarget()): () => void {
  const id = ++nextId
  pending.set(id, { id, target })
  publish()
  return () => {
    if (pending.delete(id)) publish()
  }
}

export async function withBusyOperation<T>(work: () => Promise<T>): Promise<T> {
  const end = beginBusyOperation()
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
