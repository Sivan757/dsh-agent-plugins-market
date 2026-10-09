import { describe, expect, it, vi } from 'vitest'
import { watchSelectionCommits, type SelectionCommitBinding } from '../packages/market-ui/src/ui/selection-skill-notifications.js'

function commit(revision: number, ownerId = 'one', phase = 'committed', requestRevision?: number) {
  return {
    type: 'event',
    event: {
      type: 'agent/inbox/spliced',
      data: {
        inserted: [
          { source: { kind: 'market-extension-selection', binding: { version: 1, ownerId, revision, phase, ...(requestRevision === undefined ? {} : { requestRevision }) } } }
        ]
      }
    }
  }
}
function fixture(entries: readonly unknown[] = []) {
  const listeners = new Set<() => void>()
  let snapshot = { entries, change: { kind: 'replace', entries }, revision: 1 }
  const binding: SelectionCommitBinding = {
    sessionId: 'one',
    eventSource: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }
    }
  }
  return {
    binding,
    listeners,
    publish(kind: string, next: readonly unknown[]) {
      snapshot = { entries: kind === 'replace' ? next : [...snapshot.entries, ...next], change: { kind, entries: next }, revision: snapshot.revision + 1 }
      for (const listener of listeners) listener()
    }
  }
}

describe('committed selection event notifications', () => {
  it('reports the latest initial commit and later durable append without pending intent', () => {
    const f = fixture([commit(1), commit(2), commit(3, 'one', 'pending')])
    const notified = vi.fn()
    const stop = watchSelectionCommits(f.binding, notified)
    expect(notified).toHaveBeenCalledExactlyOnceWith({ ownerId: 'one', revision: 2 })
    f.publish('append', [commit(3, 'one', 'pending'), commit(3, 'other')])
    expect(notified).toHaveBeenCalledTimes(1)
    f.publish('append', [commit(3, 'one', 'committed', 7)])
    expect(notified).toHaveBeenLastCalledWith({ ownerId: 'one', revision: 3, requestRevision: 7 })
    stop()
    expect(f.listeners.size).toBe(0)
  })

  it('deduplicates replay and replacement windows and ignores historical prepend', () => {
    const f = fixture([commit(4)])
    const notified = vi.fn()
    const stop = watchSelectionCommits(f.binding, notified)
    f.publish('replace', [commit(4)])
    f.publish('prepend', [commit(3)])
    f.publish('replace', [])
    f.publish('replace', [commit(4)])
    expect(notified).toHaveBeenCalledTimes(1)
    f.publish('replace', [commit(4), commit(5)])
    expect(notified).toHaveBeenCalledTimes(2)
    expect(notified).toHaveBeenLastCalledWith({ ownerId: 'one', revision: 5 })
    stop()
  })

  it('accepts user/message records and rejects malformed or unrelated entries', () => {
    const f = fixture()
    const notified = vi.fn()
    const stop = watchSelectionCommits(f.binding, notified)
    const source = commit(1).event.data.inserted[0]!.source
    f.publish('append', [
      null,
      {},
      { type: 'transient' },
      commit(-1),
      commit(Number.NaN),
      commit(1, 'one', 'unknown'),
      { type: 'event', event: { type: 'user/message', data: { source: { ...source, kind: 'market-extension-intent' } } } }
    ])
    expect(notified).not.toHaveBeenCalled()
    f.publish('append', [{ type: 'event', event: { type: 'user/message', data: { source } } }])
    expect(notified).toHaveBeenCalledExactlyOnceWith({ ownerId: 'one', revision: 1 })
    stop()
    f.publish('append', [commit(2)])
    expect(notified).toHaveBeenCalledTimes(1)
  })
})
