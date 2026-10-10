import { useEffect, useRef, useState } from 'react'
import type { ExtensionWindowPayload } from '../../../../market-contracts/src/contracts/extension-presets.js'
import { createWriteQueue, readWindow, writeWindow, type Mutation } from './resource.js'

export interface ExtensionWindowObserver {
  committed(sessionId: string): void
  subscribe(sessionId: string, refresh: () => void): () => void
}

/** Commit events refresh immediately; polling remains the inventory fallback. */
export function useExtensionWindow(sessionId: string, observer?: ExtensionWindowObserver) {
  const [data, setData] = useState<ExtensionWindowPayload>()
  const [error, setError] = useState('')
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
          notify(next)
        }
      } catch (reason) {
        if (alive && sequence === readSequence && stamp === epoch.current && pending.current === 0) setError(String(reason))
      }
      if (alive && sequence === readSequence)
        timer = setTimeout(() => {
          void load()
        }, 2500)
    }
    const unsubscribe = observer?.subscribe(sessionId, () => {
      void load()
    })
    void load()
    return () => {
      unsubscribe?.()
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
  return { data, error, mutate, retry: () => setReload(value => value + 1) }
}
