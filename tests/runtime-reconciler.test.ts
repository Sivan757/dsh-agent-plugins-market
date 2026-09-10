import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeReconciler } from '../src/runtime/reconciler.js'
import { McpMountRegistry } from '../src/runtime/mcp-mounts.js'
import { CommandMountRegistry } from '../src/runtime/commands-mounts.js'
import { HooksMountRegistry } from '../src/runtime/hooks-mounts.js'
import { LspMountRegistry } from '../src/runtime/lsp-mounts.js'

afterEach(() => vi.restoreAllMocks())

describe('RuntimeReconciler', () => {
  it('fans an empty enabled snapshot through all surfaces and disposes cleanly', async () => {
    const context = { logger: { warn: () => {} } }
    const reconciler = new RuntimeReconciler(context as never, '/tmp/dsh-agent-plugins-runtime-data')

    await expect(reconciler.reconcile([])).resolves.toEqual({ mcp: [], commands: [], hooks: [], lsp: [], errors: [] })
    await expect(reconciler.dispose()).resolves.toBeUndefined()
  })

  it('allows local surfaces to reconcile while MCP startup is still pending', async () => {
    let releaseMcp!: () => void
    const pending = new Promise<void>(resolve => {
      releaseMcp = resolve
    })
    const mcp = vi.spyOn(McpMountRegistry.prototype, 'reconcile').mockImplementation(async () => {
      await pending
      return []
    })
    const commands = vi.spyOn(CommandMountRegistry.prototype, 'reconcile').mockResolvedValue([])
    const hooks = vi.spyOn(HooksMountRegistry.prototype, 'reconcile').mockResolvedValue([])
    const lsp = vi.spyOn(LspMountRegistry.prototype, 'reconcile').mockResolvedValue([])
    const reconciler = new RuntimeReconciler({} as never, '/tmp/dsh-agent-plugins-runtime-data')
    const first = reconciler.reconcile([])
    await vi.waitFor(() => expect(commands).toHaveBeenCalledTimes(1))
    expect(hooks).toHaveBeenCalledTimes(1)
    expect(lsp).toHaveBeenCalledTimes(1)

    const second = reconciler.reconcile([])
    await vi.waitFor(() => expect(commands).toHaveBeenCalledTimes(2))
    expect(mcp).toHaveBeenCalledTimes(1)
    releaseMcp()
    await Promise.all([first, second])
    expect(mcp).toHaveBeenCalledTimes(2)
    await reconciler.dispose()
  })

  it('contains surface failures and waits for in-flight work before disposing it', async () => {
    let releaseCommands!: () => void
    const pending = new Promise<void>(resolve => {
      releaseCommands = resolve
    })
    const commands = vi.spyOn(CommandMountRegistry.prototype, 'reconcile').mockImplementation(async () => {
      await pending
      return []
    })
    const disposeCommands = vi.spyOn(CommandMountRegistry.prototype, 'disposeAll')
    vi.spyOn(McpMountRegistry.prototype, 'reconcile').mockRejectedValue(new Error('offline'))
    vi.spyOn(HooksMountRegistry.prototype, 'reconcile').mockResolvedValue([])
    vi.spyOn(LspMountRegistry.prototype, 'reconcile').mockResolvedValue([])
    const reconciler = new RuntimeReconciler({} as never, '/tmp/dsh-agent-plugins-runtime-data')
    const first = reconciler.reconcile([])
    await vi.waitFor(() => expect(commands).toHaveBeenCalledTimes(1))
    const queued = reconciler.reconcile([])
    const disposed = reconciler.dispose()
    expect(disposeCommands).not.toHaveBeenCalled()
    releaseCommands()
    expect((await first).errors).toEqual([{ surface: 'mcp', reason: 'offline' }])
    await Promise.all([queued, disposed])
    expect(disposeCommands).toHaveBeenCalledOnce()
    expect(commands).toHaveBeenCalledOnce()
    await reconciler.reconcile([])
    expect(commands).toHaveBeenCalledOnce()
  })
})
