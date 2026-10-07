// @vitest-environment jsdom
/**
 * The `/` menu face source: the wrapper it installs, the map it feeds it, and
 * the two promises that matter — a failed read never breaks the menu, and a row
 * the host sent nothing for keeps the host's own text.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMenuRowFaces, MENU_FACE_REVALIDATE_MS, MENU_FACE_MAX_READS } from '../src/client/menu-row-faces.js'
import type { MenuRowFaceWire } from '../src/contracts/market.js'

/** A `/` command service whose `candidates` answers the given rows. */
function commandService(rows: readonly unknown[]) {
  const proto = {
    async candidates(): Promise<readonly unknown[]> {
      return rows
    }
  }
  return Object.create(proto) as { candidates: () => Promise<readonly unknown[]> }
}

afterEach(() => vi.useRealTimers())

describe('the menu row face source', () => {
  it('refreshes a stationary open menu, bounds reads, and restores original text on off', async () => {
    vi.useFakeTimers()
    const host = { name: 'deploy', description: 'Deploy' }
    let shown: readonly unknown[]
    let open = true
    const listeners = new Set<() => void>()
    const service = { candidates: async (_session: { sessionId: string }): Promise<readonly unknown[]> => [host] }
    const controller = {
      menu: {
        getSnapshot: () => ({ open }),
        subscribe: (fn: () => void) => {
          listeners.add(fn)
          return () => {
            listeners.delete(fn)
          }
        }
      },
      refreshOpenMenu: vi.fn(() => {
        void service.candidates({ sessionId: 'test' }).then(rows => {
          shown = rows
        })
      })
    }
    const scope = {}
    const sessions = { scope: vi.fn(() => scope) }
    const inputTriggers = { sessionOf: vi.fn(() => controller) }
    let warm = false
    const load = vi.fn(async (): Promise<MenuRowFaceWire[]> => (warm ? [{ source: 'commands', name: 'deploy', description: '部署' }] : []))
    const source = createMenuRowFaces({ commandUi: service, inputTriggers, sessions, load })
    await source.refresh()
    shown = await service.candidates({ sessionId: 'test' })
    expect(shown).toEqual([host])
    await vi.advanceTimersByTimeAsync(25_000)
    expect(shown).toEqual([host])
    warm = true
    await vi.advanceTimersByTimeAsync(MENU_FACE_REVALIDATE_MS)
    expect(shown).toEqual([{ ...host, description: '部署' }])
    expect(controller.refreshOpenMenu).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(1 + MENU_FACE_MAX_READS)
    expect(controller.refreshOpenMenu).toHaveBeenCalledTimes(1)
    source.dispose()
    await Promise.resolve()
    await Promise.resolve()
    expect(shown).toEqual([host])
    expect(listeners.size).toBe(0)
    open = false
    expect(sessions.scope).toHaveBeenCalledWith('test')
    expect(inputTriggers.sessionOf).toHaveBeenCalledWith(scope)
  })

  it('stops open-menu polling immediately on close and ignores a missing retained scope', async () => {
    vi.useFakeTimers()
    let open = true
    const listeners = new Set<() => void>()
    const controller = {
      menu: {
        getSnapshot: () => ({ open }),
        subscribe: (fn: () => void) => {
          listeners.add(fn)
          return () => {
            listeners.delete(fn)
          }
        }
      },
      refreshOpenMenu: vi.fn()
    }
    const service = { candidates: async (_session: { sessionId: string }) => [{ name: 'deploy' }] }
    const inputTriggers = { sessionOf: vi.fn(() => controller) }
    const load = vi.fn(async () => [])
    const source = createMenuRowFaces({ commandUi: service, inputTriggers, sessions: { scope: (id: string) => (id === 'live' ? {} : undefined) }, load })
    await source.refresh()
    await service.candidates({ sessionId: 'gone' })
    expect(inputTriggers.sessionOf).not.toHaveBeenCalled()
    await service.candidates({ sessionId: 'live' })
    open = false
    for (const listener of listeners) listener()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(load).toHaveBeenCalledTimes(1)
    expect(controller.refreshOpenMenu).not.toHaveBeenCalled()
    expect(listeners.size).toBe(0)
    source.dispose()
  })

  it('revalidates a cold face on demand without blocking candidates or polling while idle', async () => {
    vi.useFakeTimers()
    const host = { name: 'deploy', description: 'Deploy' }
    const service = commandService([host])
    let answer!: (rows: MenuRowFaceWire[]) => void
    const load = vi
      .fn<() => Promise<MenuRowFaceWire[]>>()
      .mockResolvedValueOnce([])
      .mockImplementation(
        () =>
          new Promise(resolve => {
            answer = resolve
          })
      )
    const source = createMenuRowFaces({ commandUi: service, inputTriggers: undefined, load })
    await source.refresh()
    await vi.advanceTimersByTimeAsync(10 * MENU_FACE_REVALIDATE_MS)
    expect(load).toHaveBeenCalledTimes(1)
    expect(await service.candidates()).toEqual([host])
    expect(load).toHaveBeenCalledTimes(2)
    for (let i = 0; i < 10; i++) expect(await service.candidates()).toEqual([host])
    expect(load).toHaveBeenCalledTimes(2)
    answer([{ source: 'commands', name: 'deploy', description: '部署' }])
    await Promise.resolve()
    expect(await service.candidates()).toEqual([{ ...host, description: '部署' }])
    source.dispose()
  })

  it('keeps the newest locale response and clears the previous locale immediately', async () => {
    const host = { name: 'deploy', description: 'Deploy' }
    const service = commandService([host])
    const answers: Array<(rows: MenuRowFaceWire[]) => void> = []
    const source = createMenuRowFaces({
      commandUi: service,
      inputTriggers: undefined,
      load: () =>
        new Promise(resolve => {
          answers.push(resolve)
        })
    })
    const first = source.refresh()
    answers[0]!([{ source: 'commands', name: 'deploy', description: '旧译文' }])
    await first
    expect(await service.candidates()).toEqual([{ ...host, description: '旧译文' }])
    const stale = source.refresh()
    const current = source.refresh(true)
    expect(await service.candidates()).toEqual([host])
    answers[2]!([{ source: 'commands', name: 'deploy', description: 'New translation' }])
    await current
    answers[1]!([{ source: 'commands', name: 'deploy', description: '过期译文' }])
    await stale
    expect(await service.candidates()).toEqual([{ ...host, description: 'New translation' }])
    source.dispose()
  })

  it('faces the rows the host translated', async () => {
    const host = { name: 'deploy', description: 'Deploy the fixture' }
    const service = commandService([host])
    const source = createMenuRowFaces({
      commandUi: service,
      inputTriggers: undefined,
      load: async () => [{ source: 'commands', name: 'deploy', description: '部署这个夹具' }]
    })
    await source.refresh()
    expect(await service.candidates()).toEqual([{ name: 'deploy', description: '部署这个夹具' }])
    source.dispose()
  })

  it('never takes a row title from the wire', async () => {
    // The wire carries no title: a name is an identifier the user types and
    // matches against upstream documentation. A row that somehow arrives with
    // one — an older server, or the field re-added without that context — must
    // still leave the host's own title alone.
    const host = { name: 'deploy', description: 'Deploy the fixture', label: 'Deploy' }
    const service = commandService([host])
    const source = createMenuRowFaces({
      commandUi: service,
      inputTriggers: undefined,
      load: async () => [{ source: 'commands', name: 'deploy', label: '部署', description: '部署这个夹具' } as unknown as MenuRowFaceWire]
    })
    await source.refresh()
    expect(await service.candidates()).toEqual([{ name: 'deploy', description: '部署这个夹具', label: 'Deploy' }])
    source.dispose()
  })

  it('leaves a row the host sent nothing for exactly as it was', async () => {
    const host = { name: 'deploy', description: 'Deploy the fixture' }
    const other = { name: 'compact', description: 'Compact' }
    const service = commandService([host, other])
    const source = createMenuRowFaces({
      commandUi: service,
      inputTriggers: undefined,
      // A description-only face: the label stays the host's, and the untouched
      // row is the same object.
      load: async () => [{ source: 'commands', name: 'deploy', description: '部署这个夹具' }]
    })
    await source.refresh()
    const rows = await service.candidates()
    expect(rows[0]).toEqual({ name: 'deploy', description: '部署这个夹具' })
    expect(rows[1]).toBe(other)
    source.dispose()
  })

  it('drops to the host text when the read fails', async () => {
    const host = { name: 'deploy', description: 'Deploy the fixture' }
    const rows = [host]
    const service = commandService(rows)
    const onError = vi.fn()
    const source = createMenuRowFaces({
      commandUi: service,
      inputTriggers: undefined,
      load: async () => {
        throw new Error('market routes are not mounted')
      },
      onError
    })
    await expect(source.refresh()).resolves.toBeUndefined()
    expect(await service.candidates()).toBe(rows)
    expect(onError).toHaveBeenCalledTimes(1)
    source.dispose()
  })

  it('keeps the faces it already had when a later read fails', async () => {
    const host = { name: 'deploy', description: 'Deploy the fixture' }
    const service = commandService([host])
    let fail = false
    const source = createMenuRowFaces({
      commandUi: service,
      inputTriggers: undefined,
      load: async () => {
        if (fail) throw new Error('host went away')
        return [{ source: 'commands', name: 'deploy', description: '部署这个夹具' }]
      },
      onError: () => {}
    })
    await source.refresh()
    fail = true
    await source.refresh()
    expect(await service.candidates()).toEqual([{ name: 'deploy', description: '部署这个夹具' }])
    source.dispose()
  })

  it('reports a failing read once, however often the menu re-reads', async () => {
    const service = commandService([{ name: 'deploy', description: 'Deploy' }])
    const onError = vi.fn()
    const source = createMenuRowFaces({
      commandUi: service,
      inputTriggers: undefined,
      load: async () => {
        throw new Error('down')
      },
      onError
    })
    await source.refresh()
    await source.refresh()
    expect(onError).toHaveBeenCalledTimes(1)
    source.dispose()
  })

  it('unwraps the menu on dispose', async () => {
    const rows = [{ name: 'deploy', description: 'Deploy the fixture' }]
    const service = commandService(rows)
    const source = createMenuRowFaces({
      commandUi: service,
      inputTriggers: undefined,
      load: async () => [{ source: 'commands', name: 'deploy', description: '部署这个夹具' }]
    })
    await source.refresh()
    source.dispose()
    expect(await service.candidates()).toBe(rows)
  })

  it('leaves the menu unwrapped while a slow read is still in flight', async () => {
    const rows = [{ name: 'deploy', description: 'Deploy the fixture' }]
    const service = commandService(rows)
    let release: (() => void) | undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const source = createMenuRowFaces({
      commandUi: service,
      inputTriggers: undefined,
      load: async () => {
        await gate
        return [{ source: 'commands', name: 'deploy', description: '部署这个夹具' }]
      }
    })
    const pending = source.refresh()
    // Nothing has been read yet, so the menu is already on the host's own text;
    // a menu read at this moment sees no face rather than a stale one.
    expect(await service.candidates()).toBe(rows)
    source.dispose()
    release?.()
    await pending
    expect(await service.candidates()).toBe(rows)
  })

  it('installs nothing when the command service is missing', async () => {
    const source = createMenuRowFaces({
      commandUi: undefined,
      inputTriggers: undefined,
      load: async () => [{ source: 'commands', name: 'deploy', description: '部署这个夹具' }]
    })
    await expect(source.refresh()).resolves.toBeUndefined()
    source.dispose()
  })
})
