/**
 * The market workspace's grid/list display preference.
 *
 * A reading gesture rather than something the session runs on, so it lives in
 * the browser instead of the host settings document — and it uses the platform
 * snapshot store, whose opt-in persistence is the supported way to keep a
 * browser-local preference across reloads.
 *
 * @module client/ui/workspace-view
 */
import { useSyncExternalStore } from 'react'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

export type WorkspaceView = 'grid' | 'list'

/** Persistence key; the platform store uses it verbatim as the localStorage key. */
const KEY = 'dsh-agent-plugins-market:view'

/** What a value this preference does not accept reads as. */
const DEFAULT_VIEW: WorkspaceView = 'grid'

/**
 * One store per browser document, created on first use so nothing touches
 * storage at import time. Every mounted tab reads the same instance.
 */
let store: SnapshotStore<WorkspaceView> | undefined

function viewStore(): SnapshotStore<WorkspaceView> {
  store ??= createSnapshotStore<WorkspaceView>(DEFAULT_VIEW, { persist: { name: KEY } })
  return store
}

/** Narrow a stored value to the two states this preference has. */
function narrow(value: unknown): WorkspaceView {
  return value === 'list' || value === 'grid' ? value : DEFAULT_VIEW
}

function setView(next: WorkspaceView): void {
  const current = viewStore()
  if (narrow(current.getSnapshot()) === next) return
  current.set(next)
}

/**
 * All workspace tabs share one persisted display preference; search and filters
 * stay tab-specific.
 * @returns the current view and the setter.
 */
export function useWorkspaceView(): readonly [WorkspaceView, typeof setView] {
  const current = viewStore()
  const view = useSyncExternalStore(
    listener => current.subscribe(listener),
    () => narrow(current.getSnapshot()),
    () => DEFAULT_VIEW
  )
  return [view, setView]
}
