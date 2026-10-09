// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createSkillCatalogRefresh, type SkillCatalogEntry } from '../packages/market-ui/src/ui/skill-catalog-refresh.js'
import { installMenuRowFace } from '../packages/market-ui/src/ui/menu-row-face.js'

const session = (sessionId = 'one') => ({ sessionId })
const request = (query = '', signal = new AbortController().signal) => ({ query, signal })
const row = (name: string, extra: Partial<SkillCatalogEntry> = {}): SkillCatalogEntry => ({
  name,
  description: name,
  modelInvocable: true,
  path: '/' + name + '/SKILL.md',
  ...extra
})

function fixture(late = false) {
  let rows: SkillCatalogEntry[] = [row('before')]
  // The published rc.2 source keeps its settled catalog until native preset/reset events.
  const cached = [...rows]
  const source = {
    trigger: '/',
    name: 'skill',
    order: 2,
    candidates: vi.fn(async (_session: { sessionId: string }, _request: { query: string; signal: AbortSignal }) => cached.map(({ name, description }) => ({ name, description }))),
    lexicon: (_session: { sessionId: string }): readonly string[] | undefined => cached.map(item => item.name),
    subscribeLexicon: (_session: { sessionId: string }, _listener: () => void) => () => {},
    openReference: vi.fn(() => true),
    onPick: ({ candidate }: { candidate: { name: string } }) => ({ text: '/' + candidate.name + ' ' })
  }
  const sources: unknown[] = late ? [] : [source]
  const open = new Set<string>(['one', 'two'])
  const shown = new Map<string, unknown>()
  const inputTriggers = {
    live: { sources },
    registerSource(value: unknown) {
      sources.push(value)
      return () => {
        const at = sources.indexOf(value)
        if (at >= 0) sources.splice(at, 1)
      }
    },
    sessionOf: (scope: { sessionId: string }) => ({
      refreshOpenMenu() {
        if (open.has(scope.sessionId)) void source.candidates(scope, request()).then(value => shown.set(scope.sessionId, value))
      }
    })
  }
  const scopes = new Map(['one', 'two', 'child'].map(id => [id, session(id)]))
  const sessions = { scope: (id: string) => scopes.get(id), subagentAddress: (id: string) => (id === 'child' ? {} : undefined) }
  const list = vi.fn(async (_id: string, _signal: AbortSignal) => rows)
  const openResource = vi.fn()
  const options = { inputTriggers, sessions, list, userOnlyLabel: () => 'user-only', openResource }
  return {
    source,
    options,
    list,
    openResource,
    shown,
    open,
    scopes,
    setRows: (next: SkillCatalogEntry[]) => {
      rows = next
    }
  }
}

describe('live skill catalog compatibility adapter', () => {
  it('replaces a warm host snapshot without changing the source or pick contract', async () => {
    const f = fixture()
    const onPick = f.source.onPick
    expect(await f.source.candidates(session(), request())).toEqual([{ name: 'before', description: 'before' }])
    const live = createSkillCatalogRefresh(f.options)
    f.setRows([row('after')])
    expect(await f.source.candidates(session(), request())).toEqual([{ name: 'after', description: 'after' }])
    expect(f.source.lexicon(session())).toEqual(['after'])
    expect(f.source.onPick).toBe(onPick)
    expect(f.source.onPick({ candidate: { name: 'after' } })).toEqual({ text: '/after ' })
    live.dispose()
  })

  it('refreshes only the committed session and updates previews and lexicons', async () => {
    const f = fixture()
    const live = createSkillCatalogRefresh(f.options)
    await f.source.candidates(session(), request())
    await f.source.candidates(session('two'), request())
    const one = vi.fn(() => f.options.inputTriggers.sessionOf(session()).refreshOpenMenu())
    const two = vi.fn()
    const offOne = f.source.subscribeLexicon(session(), one)
    const offTwo = f.source.subscribeLexicon(session('two'), two)
    f.setRows([row('after')])
    live.refresh('one')
    await vi.waitFor(() => expect(f.shown.get('one')).toEqual([{ name: 'after', description: 'after' }]))
    expect(one).toHaveBeenCalled()
    expect(two).not.toHaveBeenCalled()
    expect(f.source.lexicon(session('two'))).toEqual(['before'])
    const openReference = f.source.openReference as unknown as (session: { sessionId: string }, request: { ref: string }) => boolean
    expect(openReference(session(), { ref: '/after' })).toBe(true)
    expect(f.openResource).toHaveBeenCalledWith('one', '/after/SKILL.md')
    expect(openReference(session(), { ref: '/before' })).toBe(false)
    offOne()
    offTwo()
    live.dispose()
  })

  it('keeps the newest snapshot while live callers retain their own responses', async () => {
    const f = fixture()
    const answers: Array<(rows: SkillCatalogEntry[]) => void> = []
    f.list.mockImplementation(() => new Promise(resolve => answers.push(resolve)))
    const live = createSkillCatalogRefresh(f.options)
    const first = f.source.candidates(session(), request())
    const second = f.source.candidates(session(), request())
    const other = f.source.candidates(session('two'), request())
    answers[1]!([row('new')])
    answers[2]!([row('sibling')])
    await second
    await other
    answers[0]!([row('stale')])
    expect(await first).toEqual([{ name: 'stale', description: 'stale' }])
    expect(f.source.lexicon(session())).toEqual(['new'])
    expect(f.source.lexicon(session('two'))).toEqual(['sibling'])
    const abort = new AbortController()
    const cancelled = f.source.candidates(session(), request('', abort.signal))
    abort.abort()
    answers[3]!([row('cancelled')])
    expect(await cancelled).toEqual([])
    expect(f.source.lexicon(session())).toEqual(['new'])
    live.dispose()
  })

  it.each(['candidate-first', 'warm-first'])('keeps candidate rows when a background warm completes later (%s)', async order => {
    const f = fixture()
    const answers: Array<(rows: SkillCatalogEntry[]) => void> = []
    f.list.mockImplementation(() => new Promise(resolve => answers.push(resolve)))
    const live = createSkillCatalogRefresh(f.options)
    f.source.subscribeLexicon(session(), () => {})
    const warm = () => (f.source as unknown as { warm: (session: { sessionId: string }) => void }).warm(session())
    if (order === 'warm-first') warm()
    const candidate = f.source.candidates(session(), request())
    if (order === 'candidate-first') warm()
    const candidateIndex = order === 'candidate-first' ? 0 : 1
    answers[1 - candidateIndex]!([row('warm')])
    answers[candidateIndex]!([row('candidate')])
    expect(await candidate).toEqual([{ name: 'candidate', description: 'candidate' }])
    live.dispose()
  })

  it('does not rebind a normally subscribed controller', async () => {
    const f = fixture()
    const removed = vi.fn()
    const added = vi.fn()
    const set = vi.fn()
    f.options.inputTriggers.sessionOf = () => ({ menu: { getSnapshot: () => ({ open: true }), set }, sourceRemoved: removed, sourceAdded: added, refreshOpenMenu() {} })
    const live = createSkillCatalogRefresh(f.options)
    f.source.subscribeLexicon(session(), () => {})
    await f.source.candidates(session(), request())
    expect(removed).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
    live.dispose()
  })

  it('refreshes all observed sessions on a native connection reset', async () => {
    const f = fixture()
    f.open.clear()
    const live = createSkillCatalogRefresh(f.options)
    await f.source.candidates(session(), request())
    await f.source.candidates(session('two'), request())
    f.setRows([row('reset')])
    live.refreshAll()
    await vi.waitFor(() => {
      expect(f.source.lexicon(session())).toEqual(['reset'])
      expect(f.source.lexicon(session('two'))).toEqual(['reset'])
    })
    live.dispose()
  })

  it('refreshes the stationary menu when its only lexicon subscriber is an editor', async () => {
    const f = fixture()
    const live = createSkillCatalogRefresh(f.options)
    await f.source.candidates(session(), request())
    f.source.subscribeLexicon(session(), vi.fn())
    f.setRows([row('after')])
    live.refresh('one')
    await vi.waitFor(() => expect(f.shown.get('one')).toEqual([{ name: 'after', description: 'after' }]))
    live.dispose()
  })

  it('refreshes a closed menu lexicon without waiting for another candidate request', async () => {
    const f = fixture()
    f.open.clear()
    const live = createSkillCatalogRefresh(f.options)
    await f.source.candidates(session(), request())
    f.setRows([row('after')])
    live.refresh('one')
    await vi.waitFor(() => expect(f.source.lexicon(session())).toEqual(['after']))
    live.dispose()
  })

  it('clears revoked rows after invalidation even when the next RPC fails', async () => {
    const f = fixture()
    f.open.clear()
    const live = createSkillCatalogRefresh(f.options)
    await f.source.candidates(session(), request())
    f.list.mockRejectedValue(new Error('catalog unavailable'))
    live.refresh('one')
    expect(f.source.lexicon(session())).toEqual([])
    await expect(f.source.candidates(session(), request())).rejects.toThrow('catalog unavailable')
    expect(f.source.lexicon(session())).toEqual([])
    live.dispose()
  })

  it('adapts late registration, ranks user-only rows and skips child sessions', async () => {
    const f = fixture(true)
    const live = createSkillCatalogRefresh(f.options)
    f.options.inputTriggers.registerSource(f.source)
    f.setRows([row('x-review'), row('review', { modelInvocable: false }), row('other')])
    expect(await f.source.candidates(session(), request('rev'))).toEqual([
      { name: 'review', description: 'user-only · review' },
      { name: 'x-review', description: 'x-review' }
    ])
    const calls = f.list.mock.calls.length
    expect(await f.source.candidates(session('child'), request())).toEqual([])
    expect(f.list).toHaveBeenCalledTimes(calls)
    live.refresh('missing')
    live.dispose()
  })

  it.each(['faces-first', 'catalog-first'])('keeps translations through either wrapper order: %s', async order => {
    const f = fixture()
    const face = () => installMenuRowFace({ commandUi: undefined, inputTriggers: f.options.inputTriggers, faceOf: () => ({ description: 'translated' }) })
    const offFace = order === 'faces-first' ? face() : undefined
    const live = createSkillCatalogRefresh(f.options)
    const laterFace = order === 'catalog-first' ? face() : undefined
    f.setRows([row('after')])
    expect(await f.source.candidates(session(), request())).toEqual([{ name: 'after', description: 'translated' }])
    ;(offFace ?? laterFace)!()
    expect(await f.source.candidates(session(), request())).toEqual([{ name: 'after', description: 'after' }])
    live.dispose()
    expect(await f.source.candidates(session(), request())).toEqual([{ name: 'before', description: 'before' }])
  })

  it('does not publish a response into a replacement session scope', async () => {
    const f = fixture()
    let answer!: (rows: SkillCatalogEntry[]) => void
    f.list.mockImplementation(
      () =>
        new Promise(resolve => {
          answer = resolve
        })
    )
    const live = createSkillCatalogRefresh(f.options)
    const pending = f.source.candidates(session(), request())
    f.scopes.set('one', session())
    answer([row('old-generation')])
    expect(await pending).toEqual([])
    expect(f.source.lexicon(session())).toEqual([])
    live.dispose()
  })

  it('does not expose a previous scope snapshot while its replacement loads', async () => {
    const f = fixture()
    const live = createSkillCatalogRefresh(f.options)
    await f.source.candidates(session(), request())
    f.scopes.set('one', session())
    let answer!: (rows: SkillCatalogEntry[]) => void
    f.list.mockImplementation(
      () =>
        new Promise(resolve => {
          answer = resolve
        })
    )
    const pending = f.source.candidates(session(), request())
    expect(f.source.lexicon(session())).toEqual([])
    answer([row('replacement')])
    await pending
    expect(f.source.lexicon(session())).toEqual(['replacement'])
    live.dispose()
  })

  it('restores host catalog while a translation wrapper remains installed', async () => {
    const f = fixture()
    const live = createSkillCatalogRefresh(f.options)
    const offFace = installMenuRowFace({ commandUi: undefined, inputTriggers: f.options.inputTriggers, faceOf: () => ({ description: 'translated' }) })
    live.dispose()
    expect(await f.source.candidates(session(), request())).toEqual([{ name: 'before', description: 'translated' }])
    offFace()
    expect(await f.source.candidates(session(), request())).toEqual([{ name: 'before', description: 'before' }])
  })

  it.each([true, false])('rebinds a retained controller lexicon and restores native updates (open=%s)', async open => {
    const f = fixture()
    const nativeListeners = new Set<() => void>()
    f.source.subscribeLexicon = (_session, listener) => {
      nativeListeners.add(listener)
      return () => {
        nativeListeners.delete(listener)
      }
    }
    let menu = { open, hit: { trigger: '/' } }
    const menuListeners = new Set<() => void>()
    let aggregate: readonly string[] | undefined
    let off = f.source.subscribeLexicon(session(), () => {
      aggregate = f.source.lexicon(session())
    })
    let closedByRemoval = false
    const controller = {
      menu: {
        getSnapshot: () => menu,
        set: (value: typeof menu) => {
          menu = value
          for (const listener of menuListeners) listener()
        },
        subscribe: (listener: () => void) => {
          menuListeners.add(listener)
          return () => {
            menuListeners.delete(listener)
          }
        }
      },
      sourceRemoved() {
        if (menu.open) {
          closedByRemoval = true
          menu = { ...menu, open: false }
        }
        off()
      },
      sourceAdded() {
        off = f.source.subscribeLexicon(session(), () => {
          aggregate = f.source.lexicon(session())
        })
        aggregate = f.source.lexicon(session())
      },
      refreshOpenMenu() {}
    }
    f.options.inputTriggers.sessionOf = () => controller
    const live = createSkillCatalogRefresh(f.options)
    f.setRows([row('after')])
    if (open) {
      await f.source.candidates(session(), request())
      expect(menu.open).toBe(true)
      expect(nativeListeners.size).toBe(1)
      controller.menu.set({ ...menu, open: false })
    } else live.refresh('one')
    await vi.waitFor(() => expect(aggregate).toEqual(['after']))
    expect(nativeListeners.size).toBe(0)
    expect(menu.open).toBe(false)
    expect(closedByRemoval).toBe(false)
    live.dispose()
    expect(nativeListeners.size).toBe(1)
    for (const listener of nativeListeners) listener()
    expect(aggregate).toEqual(['before'])
    expect(menu.open).toBe(false)
  })

  it('never rebinds a retired source after native replacement or adapter disposal', async () => {
    const f = fixture()
    f.open.clear()
    const rebound: unknown[] = []
    const controller = {
      menu: { getSnapshot: () => ({ open: false }), set() {} },
      sourceRemoved() {},
      sourceAdded(source: unknown) {
        rebound.push(source)
      },
      refreshOpenMenu() {}
    }
    f.options.inputTriggers.sessionOf = () => controller
    const live = createSkillCatalogRefresh(f.options)
    await f.source.candidates(session(), request())
    const replacement = { ...f.source, candidates: vi.fn(async () => []), warm: () => {} }
    f.options.inputTriggers.live.sources.splice(0)
    f.options.inputTriggers.registerSource(replacement)
    rebound.length = 0
    live.refresh('one')
    await vi.waitFor(() => expect(rebound.length).toBeGreaterThan(0))
    expect(rebound).not.toContain(f.source)
    expect(rebound).toContain(replacement)
    // A second refresh previously revisited the retired source after the remembered source changed.
    rebound.length = 0
    live.refresh('one')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(rebound).not.toContain(f.source)
    rebound.length = 0
    live.dispose()
    expect(rebound).not.toContain(f.source)
  })

  it('does not remove a pre-existing menu source and notifies only changed catalogs', async () => {
    const f = fixture()
    const updated = vi.fn()
    let unsubscribe = () => {}
    const removed = vi.fn(() => unsubscribe())
    const added = vi.fn(() => {
      unsubscribe = f.source.subscribeLexicon(session(), updated)
    })
    f.options.inputTriggers.sessionOf = () => ({ sourceRemoved: removed, sourceAdded: added, refreshOpenMenu() {} })
    const live = createSkillCatalogRefresh(f.options)
    unsubscribe = f.source.subscribeLexicon(session(), updated)
    await f.source.candidates(session(), request())
    await f.source.candidates(session(), request())
    expect(removed).not.toHaveBeenCalled()
    expect(added).not.toHaveBeenCalled()
    expect(updated).toHaveBeenCalledTimes(1)
    f.setRows([row('changed')])
    await f.source.candidates(session(), request())
    expect(updated).toHaveBeenCalledTimes(2)
    live.dispose()
    expect(added).not.toHaveBeenCalled()
  })

  it('bounds real sourceAdded warm and lexicon-triggered candidate reentry', async () => {
    const f = fixture()
    let unsubscribe = () => {}
    let shown: unknown
    let requestAbort = new AbortController()
    const requery = () => {
      requestAbort.abort()
      requestAbort = new AbortController()
      void f.source.candidates(session(), request('', requestAbort.signal)).then(rows => {
        shown = rows
      })
    }
    const controller = {
      sourceRemoved() {
        unsubscribe()
      },
      sourceAdded() {
        const warm = (f.source as unknown as { warm: (session: { sessionId: string }) => void }).warm
        warm(session())
        unsubscribe = f.source.subscribeLexicon(session(), () => {
          void Promise.resolve().then(requery)
        })
      },
      refreshOpenMenu: requery
    }
    f.options.inputTriggers.sessionOf = () => controller
    const live = createSkillCatalogRefresh(f.options)
    controller.sourceAdded()
    requery()
    await vi.waitFor(() => expect(shown).toEqual([{ name: 'before', description: 'before' }]))
    expect(f.list.mock.calls.length).toBeLessThanOrEqual(3)
    const before = f.list.mock.calls.length
    f.setRows([row('after')])
    live.refresh('one')
    await vi.waitFor(() => expect(shown).toEqual([{ name: 'after', description: 'after' }]))
    // Revocation and fresh lexicon notifications can each requery; explicit menu refresh does not assume listener ownership.
    expect(f.list.mock.calls.length - before).toBeLessThanOrEqual(4)
    // Restore without warming the fixture's original source, which deliberately has no warm hook.
    controller.sourceAdded = () => {}
    live.dispose()
  })

  it.each(['close', 'scope'])('releases its one deferred disposal subscription on %s', async boundary => {
    const f = fixture()
    const cleanups: Array<() => void> = []
    const scope = {
      ...session(),
      effect: (callback: () => () => void) => {
        cleanups.push(callback())
      }
    }
    f.scopes.set('one', scope)
    let open = true
    const menuListeners = new Set<() => void>()
    const added = vi.fn()
    f.options.inputTriggers.sessionOf = () => ({
      menu: {
        getSnapshot: () => ({ open }),
        subscribe: (listener: () => void) => {
          menuListeners.add(listener)
          return () => {
            menuListeners.delete(listener)
          }
        }
      },
      sourceRemoved() {},
      sourceAdded: added,
      refreshOpenMenu() {}
    })
    const live = createSkillCatalogRefresh(f.options)
    f.source.subscribeLexicon(session(), () => {})
    await f.source.candidates(session(), request())
    live.dispose()
    live.dispose()
    expect(menuListeners.size).toBe(1)
    if (boundary === 'close') {
      open = false
      for (const listener of [...menuListeners]) listener()
      expect(added).toHaveBeenCalledTimes(1)
    } else {
      for (const cleanup of cleanups.reverse()) cleanup()
      expect(added).not.toHaveBeenCalled()
    }
    expect(menuListeners.size).toBe(0)
  })

  it('does not remove the live menu source during disposal', () => {
    const f = fixture()
    const removed = vi.fn()
    const added = vi.fn()
    f.options.inputTriggers.sessionOf = () => ({ sourceRemoved: removed, sourceAdded: added, refreshOpenMenu() {} })
    const live = createSkillCatalogRefresh(f.options)
    f.source.subscribeLexicon(session(), () => {})
    live.dispose()
    expect(removed).not.toHaveBeenCalled()
    expect(added).not.toHaveBeenCalled()
  })

  it('aborts session work and drops snapshots when its public scope disposes', async () => {
    const f = fixture()
    const cleanup: Array<() => void> = []
    const scope = {
      ...session(),
      effect: (callback: () => () => void) => {
        cleanup.push(callback())
      }
    }
    f.scopes.set('one', scope)
    let answer!: (rows: SkillCatalogEntry[]) => void
    let signal!: AbortSignal
    f.list.mockImplementation((_id, current) => {
      signal = current
      return new Promise(resolve => {
        answer = resolve
      })
    })
    const live = createSkillCatalogRefresh(f.options)
    const pending = f.source.candidates(session(), request())
    expect(cleanup).toHaveLength(1)
    cleanup[0]!()
    expect(signal.aborted).toBe(true)
    answer([row('disposed')])
    expect(await pending).toEqual([])
    expect(f.source.lexicon(session())).toEqual([])
    live.dispose()
  })

  it('leaves a later method owner installed on disposal', () => {
    const f = fixture()
    const live = createSkillCatalogRefresh(f.options)
    const later = vi.fn(async () => [])
    f.source.candidates = later
    live.dispose()
    expect(f.source.candidates).toBe(later)
  })

  it('restores source methods and ignores late completion after disposal', async () => {
    const f = fixture()
    const before = { ...f.source }
    let answer!: (rows: SkillCatalogEntry[]) => void
    f.list.mockImplementation(
      () =>
        new Promise(resolve => {
          answer = resolve
        })
    )
    const live = createSkillCatalogRefresh(f.options)
    const pending = f.source.candidates(session(), request())
    live.dispose()
    answer([row('late')])
    expect(await pending).toEqual([])
    expect(f.source.candidates).toBe(before.candidates)
    expect(f.source.lexicon).toBe(before.lexicon)
    expect(f.source.openReference).toBe(before.openReference)
  })
})
