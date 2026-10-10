/** Session-scoped discovery through the published skills/list RPC, independent of execution grants. */
import { rankByName } from '@deepseek-ai/dsh-client-ui-primitives'
import { adaptSkillSources, registeredSkillSources, replaceSkillCandidates } from './menu-row-face.js'

export interface SkillCatalogEntry {
  name: string
  description: string
  path?: string
  modelInvocable: boolean
}
export interface SkillCatalogRefreshOptions {
  inputTriggers: unknown
  sessions: { scope(id: string): unknown; subagentAddress?(id: string): unknown }
  /** Delegate to remote.skills.list with the retained session identity and caller signal. */
  list(sessionId: string, signal: AbortSignal): Promise<readonly SkillCatalogEntry[]>
  /** Resolve the host skill namespace's menu.userOnly key at candidate time. */
  userOnlyLabel(): string
  /** Delegate to sidebarRight.openResource(fileAddressFor(sessionId, cwd, path)). */
  openResource(sessionId: string, path: string): void
}
export interface SkillCatalogRefresh {
  /** Call after a committed selection changes, never for a pending busy-turn intent. */
  refresh(sessionId: string): void
  /** Re-read known session scopes after a native connection reset. */
  refreshAll(): void
  dispose(): void
}
type Session = { sessionId: string }
type Request = { query: string; signal: AbortSignal }

/**
 * Adapt the host source instead of mutating its private cache or adding a menu.
 * Every candidate request re-reads the host. Snapshots only back lexicons and previews.
 * Errors propagate to the host menu and clear the affected snapshot.
 */
export function createSkillCatalogRefresh(options: SkillCatalogRefreshOptions): SkillCatalogRefresh {
  const snapshots = new Map<string, readonly SkillCatalogEntry[]>()
  const scopes = new Map<string, unknown>()
  const reads = new Map<string, number>()
  const listeners = new Map<string, Set<() => void>>()
  const lifetime = new AbortController()
  const controllers = new Map<string, Set<AbortController>>()
  let disposed = false
  const watchedScopes = new WeakSet<object>()
  const rebound = new Map<string, { scope: object; source: Record<string | symbol, unknown> }>()
  const adaptedSources = new Set<Record<string | symbol, unknown>>()
  const deferredRebind = new Map<string, () => void>()
  const rebind = (id: string, source: Record<string | symbol, unknown>): void => {
    if (!registeredSkillSources(options.inputTriggers).includes(source)) return
    const scope = options.sessions.scope(id)
    if (!scope || typeof scope !== 'object') return
    const previous = rebound.get(id)
    if (previous?.scope === scope && previous.source === source) return
    const triggers = options.inputTriggers as {
      sessionOf?(scope: unknown): {
        menu?: { getSnapshot(): { open: boolean }; subscribe?(listener: () => void): () => void }
        sourceRemoved?(source: unknown): void
        sourceAdded?(source: unknown): void
      }
    }
    const controller = triggers.sessionOf?.(scope)
    if (!controller?.menu || !controller.sourceRemoved || !controller.sourceAdded) return
    if (controller.menu.getSnapshot().open) {
      if (!deferredRebind.has(id) && controller.menu.subscribe) {
        const off = controller.menu.subscribe(() => {
          if (controller.menu!.getSnapshot().open) return
          off()
          deferredRebind.delete(id)
          if (options.sessions.scope(id) === scope) rebind(id, source)
        })
        deferredRebind.set(id, off)
        const context = scope as { effect?: (callback: () => () => void, label?: string) => unknown }
        context.effect?.(
          () => () => {
            if (deferredRebind.get(id) !== off) return
            off()
            deferredRebind.delete(id)
          },
          'market: deferred skill subscription'
        )
      }
      return
    }
    deferredRebind.get(id)?.()
    deferredRebind.delete(id)
    rebound.set(id, { scope, source })
    controller.sourceRemoved(source)
    controller.sourceAdded(source)
  }
  const watchScope = (id: string, scope: unknown): void => {
    if (!scope || typeof scope !== 'object' || watchedScopes.has(scope)) return
    const context = scope as { effect?: (callback: () => () => void, label?: string) => unknown }
    if (typeof context.effect !== 'function') return
    watchedScopes.add(scope)
    context.effect(
      () => () => {
        if (scopes.get(id) !== scope) return
        for (const abort of controllers.get(id) ?? []) abort.abort()
        controllers.delete(id)
        snapshots.delete(id)
        scopes.delete(id)
        reads.delete(id)
        listeners.delete(id)
        rebound.delete(id)
        deferredRebind.get(id)?.()
        deferredRebind.delete(id)
      },
      'market: skill catalog scope'
    )
  }
  const notify = (id: string): void => {
    for (const listener of listeners.get(id) ?? []) {
      try {
        listener()
      } catch (error) {
        console.error('[dsh-agent-plugins-market] skill lexicon listener failed:', error)
      }
    }
  }
  const publish = (id: string, rows: readonly SkillCatalogEntry[]): void => {
    const changed = JSON.stringify(snapshots.get(id) ?? []) !== JSON.stringify(rows)
    snapshots.set(id, rows)
    scopes.set(id, options.sessions.scope(id))
    if (changed) notify(id)
  }
  const eligible = (id: string): boolean => !disposed && options.sessions.scope(id) !== undefined && options.sessions.subagentAddress?.(id) === undefined
  const load = async (id: string, signal: AbortSignal): Promise<readonly SkillCatalogEntry[] | undefined> => {
    if (!eligible(id) || signal.aborted) return undefined
    const scope = options.sessions.scope(id)
    if (scopes.get(id) !== scope) snapshots.delete(id)
    scopes.set(id, scope)
    watchScope(id, scope)
    const sequence = (reads.get(id) ?? 0) + 1
    reads.set(id, sequence)
    const abort = new AbortController()
    const pending = controllers.get(id) ?? new Set<AbortController>()
    pending.add(abort)
    controllers.set(id, pending)
    const combined = AbortSignal.any([signal, lifetime.signal, abort.signal])
    const current = () => !combined.aborted && options.sessions.scope(id) === scope
    try {
      const rows = await options.list(id, combined)
      if (!current()) return undefined
      if (reads.get(id) === sequence) publish(id, rows)
      return rows
    } catch (error) {
      if (!current()) return undefined
      if (reads.get(id) === sequence) publish(id, [])
      throw error
    } finally {
      pending.delete(abort)
      if (pending.size === 0) controllers.delete(id)
    }
  }
  const snapshot = (id: string) => (scopes.get(id) === options.sessions.scope(id) ? snapshots.get(id) : undefined)
  const stop = adaptSkillSources(options.inputTriggers, source => {
    if (typeof source['candidates'] !== 'function') return undefined
    const original = new Map<string, unknown>()
    const replacements: Record<string, unknown> = {
      warm(session: Session) {
        if (!registeredSkillSources(options.inputTriggers).includes(source)) return
        const scope = options.sessions.scope(session.sessionId)
        void Promise.resolve().then(() => {
          if (!disposed && options.sessions.scope(session.sessionId) === scope) rebind(session.sessionId, source)
        })
        void load(session.sessionId, lifetime.signal).catch(() => {})
      },
      lexicon(session: Session) {
        return eligible(session.sessionId) ? (snapshot(session.sessionId)?.map(row => row.name) ?? []) : []
      },
      subscribeLexicon(session: Session, listener: () => void) {
        const scope = options.sessions.scope(session.sessionId)
        if (scope && typeof scope === 'object') rebound.set(session.sessionId, { scope, source })
        const set = listeners.get(session.sessionId) ?? new Set<() => void>()
        set.add(listener)
        listeners.set(session.sessionId, set)
        return () => {
          set.delete(listener)
          if (set.size === 0) listeners.delete(session.sessionId)
        }
      },
      openReference(session: Session, { ref }: { ref: string }) {
        if (!eligible(session.sessionId)) return false
        const open = (rows: readonly SkillCatalogEntry[]): boolean => {
          const path = rows.find(row => '/' + row.name === ref)?.path
          if (!path) return false
          options.openResource(session.sessionId, path)
          return true
        }
        const rows = snapshot(session.sessionId)
        if (rows !== undefined) return open(rows)
        void load(session.sessionId, lifetime.signal)
          .then(fresh => {
            if (fresh) open(fresh)
          })
          .catch(() => {})
        return true
      }
    }
    const offCandidates = replaceSkillCandidates(source, async (...args: unknown[]) => {
      if (!registeredSkillSources(options.inputTriggers).includes(source)) return []
      const session = args[0] as Session
      const request = args[1] as Request
      rebind(session.sessionId, source)
      const rows = await load(session.sessionId, request.signal)
      if (!rows || request.signal.aborted) return []
      return rankByName(rows, request.query).map(row => ({ name: row.name, description: row.modelInvocable ? row.description : options.userOnlyLabel() + ' · ' + row.description }))
    })
    for (const [key, replacement] of Object.entries(replacements)) {
      original.set(key, source[key])
      source[key] = replacement
    }
    adaptedSources.add(source)
    return () => {
      adaptedSources.delete(source)
      offCandidates()
      for (const [key, value] of original)
        if (source[key] === replacements[key]) {
          if (value === undefined) delete source[key]
          else source[key] = value
        }
    }
  })
  const api: SkillCatalogRefresh = {
    refresh(id) {
      if (disposed) return
      reads.set(id, (reads.get(id) ?? 0) + 1)
      for (const abort of controllers.get(id) ?? []) abort.abort()
      publish(id, [])
      const scope = options.sessions.scope(id)
      if (scope === undefined) return
      void load(id, lifetime.signal)
        .catch(() => {})
        .finally(() => {
          if (disposed || options.sessions.scope(id) !== scope) return
          for (const source of adaptedSources) rebind(id, source)
          const triggers = options.inputTriggers as { sessionOf?(scope: unknown): { refreshOpenMenu(): void } }
          triggers.sessionOf?.(scope).refreshOpenMenu()
        })
    },
    refreshAll() {
      for (const id of [...scopes.keys()]) api.refresh(id)
    },
    dispose() {
      if (disposed) return
      disposed = true
      lifetime.abort()
      stop()
      for (const [id, { scope, source }] of [...rebound]) {
        rebound.delete(id)
        if (options.sessions.scope(id) === scope) rebind(id, source)
      }
      rebound.clear()
      snapshots.clear()
      scopes.clear()
      reads.clear()
      listeners.clear()
      controllers.clear()
    }
  }
  return api
}
