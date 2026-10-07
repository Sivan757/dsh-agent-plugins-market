import { useEffect, useRef, useState } from 'react'
import type { ExtensionWindowPayload } from '../../../../market-contracts/src/contracts/extension-presets.js'
import { createWriteQueue, readWindow, writeWindow, type Mutation } from './resource.js'

/** Session-scoped polling: the legacy inventory reader has no session or revision semantics. */
export function useExtensionWindow(sessionId: string) {
  const [data, setData] = useState<ExtensionWindowPayload>()
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const current = useRef<ExtensionWindowPayload>(undefined)
  const active = useRef(false)
  const epoch = useRef(0)
  const pending = useRef(0)
  const generation = useRef(0)
  const queue = useRef(createWriteQueue())
  useEffect(() => {
    let alive = true
    active.current = true
    epoch.current++
    let timer: ReturnType<typeof setTimeout>
    current.current = undefined
    setData(undefined)
    const load = async () => {
      const stamp = epoch.current
      try {
        const next = await readWindow(sessionId)
        if (alive && stamp === epoch.current && pending.current === 0) {
          current.current = next
          setData(next)
          setError('')
        }
      } catch (reason) {
        if (alive && stamp === epoch.current && pending.current === 0) setError(String(reason))
      }
      if (alive)
        timer = setTimeout(() => {
          void load()
        }, 2500)
    }
    void load()
    return () => {
      alive = false
      active.current = false
      current.current = undefined
      clearTimeout(timer)
    }
  }, [sessionId, reload])
  const mutate = (action: Mutation, body: Record<string, unknown>, draftRevision?: { current: number }) => {
    const batch = generation.current
    pending.current++
    epoch.current++
    return queue
      .current(async () => {
        if (batch !== generation.current) throw new Error('An earlier save failed; retry the retained draft')
        const before = current.current
        if (!before || before.sessionId !== sessionId) throw new Error('Session changed')
        const revision = action === 'recover' ? before.status!.revision : (draftRevision?.current ?? (action === 'select' ? before.state.revision : before.library.revision))
        try {
          const next = await writeWindow(action, sessionId, revision, body)
          if (draftRevision) draftRevision.current = action === 'select' ? next.state.revision : next.library.revision
          if (active.current && current.current?.sessionId === sessionId) {
            current.current = next
            setData(next)
            setError('')
          }
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
