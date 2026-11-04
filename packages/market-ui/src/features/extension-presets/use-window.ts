import { useEffect, useRef, useState } from 'react'
import type { ExtensionWindowPayload } from '../../../../market-contracts/src/contracts/extension-presets.js'
import { EXTENSION_WINDOW_POLL_MS } from '../../../../market-contracts/src/contracts/refresh-cadence.js'
import { createWriteQueue, readWindow, writeWindow, type Mutation } from './resource.js'

/** A read failure the route will keep answering; the error carries which one. */
const flags = (reason: unknown): { unavailable: boolean; notReady: boolean } => {
  if (typeof reason !== 'object' || reason === null) return { unavailable: false, notReady: false }
  const marked = reason as { unavailable?: boolean; notReady?: boolean }
  return { unavailable: marked.unavailable === true, notReady: marked.notReady === true }
}

/** The longest wait between reads of a session that has no extension scope yet. */
const NOT_READY_MAX_WAIT_MS = EXTENSION_WINDOW_POLL_MS * 12

export interface ExtensionWindowObserver {
  committed(sessionId: string): void
  subscribe(sessionId: string, refresh: () => void): () => void
}

/** Whether the document is hidden, on a server render, or in a test without one. */
function hidden(): boolean {
  return typeof document !== 'undefined' && document.hidden === true
}

/**
 * Commit events refresh immediately; polling remains the inventory fallback.
 *
 * The fallback pauses while the document is hidden and answers with one read as
 * soon as it is visible again. Nothing on the panel is being looked at while it
 * is hidden, and one read is what a reader needs on return: the poll exists to
 * notice an inventory change, not to keep a hidden tab in step.
 */
export function useExtensionWindow(sessionId: string, observer?: ExtensionWindowObserver) {
  const [data, setData] = useState<ExtensionWindowPayload>()
  const [error, setError] = useState('')
  /**
   * The read failed because this session has no extension scope yet, which is a
   * different message to a read that broke: the first resolves when the session is
   * used, and saying so is what stops a waiting control reading as a broken one.
   */
  const [notReady, setNotReady] = useState(false)
  const [reload, setReload] = useState(0)
  const current = useRef<ExtensionWindowPayload>(undefined)
  const active = useRef(false)
  const epoch = useRef(0)
  const pending = useRef(0)
  const generation = useRef(0)
  const queue = useRef(createWriteQueue())
  const notified = useRef<{ sessionId: string; revision: number }>()
  const notify = (next: ExtensionWindowPayload) => {
    if (next.status?.ready === false) return
    if (notified.current?.sessionId === sessionId && notified.current.revision === next.state.revision) return
    notified.current = { sessionId, revision: next.state.revision }
    observer?.committed(sessionId)
  }
  useEffect(() => {
    let alive = true
    active.current = true
    epoch.current++
    let timer: ReturnType<typeof setTimeout>
    let readSequence = 0
    /** Set when a read finished under a hidden document, so the poll has to resume. */
    let paused = false
    /**
     * Set when the route answered that it does not exist.
     *
     * Polling then spends a request per interval to learn nothing, and the browser
     * logs every one of them. The surface still reports the state; a retry the user
     * asks for re-runs this effect and clears the flag.
     */
    let unavailable = false
    /** Grows while the session has no extension scope, so a closed loop costs little. */
    let notReadyWait = EXTENSION_WINDOW_POLL_MS
    current.current = undefined
    setData(undefined)
    const load = async () => {
      clearTimeout(timer)
      const stamp = epoch.current
      const sequence = ++readSequence
      try {
        const next = await readWindow(sessionId)
        if (alive && sequence === readSequence && stamp === epoch.current && pending.current === 0) {
          current.current = next
          setData(next)
          setError('')
          setNotReady(false)
          notify(next)
        }
      } catch (reason) {
        const marked = flags(reason)
        if (marked.unavailable) unavailable = true
        if (marked.notReady) setNotReady(true)
        if (marked.notReady) notReadyWait = Math.min(NOT_READY_MAX_WAIT_MS, notReadyWait * 2)
        else notReadyWait = EXTENSION_WINDOW_POLL_MS
        if (alive && sequence === readSequence && stamp === epoch.current && pending.current === 0) setError(String(reason))
      }
      if (alive && sequence === readSequence && !unavailable) {
        // A hidden document schedules nothing. The listener below resumes, so a
        // paused poll costs no timer and no read for as long as it stays hidden.
        if (hidden()) paused = true
        else
          timer = setTimeout(() => {
            void load()
          }, notReadyWait)
      }
    }
    // Only a paused poll resumes here: a window that was never hidden keeps its
    // armed timer, so a focus change cannot add a read.
    const onVisibilityChange = (): void => {
      if (!alive || unavailable || !paused || hidden()) return
      paused = false
      void load()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange)
    const unsubscribe = observer?.subscribe(sessionId, () => {
      if (!unavailable) void load()
    })
    void load()
    return () => {
      unsubscribe?.()
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange)
      alive = false
      active.current = false
      current.current = undefined
      clearTimeout(timer)
    }
  }, [sessionId, reload, observer])
  const mutate = (action: Mutation, body: Record<string, unknown>, draftRevision?: { current: number }) => {
    const batch = generation.current
    pending.current++
    epoch.current++
    return queue
      .current(async () => {
        if (batch !== generation.current) throw new Error('An earlier save failed; retry the retained draft')
        const before = current.current
        if (!before || before.sessionId !== sessionId) throw new Error('Session changed')
        const revision =
          action === 'recover'
            ? before.status!.revision
            : (draftRevision?.current ?? (action === 'select' ? (before.selectionRevision ?? before.intendedRevision ?? before.state.revision) : before.library.revision))
        try {
          const next = await writeWindow(action, sessionId, revision, body)
          if (draftRevision) draftRevision.current = action === 'select' ? (next.selectionRevision ?? next.intendedRevision ?? next.state.revision) : next.library.revision
          if (active.current && current.current?.sessionId === sessionId) {
            current.current = next
            setData(next)
            setError('')
          }
          notify(next)
          return next
        } catch (reason) {
          generation.current++
          // Refresh revisions without replacing the editor's local draft.
          try {
            const next = await readWindow(sessionId)
            if (active.current && current.current?.sessionId === sessionId) {
              current.current = next
              setData(next)
            }
          } catch {
            /* The visible failure remains actionable. */
          }
          throw reason
        }
      })
      .finally(() => {
        pending.current--
        epoch.current++
      })
  }
  return { data, error, notReady, mutate, retry: () => setReload(value => value + 1) }
}
