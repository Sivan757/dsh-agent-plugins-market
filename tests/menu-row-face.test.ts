/**
 * The `/` menu row-face seam: which rows it touches, what a missing Host seam
 * falls back to, and what it refuses to disturb.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installMenuRowFace, type MenuRowFace, type MenuRowSource } from '../packages/market-ui/src/ui/menu-row-face.js'

/** Read one row without narrowing it: the rows under test include junk entries. */
function rowAt(rows: unknown, index: number): unknown {
  if (!Array.isArray(rows)) throw new Error(`expected rows, read ${typeof rows}`)
  if (index >= rows.length) throw new Error(`row ${index} missing from ${rows.length}`)
  return rows[index]
}

/** A Host command service whose `candidates` lives on the prototype, as the real service's does. */
function commandService(rows: () => unknown) {
  const proto = {
    async candidates(): Promise<unknown> {
      return rows()
    }
  }
  return Object.create(proto) as { candidates: () => Promise<unknown> }
}

/** A `/` source owned by another client plugin; the skill group's shape. */
function triggerSource(name: string, rows: () => unknown) {
  return {
    trigger: '/',
    name,
    order: 2,
    async candidates(this: void): Promise<unknown> {
      return rows()
    }
  }
}

/** The `ctx.inputTriggers` roster, exposing the live list the real service keeps. */
function rosterService(sources: unknown[] = []) {
  const live = { sources: [...sources], controllers: new Map() }
  return {
    live,
    registerSource(this: void, source: unknown): () => void {
      live.sources.push(source)
      return () => {
        const at = live.sources.indexOf(source)
        if (at >= 0) live.sources.splice(at, 1)
      }
    }
  }
}

/** Face one command row by name; every other name is left alone. */
function commandsFaceOf(faces: Record<string, MenuRowFace | undefined>) {
  return (source: MenuRowSource, name: string): MenuRowFace | undefined => (source === 'commands' ? faces[name] : undefined)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the command group face', () => {
  it('faces only the rows the resolver claims', async () => {
    const host = { name: 'compact', description: 'Host compaction description' }
    const ours = { name: 'git-review', description: 'Review changes' }
    const service = commandService(() => [host, ours])
    const dispose = installMenuRowFace({
      commandUi: service,
      inputTriggers: undefined,
      faceOf: commandsFaceOf({ 'git-review': { label: '代码评审', description: '审查改动' } })
    })
    const rows = await service.candidates()
    expect(rowAt(rows, 0)).toBe(host)
    expect(rowAt(rows, 1)).toEqual({ name: 'git-review', description: '审查改动', label: '代码评审' })
    dispose()
  })

  it('keeps every identity field of a faced row', async () => {
    const icon = (): unknown => undefined
    const ours = { name: 'shared', description: 'Original', label: 'Original label', hint: 'run', icon, section: 'Market', value: 'shared' }
    const service = commandService(() => [ours])
    const dispose = installMenuRowFace({
      commandUi: service,
      inputTriggers: undefined,
      faceOf: commandsFaceOf({ shared: { label: '共享', description: '译文描述' } })
    })
    const [row] = (await service.candidates()) as Array<Record<string, unknown>>
    expect(row).toMatchObject({ name: 'shared', label: '共享', description: '译文描述', hint: 'run', section: 'Market', value: 'shared' })
    expect(row?.['icon']).toBe(icon)
    dispose()
  })

  it('keeps the host text for a field the face omits', async () => {
    const host = { name: 'mine', description: 'Host description' }
    const service = commandService(() => [host])
    const dispose = installMenuRowFace({ commandUi: service, inputTriggers: undefined, faceOf: commandsFaceOf({ mine: { label: '我的' } }) })
    expect(await service.candidates()).toEqual([{ name: 'mine', description: 'Host description', label: '我的' }])
    dispose()
  })

  it('returns the host array itself when no row changes', async () => {
    const rows = [
      { name: 'compact', description: 'Host' },
      { name: 'other', description: 'Host' }
    ]
    const service = commandService(() => rows)
    const faceOf = vi.fn(commandsFaceOf({}))
    const dispose = installMenuRowFace({ commandUi: service, inputTriggers: undefined, faceOf })
    expect(await service.candidates()).toBe(rows)
    expect(faceOf).toHaveBeenCalledTimes(2)
    dispose()
  })

  it('treats a blank override as absent', async () => {
    const host = { name: 'mine', description: 'Host description' }
    const rows = [host]
    const service = commandService(() => rows)
    const dispose = installMenuRowFace({ commandUi: service, inputTriggers: undefined, faceOf: commandsFaceOf({ mine: { label: '   ', description: '' } }) })
    expect(await service.candidates()).toBe(rows)
    dispose()
  })

  it('returns the host row when the face repeats what the host already shows', async () => {
    const host = { name: 'mine', description: 'Host description', label: '我的' }
    const service = commandService(() => [host])
    const dispose = installMenuRowFace({
      commandUi: service,
      inputTriggers: undefined,
      faceOf: commandsFaceOf({ mine: { label: '我的', description: 'Host description' } })
    })
    expect(rowAt(await service.candidates(), 0)).toBe(host)
    dispose()
  })

  it('rewrites only the changed field, keeping the other by value', async () => {
    const host = { name: 'mine', description: 'Host description', label: '我的' }
    const service = commandService(() => [host])
    const dispose = installMenuRowFace({ commandUi: service, inputTriggers: undefined, faceOf: commandsFaceOf({ mine: { description: '译文描述' } }) })
    expect(await service.candidates()).toEqual([{ name: 'mine', description: '译文描述', label: '我的' }])
    dispose()
  })

  it('leaves rows without a usable name alone', async () => {
    const nameless = { description: 'no name' }
    const empty = { name: '', description: 'empty name' }
    const rows = [nameless, empty, null, 'junk', 7]
    const service = commandService(() => rows)
    const faceOf = vi.fn(commandsFaceOf({}))
    const dispose = installMenuRowFace({ commandUi: service, inputTriggers: undefined, faceOf })
    expect(await service.candidates()).toBe(rows)
    expect(faceOf).not.toHaveBeenCalled()
    dispose()
  })

  it('passes a non-array result straight through', async () => {
    const service = commandService(() => undefined)
    const dispose = installMenuRowFace({ commandUi: service, inputTriggers: undefined, faceOf: commandsFaceOf({ mine: { label: '我的' } }) })
    expect(await service.candidates()).toBeUndefined()
    dispose()
  })

  it('propagates a rejection raised by the host itself', async () => {
    const failure = new Error('command catalog requires a retained session')
    const service = commandService(() => {
      throw failure
    })
    const faceOf = vi.fn(commandsFaceOf({}))
    const dispose = installMenuRowFace({ commandUi: service, inputTriggers: undefined, faceOf })
    await expect(service.candidates()).rejects.toThrow(failure)
    expect(faceOf).not.toHaveBeenCalled()
    dispose()
  })
})

describe('the skill group face', () => {
  it('faces a source already on the roster', async () => {
    const source = triggerSource('skill', () => [{ name: 'review', description: 'Review code' }])
    const roster = rosterService([source])
    const dispose = installMenuRowFace({
      commandUi: undefined,
      inputTriggers: roster,
      faceOf: (group, name) => (group === 'skills' && name === 'review' ? { label: '代码评审', description: '审查代码' } : undefined)
    })
    expect(await source.candidates()).toEqual([{ name: 'review', description: '审查代码', label: '代码评审' }])
    dispose()
  })

  it('faces a source that registers after the plugin', async () => {
    const roster = rosterService()
    const dispose = installMenuRowFace({
      commandUi: undefined,
      inputTriggers: roster,
      faceOf: (group, name) => (group === 'skills' && name === 'review' ? { label: '代码评审' } : undefined)
    })
    const late = triggerSource('skill', () => [{ name: 'review', description: 'Review code' }])
    roster.registerSource(late)
    expect(await late.candidates()).toEqual([{ name: 'review', description: 'Review code', label: '代码评审' }])
    dispose()
  })

  it("does not touch another plugin's source", async () => {
    const other = triggerSource('file', () => [{ name: 'readme', description: 'Read me' }])
    const roster = rosterService([other])
    const original = other.candidates
    const dispose = installMenuRowFace({
      commandUi: undefined,
      inputTriggers: roster,
      faceOf: (group, name) => (group === 'skills' && name === 'readme' ? { label: '说明' } : undefined)
    })
    expect(other.candidates).toBe(original)
    expect(await other.candidates()).toEqual([{ name: 'readme', description: 'Read me' }])
    dispose()
  })

  it('stops facing a source that registers after teardown', async () => {
    const roster = rosterService()
    const original = roster.registerSource
    const dispose = installMenuRowFace({
      commandUi: undefined,
      inputTriggers: roster,
      faceOf: (group, name) => (group === 'skills' && name === 'review' ? { label: '代码评审' } : undefined)
    })
    expect(roster.registerSource).not.toBe(original)
    dispose()
    expect(roster.registerSource).toBe(original)
    const late = triggerSource('skill', () => [{ name: 'review', description: 'Review code' }])
    roster.registerSource(late)
    expect(await late.candidates()).toEqual([{ name: 'review', description: 'Review code' }])
  })
})

describe('the seams this plugin cannot reach', () => {
  it('installs nothing without a command service, and still faces the roster', async () => {
    const source = triggerSource('skill', () => [{ name: 'review', description: 'Review code' }])
    const roster = rosterService([source])
    const faceOf = vi.fn((group: MenuRowSource, name: string) => (group === 'skills' && name === 'review' ? { label: '代码评审' } : undefined))
    const dispose = installMenuRowFace({ commandUi: undefined, inputTriggers: roster, faceOf })
    expect(await source.candidates()).toEqual([{ name: 'review', description: 'Review code', label: '代码评审' }])
    dispose()
  })

  it('leaves a service without candidates untouched', () => {
    const service = { directory: {} }
    const dispose = installMenuRowFace({ commandUi: service, inputTriggers: undefined, faceOf: commandsFaceOf({ mine: { label: '我的' } }) })
    expect(service).toEqual({ directory: {} })
    dispose()
  })

  it('leaves a candidates that is not a function untouched', async () => {
    const service = { candidates: 'not a function' }
    const dispose = installMenuRowFace({ commandUi: service, inputTriggers: undefined, faceOf: commandsFaceOf({ mine: { label: '我的' } }) })
    expect(service.candidates).toBe('not a function')
    dispose()
  })

  it('leaves a null service untouched', () => {
    const dispose = installMenuRowFace({ commandUi: null, inputTriggers: null, faceOf: commandsFaceOf({ mine: { label: '我的' } }) })
    expect(typeof dispose).toBe('function')
    dispose()
  })
})

describe('uninstalling', () => {
  it('restores a prototype method through the prototype', async () => {
    const rows = [{ name: 'mine', description: 'Host' }]
    const service = commandService(() => rows)
    const original = service.candidates
    const dispose = installMenuRowFace({ commandUi: service, inputTriggers: undefined, faceOf: commandsFaceOf({ mine: { label: '我的' } }) })
    expect(Object.prototype.hasOwnProperty.call(service, 'candidates')).toBe(true)
    dispose()
    expect(Object.prototype.hasOwnProperty.call(service, 'candidates')).toBe(false)
    // The prototype method was never rewritten: reads fall back through it.
    const proto = Object.getPrototypeOf(service) as { candidates: () => Promise<unknown> }
    expect(proto.candidates).toBe(original)
    expect(await service.candidates()).toBe(rows)
  })

  it('leaves a wrapper installed after it in place', async () => {
    const service = commandService(() => [{ name: 'mine', description: 'Host' }])
    const dispose = installMenuRowFace({ commandUi: service, inputTriggers: undefined, faceOf: commandsFaceOf({ mine: { label: '我的' } }) })
    const later = async (): Promise<unknown> => 'later'
    service.candidates = later
    dispose()
    expect(service.candidates).toBe(later)
  })

  it('wraps once when installed twice', async () => {
    const host = { name: 'mine', description: 'Host' }
    const service = commandService(() => [host])
    const faceOf = vi.fn(commandsFaceOf({ mine: { label: '我的' } }))
    const first = installMenuRowFace({ commandUi: service, inputTriggers: undefined, faceOf })
    const second = installMenuRowFace({ commandUi: service, inputTriggers: undefined, faceOf })
    expect(await service.candidates()).toEqual([{ name: 'mine', description: 'Host', label: '我的' }])
    expect(faceOf).toHaveBeenCalledTimes(1)
    // Both handles own the one wrapper; unwrapping through either restores the Host rows.
    first()
    expect(rowAt(await service.candidates(), 0)).toBe(host)
    second()
    expect(rowAt(await service.candidates(), 0)).toBe(host)
  })

  it('also unwraps a source the roster handed over while watching', async () => {
    const source = triggerSource('skill', () => [{ name: 'review', description: 'Review code' }])
    const roster = rosterService()
    const dispose = installMenuRowFace({
      commandUi: undefined,
      inputTriggers: roster,
      faceOf: (group, name) => (group === 'skills' && name === 'review' ? { label: '代码评审' } : undefined)
    })
    roster.registerSource(source)
    expect(await source.candidates()).toEqual([{ name: 'review', description: 'Review code', label: '代码评审' }])
    dispose()
    expect(await source.candidates()).toEqual([{ name: 'review', description: 'Review code' }])
  })
})

describe('a failure inside this layer', () => {
  /** A fresh module instance per test: the once-only report flag is module state. */
  async function freshInstall() {
    vi.resetModules()
    const module = await import('../packages/market-ui/src/ui/menu-row-face.js')
    return module.installMenuRowFace
  }

  it('falls back to the host rows and reports once', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const install = await freshInstall()
    const rows = [{ name: 'mine', description: 'Host' }]
    const service = commandService(() => rows)
    const dispose = install({
      commandUi: service,
      inputTriggers: undefined,
      faceOf: () => {
        throw new Error('resolver exploded')
      }
    })
    expect(await service.candidates()).toBe(rows)
    expect(await service.candidates()).toBe(rows)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0]?.[0]).toContain('[dsh-agent-plugins-market] menu row face failed:')
    dispose()
  })

  it('never lets a throw reach the roster while watching registrations', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const install = await freshInstall()
    const roster = rosterService()
    const dispose = install({ commandUi: undefined, inputTriggers: roster, faceOf: undefined as never })
    const late = triggerSource('skill', () => [{ name: 'review', description: 'Review code' }])
    expect(() => roster.registerSource(late)).not.toThrow()
    expect(await late.candidates()).toEqual([{ name: 'review', description: 'Review code' }])
    expect(error).toHaveBeenCalledTimes(1)
    dispose()
  })
})
