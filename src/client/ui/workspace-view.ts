import { useSyncExternalStore } from 'react'

export type WorkspaceView = 'grid' | 'list'
const KEY = 'dsh-agent-plugins-market:view'
const listeners = new Set<() => void>()
let view: WorkspaceView = 'grid'
let initialized = false

function snapshot(): WorkspaceView {
  if (!initialized && typeof window !== 'undefined') {
    initialized = true
    try { view = window.localStorage.getItem(KEY) === 'list' ? 'list' : 'grid' } catch { /* Session state still works without storage. */ }
  }
  return view
}

function setView(next: WorkspaceView): void {
  view = next
  initialized = true
  try { window.localStorage.setItem(KEY, next) } catch { /* Keep the selection for this session. */ }
  listeners.forEach(listener => listener())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== KEY && event.key !== null) return
    initialized = false
    snapshot()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage) }
}

/** All workspace tabs share one persisted display preference. Search and filters remain tab-specific. */
export function useWorkspaceView(): readonly [WorkspaceView, typeof setView] {
  return [useSyncExternalStore(subscribe, snapshot, () => 'grid'), setView]
}
