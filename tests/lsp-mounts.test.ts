import { describe, expect, it, vi } from 'vitest'
import { LspMountRegistry, toLspServerConfig, type LspStdioServerConfig } from '../src/runtime/lsp-mounts.js'
import type { Suite } from '../src/model/types.js'

/** A suite carrying one inline typescript server. */
function lspSuite(id: string, lsp = true, active = true): Suite {
  return {
    sourceId: 'src',
    id,
    root: `/tmp/${id}`,
    manifest: { layout: 'claude-code', path: '', id, name: id },
    skills: [],
    ...(lsp
      ? {
          lsp: {
            servers: {
              typescript: {
                key: 'typescript',
                command: 'typescript-language-server',
                args: ['--stdio'],
                extensionToLanguage: { '.ts': 'typescript' }
              }
            }
          }
        }
      : {}),
    surfaces: { skills: 0, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: lsp ? 1 : 0 },
    dimension: 'user',
    enabled: true,
    ...(active ? {} : { activeSurfaces: { skills: true, mcp: true, hooks: true, commands: true, agents: true, lsp: false } }),
    errors: []
  }
}

interface MountedConfig {
  servers: Record<string, LspStdioServerConfig>
}

/** Build a host loader whose plugin function behaves as directed. */
function hostLoader(behavior: 'ok' | 'fail-startup' | 'conflict' | 'missing', mounted: MountedConfig[] = []) {
  return async (): Promise<unknown> => {
    if (behavior === 'missing') return undefined
    return {
      default: function apply(_ctx: unknown, config: MountedConfig): void {
        if (behavior === 'fail-startup') throw new Error('executable not found: typescript-language-server')
        if (behavior === 'conflict') throw new Error('extension ".ts" is already handled by another LSP provider')
        mounted.push(config)
      }
    }
  }
}

function mountCtx(handleBehavior: 'ok' | 'await-rejects', applyThrows = false): { ctx: unknown; disposed: () => boolean } {
  let disposed = false
  const ctx = {
    logger: { warn: () => {} },
    plugin(plugin: unknown, config: MountedConfig) {
      // cordis mounts call the plugin function; the stub mirrors that.
      if (applyThrows) (plugin as (ctx: unknown, config: MountedConfig) => void)({}, config)
      return {
        await(): Promise<void> {
          return handleBehavior === 'await-rejects' ? Promise.reject(new Error('startup failed')) : Promise.resolve()
        },
        dispose(): void {
          disposed = true
        }
      }
    }
  }
  return { ctx, disposed: () => disposed }
}

describe('LspMountRegistry', () => {
  it('mounts each suite as one dsh-lsp-stdio instance with derived provider keys', async () => {
    const mounted: MountedConfig[] = []
    const { ctx } = mountCtx('ok', true)
    const registry = new LspMountRegistry(ctx as never, hostLoader('ok', mounted))
    const diagnostics = await registry.reconcile([lspSuite('ts'), lspSuite('plain', false), lspSuite('off', true, false)])
    expect(diagnostics).toEqual([])
    expect(mounted).toHaveLength(1)
    expect(Object.keys(mounted[0]!.servers)).toEqual(['src/ts/typescript'])
    expect(mounted[0]!.servers['src/ts/typescript']).toMatchObject({ command: 'typescript-language-server', args: ['--stdio'], extensionToLanguage: { '.ts': 'typescript' } })
    // Unmounts when the suite disappears between passes.
    await registry.reconcile([])
    await expect(registry.disposeAll()).resolves.toBeUndefined()
  })

  it('reports host-missing without scheduling retries when the package is absent', async () => {
    vi.useFakeTimers()
    try {
      const { ctx } = mountCtx('ok')
      const registry = new LspMountRegistry(ctx as never, hostLoader('missing'))
      const first = await registry.reconcile([lspSuite('ts')])
      expect(first).toHaveLength(1)
      expect(first[0]).toMatchObject({ suiteId: 'ts', code: 'host-missing' })
      // Later passes keep reporting honestly (a missing package is a state,
      // not a transient error), and no retry timer fires.
      const second = await registry.reconcile([lspSuite('ts')])
      expect(second).toHaveLength(1)
      expect(second[0]!.code).toBe('host-missing')
      await vi.advanceTimersByTimeAsync(200_000)
      await expect(registry.disposeAll()).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('classifies seam conflicts and retries plain mount failures', async () => {
    vi.useFakeTimers()
    try {
      const { ctx } = mountCtx('ok', true)
      const conflictRegistry = new LspMountRegistry(ctx as never, hostLoader('conflict'))
      const conflicts = await conflictRegistry.reconcile([lspSuite('a'), lspSuite('b')])
      expect(conflicts).toHaveLength(2)
      expect(conflicts.every(diagnostic => diagnostic.code === 'seam-conflict')).toBe(true)
      await conflictRegistry.disposeAll()

      const retries: number[] = []
      const failRegistry = new LspMountRegistry(ctx as never, hostLoader('fail-startup'))
      const failures = await failRegistry.reconcile([lspSuite('ts')])
      expect(failures[0]!.code).toBe('mount-failed')
      // The bounded retry schedule re-runs reconcile; intercept through the
      // public surface by observing subsequent diagnostics after advancing.
      const retryPass = vi.spyOn(failRegistry, 'reconcile')
      await vi.advanceTimersByTimeAsync(200_000)
      expect(retryPass).toHaveBeenCalled()
      retries.push(retryPass.mock.calls.length)
      await failRegistry.disposeAll()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a half-mounted handle whose startup rejected', async () => {
    const { ctx, disposed } = mountCtx('await-rejects')
    const registry = new LspMountRegistry(ctx as never, hostLoader('ok'))
    const diagnostics = await registry.reconcile([lspSuite('ts')])
    expect(diagnostics[0]!.code).toBe('mount-failed')
    expect(disposed()).toBe(true)
    await expect(registry.disposeAll()).resolves.toBeUndefined()
  })

  it('skips lsp-disabled and declaration-less suites entirely', async () => {
    const mounted: MountedConfig[] = []
    const { ctx } = mountCtx('ok')
    const registry = new LspMountRegistry(ctx as never, hostLoader('ok', mounted))
    const diagnostics = await registry.reconcile([lspSuite('plain', false), lspSuite('off', true, false)])
    expect(diagnostics).toEqual([])
    expect(mounted).toHaveLength(0)
  })
})

describe('toLspServerConfig', () => {
  it('maps a normalized spec onto the dsh-lsp-stdio server config', () => {
    expect(
      toLspServerConfig({
        command: 'clangd',
        args: ['--background-index'],
        extensionToLanguage: { '.c': 'c' },
        env: { RUST_LOG: 'warn' },
        initializationOptions: { a: 1 }
      })
    ).toEqual({
      command: 'clangd',
      args: ['--background-index'],
      extensionToLanguage: { '.c': 'c' },
      env: { RUST_LOG: 'warn' },
      initializationOptions: { a: 1 }
    })
    expect(toLspServerConfig({ command: 'gopls', args: [], extensionToLanguage: { '.go': 'go' } })).toEqual({
      command: 'gopls',
      args: [],
      extensionToLanguage: { '.go': 'go' }
    })
  })
})
