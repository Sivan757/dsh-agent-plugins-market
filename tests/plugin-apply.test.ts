import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'
import { presetSourceRef } from '../src/model/preset-source.js'
import { RuntimeReconciler } from '../src/runtime/reconciler.js'

interface RegisteredTool {
  name: string
}

/** Plugin context stub carrying volatile setting references and an optional tools registry. */
function createContext(options: {
  state: { mcpEnhanced: boolean; feedbackEnabled: boolean; downloadRegion: string }
  tools?: { register: (definition: RegisteredTool) => () => void }
  watchers: Array<() => void>
  logs: Array<{ level: string; message: string }>
  cleanups: Array<() => void>
}) {
  return {
    // Services resolve through this lookup only: a real fiber that does not
    // inject `tools` throws on the property read, so hanging it here would make
    // this stub pass where the mounted plugin does not.
    get: (name: string) => (name === 'tools' ? options.tools : undefined),
    inject: (services: string[], callback: (value: unknown) => void) => {
      if (services.length === 1 && services.includes('tools') && options.tools !== undefined) callback({ tools: options.tools })
    },
    on: (event: string, watcher: () => void) => {
      if (event === 'loader/volatile-update') options.watchers.push(watcher)
      return () => {}
    },
    skills: { registerProvider: () => {} },
    effect: (effect: () => () => void) => options.cleanups.push(effect()),
    logger: {
      info: (message: string) => options.logs.push({ level: 'info', message }),
      warn: (message: string) => options.logs.push({ level: 'warn', message }),
      error: (message: string) => options.logs.push({ level: 'error', message })
    }
  }
}

/** The apply() config carrying volatile setting references over the mutable test state. */
function configOf(options: { state: { mcpEnhanced: boolean; feedbackEnabled: boolean; downloadRegion: string } }): never {
  return {
    mcpEnhanced: { get: () => options.state.mcpEnhanced },
    scanProjectLayouts: { get: () => true },
    downloadRegion: { get: () => options.state.downloadRegion },
    feedbackEnabled: { get: () => options.state.feedbackEnabled },
    autoUpdateSources: { get: () => false }
  } as never
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('dsh-agent-plugins-market host entry', () => {
  it('does not register a redundant agent_plugins model tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-apply-'))
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('DSH_AGENTS_HOME', join(root, 'agents'))
    const registrations: RegisteredTool[] = []
    const cleanups: Array<() => void> = []
    const tools = {
      register: (definition: RegisteredTool) => {
        registrations.push(definition)
        return () => {}
      }
    }
    const context = {
      inject: (services: string[], callback: (value: unknown) => void) => {
        if (services.length === 1 && services.includes('tools')) callback({ tools })
        if (services.includes('webServer')) callback({ effect: () => {} })
      },
      skills: {
        registerProvider: (create: (control: { signal: AbortSignal; invalidate: () => void }) => unknown) => {
          create({ signal: new AbortController().signal, invalidate: () => {} })
          return () => {}
        }
      },
      on: () => () => {},
      effect: (effect: () => () => void) => cleanups.push(effect()),
      // No service resolves here, so the timer seat takes its plain-handle fallback.
      get: () => undefined,
      logger: { warn: () => {} }
    }

    await apply(context as never, configOf({ state: { mcpEnhanced: true, feedbackEnabled: true, downloadRegion: 'auto' } }))

    expect(registrations.map(tool => tool.name)).not.toContain('agent_plugins')
    // Activation presets the first-party source record so the market lists it
    // on the first open; nothing here clones it.
    const state = JSON.parse(await readFile(join(root, 'agent-plugins', 'state.json'), 'utf8')) as { sources: Array<{ id: string; url: string; kind?: string }> }
    expect(state.sources).toEqual([presetSourceRef()])
    // Dispose the instance: a live plugin keeps reconciling and would leak
    // calls into the next test's RuntimeReconciler spy.
    cleanups.forEach(cleanup => cleanup())
  })

  it('ignores unrelated settings changes and coalesces backend updates during startup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-apply-'))
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('DSH_AGENTS_HOME', join(root, 'agents'))
    let release!: () => void
    const pending = new Promise<void>(resolve => {
      release = resolve
    })
    const reconcile = vi.spyOn(RuntimeReconciler.prototype, 'reconcile').mockImplementation(async () => {
      await pending
      return { mcp: [], commands: [], hooks: [], lsp: [], errors: [] }
    })
    const watchers: Array<() => void> = []
    const state = { mcpEnhanced: true, feedbackEnabled: false, downloadRegion: 'auto' }
    const cleanups: Array<() => void> = []
    const context = createContext({ state, watchers, logs: [], cleanups })
    await apply(context as never, configOf({ state }))
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledOnce())
    state.downloadRegion = 'china'
    watchers.forEach(watcher => watcher())
    await Promise.resolve()
    expect(reconcile).toHaveBeenCalledOnce()

    for (const enabled of [false, true, false]) {
      state.mcpEnhanced = enabled
      watchers.forEach(watcher => watcher())
    }
    release()
    await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(2))
    cleanups.forEach(cleanup => cleanup())
    state.mcpEnhanced = true
    watchers.forEach(watcher => watcher())
    await Promise.resolve()
    expect(reconcile).toHaveBeenCalledTimes(2)
  })

  it('logs report_market_issue mounting and unregistering across the switch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-apply-'))
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('DSH_AGENTS_HOME', join(root, 'agents'))
    const state = { mcpEnhanced: true, feedbackEnabled: true, downloadRegion: 'auto' }
    const registrations: RegisteredTool[] = []
    const logs: Array<{ level: string; message: string }> = []
    const watchers: Array<() => void> = []
    const cleanups: Array<() => void> = []
    const context = createContext({
      state,
      tools: {
        register: (definition: RegisteredTool) => {
          registrations.push(definition)
          return () => {}
        }
      },
      watchers,
      logs,
      cleanups
    })

    await apply(context as never, configOf({ state }))

    expect(registrations.map(tool => tool.name)).toContain('report_market_issue')
    const mounted: unknown = expect.stringContaining('report_market_issue mounted')
    expect(logs).toContainEqual({ level: 'info', message: mounted })
    // An unrelated settings change must not re-log the same state.
    watchers.forEach(watcher => watcher())
    expect(logs.filter(entry => entry.message.includes('report_market_issue'))).toHaveLength(1)

    state.feedbackEnabled = false
    watchers.forEach(watcher => watcher())
    const off: unknown = expect.stringContaining('not mounted: feedbackEnabled is off')
    expect(logs).toContainEqual({ level: 'info', message: off })
    cleanups.forEach(cleanup => cleanup())
  })

  it('logs report_market_issue staying unmounted when the host has no tools registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-apply-'))
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('DSH_AGENTS_HOME', join(root, 'agents'))
    const logs: Array<{ level: string; message: string }> = []
    const watchers: Array<() => void> = []
    const cleanups: Array<() => void> = []
    const state = { mcpEnhanced: true, feedbackEnabled: true, downloadRegion: 'auto' }
    const context = createContext({
      state,
      watchers,
      logs,
      cleanups
    })

    await apply(context as never, configOf({ state }))

    const missingRegistry: unknown = expect.stringContaining('not mounted: the host exposes no tools registry')
    expect(logs).toContainEqual({ level: 'warn', message: missingRegistry })
    watchers.forEach(watcher => watcher())
    expect(logs.filter(entry => entry.message.includes('report_market_issue'))).toHaveLength(1)
    cleanups.forEach(cleanup => cleanup())
  })
})
