import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../src/index.js'
import { RuntimeReconciler } from '../src/runtime/reconciler.js'

interface RegisteredTool {
  name: string
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
})
