import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'
import { RuntimeReconciler } from '../src/runtime/reconciler.js'

interface RegisteredTool {
  name: string
}

/** Plugin context stub that resolves the settings namespace and an optional tools registry. */
function createContext(options: {
  state: { mcpEnhanced: boolean; feedbackEnabled: boolean; downloadRegion: string }
  tools?: { register: (definition: RegisteredTool) => () => void }
  watchers: Array<() => void>
  logs: Array<{ level: string; message: string }>
  cleanups: Array<() => void>
}) {
  const scope = {
    get: () => options.state,
    watch: (watcher: () => void) => {
      options.watchers.push(watcher)
      return () => {}
    },
    update: async () => {}
  }
  return {
    // The plugin context exposes the tools service directly, like the host's
    // service proxy does; `inject` only defers the callback that consumes it.
    ...(options.tools === undefined ? {} : { tools: options.tools }),
    inject: (services: string[], callback: (value: unknown) => void) => {
      if (services.includes('settings')) callback({ settings: { register: () => scope } })
      if (services.length === 1 && services.includes('tools') && options.tools !== undefined) callback({ tools: options.tools })
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

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('dsh-agent-plugins-market host entry', () => {
  it('does not register a redundant agent_plugins model tool', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-apply-'))
    vi.stubEnv('DSH_HOME', root)
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
      effect: (effect: () => () => void) => cleanups.push(effect()),
      logger: { warn: () => {} }
    }

    await apply(context as never)

    expect(registrations.map(tool => tool.name)).not.toContain('agent_plugins')
    // Dispose the instance: a live plugin keeps reconciling and would leak
    // calls into the next test's RuntimeReconciler spy.
    cleanups.forEach(cleanup => cleanup())
  })

  it('ignores unrelated settings changes and coalesces backend updates during startup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-apply-'))
    vi.stubEnv('DSH_HOME', root)
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
    const context = {
      inject: (services: string[], callback: (value: unknown) => void) => {
        if (services.includes('settings')) {
          callback({
            settings: {
              register: () => ({
                get: () => state,
                watch: (watcher: () => void) => {
                  watchers.push(watcher)
                  return () => {}
                }
              })
            }
          })
        }
      },
      skills: { registerProvider: () => {} },
      effect: (effect: () => () => void) => cleanups.push(effect()),
      logger: { warn: () => {} }
    }
    await apply(context as never)
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

    await apply(context as never)

    expect(registrations.map(tool => tool.name)).toContain('report_market_issue')
    expect(logs).toContainEqual({ level: 'info', message: expect.stringContaining('report_market_issue mounted') })
    // An unrelated settings change must not re-log the same state.
    watchers.forEach(watcher => watcher())
    expect(logs.filter(entry => entry.message.includes('report_market_issue'))).toHaveLength(1)

    state.feedbackEnabled = false
    watchers.forEach(watcher => watcher())
    expect(logs).toContainEqual({ level: 'info', message: expect.stringContaining('not mounted: feedbackEnabled is off') })
    cleanups.forEach(cleanup => cleanup())
  })

  it('logs report_market_issue staying unmounted when the host has no tools registry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-apply-'))
    vi.stubEnv('DSH_HOME', root)
    const logs: Array<{ level: string; message: string }> = []
    const watchers: Array<() => void> = []
    const cleanups: Array<() => void> = []
    const context = createContext({
      state: { mcpEnhanced: true, feedbackEnabled: true, downloadRegion: 'auto' },
      watchers,
      logs,
      cleanups
    })

    await apply(context as never)

    expect(logs).toContainEqual({ level: 'warn', message: expect.stringContaining('not mounted: the host exposes no tools registry') })
    watchers.forEach(watcher => watcher())
    expect(logs.filter(entry => entry.message.includes('report_market_issue'))).toHaveLength(1)
    cleanups.forEach(cleanup => cleanup())
  })
})
