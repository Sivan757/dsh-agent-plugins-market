import { describe, expect, it, vi } from 'vitest'
import { LspMountRegistry, toLspServerConfig, type LspStdioServerConfig } from '../src/runtime/lsp-mounts.js'
import type { Suite } from '../src/model/types.js'

/** A fixture value this suite requires: fails naming what was expected instead of reading `undefined` further on. */
function required<T>(value: T | undefined, expected: string): T {
  if (value === undefined) throw new Error(`expected ${expected}`)
  return value
}

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
    activeSurfaces: { skills: true, mcp: true, hooks: true, commands: true, agents: true, lsp: active },
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
    const apply = function apply(_ctx: unknown, config: MountedConfig): void {
      if (behavior === 'fail-startup') throw new Error('executable not found: typescript-language-server')
      if (behavior === 'conflict') throw new Error('extension ".ts" is already handled by another LSP provider')
      mounted.push(config)
    }
    return { default: Object.assign(apply, { label: 'lsp-stdio' }) }
  }
}

/**
 * A ctx for the stdio-mount cases. The capability seam is provisioned unconditionally, so the
 * builder wires two no-op loaders for it and the assertions stay about provider mounting.
 */
function mountCtx(
  handleBehavior: 'ok' | 'await-rejects' = 'ok',
  applyThrows = false
): { ctx: unknown; disposed: () => boolean; build: (loadHost: () => Promise<unknown>) => LspMountRegistry } {
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
  const capability = () => async () => ({ default: () => {} })
  return {
    ctx,
    disposed: () => disposed,
    build: (loadHost: () => Promise<unknown>) => new LspMountRegistry(ctx as never, loadHost as never, capability(), capability())
  }
}

interface MountRecord {
  label: string
  disposed: boolean
}

/** A loader for one named capability plugin, so mount order and teardown are assertable. */
function moduleLoader(label: string): () => Promise<{ default: { label: string } }> {
  return async () => ({ default: { label } })
}

/**
 * A ctx that records every plugin this registry mounts. Any service probe throws: the plugin
 * decides the version from its own dependency declaration, so reading what the profile carries
 * would be a bug rather than a shortcut.
 */
function provisionCtx(options: { failOn?: 'lsp-service' | 'lsp-tool'; message?: string } = {}): { ctx: unknown; mounts: MountRecord[] } {
  const mounts: MountRecord[] = []
  const ctx = {
    logger: { warn: () => {} },
    get(name: string): never {
      throw new Error(`the registry must not consult ctx.get(${name})`)
    },
    plugin(plugin: unknown) {
      const label = (plugin as { label?: string }).label ?? 'unknown'
      // A conflicting layer already owns the seam: cordis rejects the mount before it starts.
      if (options.failOn === label) throw new Error(options.message ?? `service "lsp" has been registered at <Lsp>`)
      const record: MountRecord = { label, disposed: false }
      mounts.push(record)
      return {
        await: async () => {},
        dispose(): void {
          record.disposed = true
        }
      }
    }
  }
  return { ctx, mounts }
}

/** Build a registry whose three host loaders are instrumented stubs. */
function provisionRegistry(ctx: unknown, mounted: MountedConfig[] = [], service: unknown = moduleLoader('lsp-service'), tool: unknown = moduleLoader('lsp-tool')) {
  return new LspMountRegistry(ctx as never, hostLoader('ok', mounted) as never, service as never, tool as never)
}

describe('LspMountRegistry', () => {
  it('replaces a live mount when the effective server configuration changes', async () => {
    const mounted: MountedConfig[] = []
    const { disposed, build } = mountCtx('ok', true)
    const registry = build(hostLoader('ok', mounted))
    const suite = lspSuite('ts')
    await registry.reconcile([suite])
    const lsp = required(suite.lsp, 'the ts fixture suite to declare lsp servers')
    const declared = required(lsp.servers['typescript'], 'a typescript server on the ts fixture suite')
    declared.command = 'replacement-language-server'
    await registry.reconcile([suite])
    expect(disposed()).toBe(true)
    expect(mounted).toHaveLength(2)
    const replacement = required(mounted[1], 'the replacement mount of the ts suite')
    const provider = required(replacement.servers['src/ts/typescript'], 'a src/ts/typescript provider on the replacement mount')
    expect(provider.command).toBe('replacement-language-server')
    await registry.reconcile([suite])
    expect(mounted).toHaveLength(2)
    await registry.disposeAll()
  })

  it('mounts each suite as one dsh-lsp-stdio instance with derived provider keys', async () => {
    const mounted: MountedConfig[] = []
    const { build } = mountCtx('ok', true)
    const registry = build(hostLoader('ok', mounted))
    const diagnostics = await registry.reconcile([lspSuite('ts'), lspSuite('plain', false), lspSuite('off', true, false)])
    expect(diagnostics).toEqual([])
    expect(mounted).toHaveLength(1)
    const mount = required(mounted[0], 'the ts suite to mount one provider')
    expect(Object.keys(mount.servers)).toEqual(['src/ts/typescript'])
    expect(mount.servers['src/ts/typescript']).toMatchObject({ command: 'typescript-language-server', args: ['--stdio'], extensionToLanguage: { '.ts': 'typescript' } })
    // Unmounts when the suite disappears between passes.
    await registry.reconcile([])
    await expect(registry.disposeAll()).resolves.toBeUndefined()
  })

  it('reports host-missing without scheduling retries when the package is absent', async () => {
    vi.useFakeTimers()
    try {
      const { build } = mountCtx()
      const registry = build(hostLoader('missing'))
      const first = await registry.reconcile([lspSuite('ts')])
      expect(first).toHaveLength(1)
      expect(first[0]).toMatchObject({ suiteId: 'src/ts', code: 'host-missing' })
      // Later passes keep reporting honestly (a missing package is a state,
      // not a transient error), and no retry timer fires.
      const second = await registry.reconcile([lspSuite('ts')])
      expect(second).toHaveLength(1)
      expect(required(second[0], 'the second pass to report one host-missing diagnostic').code).toBe('host-missing')
      await vi.advanceTimersByTimeAsync(200_000)
      await expect(registry.disposeAll()).resolves.toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips individually disabled servers and removes an existing mount', async () => {
    const mounted: MountedConfig[] = []
    const { build } = mountCtx('ok', true)
    const registry = build(hostLoader('ok', mounted))
    await registry.reconcile([lspSuite('ts')])
    expect(mounted).toHaveLength(1)
    registry.setDisabledProvider(async () => new Set(['src/ts/typescript']))
    await registry.reconcile([lspSuite('ts')])
    expect(mounted).toHaveLength(1)
    expect(registry.disabledServers()).toEqual(new Set(['src/ts/typescript']))
    await registry.disposeAll()
  })

  it('classifies seam conflicts and retries plain mount failures', async () => {
    vi.useFakeTimers()
    try {
      const { build } = mountCtx('ok', true)
      const conflictRegistry = build(hostLoader('conflict'))
      const conflicts = await conflictRegistry.reconcile([lspSuite('a'), lspSuite('b')])
      expect(conflicts).toHaveLength(2)
      expect(conflicts.every(diagnostic => diagnostic.code === 'seam-conflict')).toBe(true)
      await conflictRegistry.disposeAll()

      const failRegistry = build(hostLoader('fail-startup'))
      const failures = await failRegistry.reconcile([lspSuite('ts')])
      expect(required(failures[0], 'the failing startup to report one diagnostic').code).toBe('mount-failed')
      // The bounded retry schedule re-runs reconcile; intercept through the
      // public surface by observing subsequent diagnostics after advancing.
      const retryPass = vi.spyOn(failRegistry, 'reconcile')
      await vi.advanceTimersByTimeAsync(200_000)
      expect(retryPass).toHaveBeenCalled()
      await failRegistry.disposeAll()
    } finally {
      vi.useRealTimers()
    }
  })

  it('drops a half-mounted handle whose startup rejected', async () => {
    const { disposed, build } = mountCtx('await-rejects')
    const registry = build(hostLoader('ok'))
    const diagnostics = await registry.reconcile([lspSuite('ts')])
    expect(required(diagnostics[0], 'the rejected startup to report one diagnostic').code).toBe('mount-failed')
    expect(disposed()).toBe(true)
    await expect(registry.disposeAll()).resolves.toBeUndefined()
  })

  it('skips lsp-disabled and declaration-less suites entirely', async () => {
    const mounted: MountedConfig[] = []
    const { build } = mountCtx()
    const registry = build(hostLoader('ok', mounted))
    const diagnostics = await registry.reconcile([lspSuite('plain', false), lspSuite('off', true, false)])
    expect(diagnostics).toEqual([])
    expect(mounted).toHaveLength(0)
  })

  it('provisions the lsp seam and tool itself before the first provider', async () => {
    const mounted: MountedConfig[] = []
    const { ctx, mounts } = provisionCtx()
    const registry = provisionRegistry(ctx, mounted)
    expect(await registry.reconcile([lspSuite('ts')])).toEqual([])
    // The service precedes the tool (the tool injects `lsp`), and both precede the provider.
    expect(mounts.map(record => record.label)).toEqual(['lsp-service', 'lsp-tool', 'lsp-stdio'])
    // A second pass reuses the seam instead of stacking another copy.
    await registry.reconcile([lspSuite('ts2')])
    expect(mounts).toHaveLength(4)
    await registry.disposeAll()
  })

  it('never asks the profile what it already carries', async () => {
    // `provisionCtx` throws from `ctx.get`, so any probe fails this case rather than passing it.
    const { ctx, mounts } = provisionCtx()
    const registry = provisionRegistry(ctx)
    expect(await registry.reconcile([lspSuite('ts')])).toEqual([])
    expect(mounts.map(record => record.label)).toEqual(['lsp-service', 'lsp-tool', 'lsp-stdio'])
    await registry.disposeAll()
  })

  it('reports a seam conflict naming the layer to remove when the service is taken', async () => {
    const { ctx, mounts } = provisionCtx({ failOn: 'lsp-service' })
    const registry = provisionRegistry(ctx)
    const diagnostics = await registry.reconcile([lspSuite('ts')])
    expect(diagnostics).toHaveLength(1)
    const serviceConflict = required(diagnostics[0], 'the taken lsp service to report one conflict')
    expect(serviceConflict.code).toBe('seam-conflict')
    expect(serviceConflict.reason).toContain('remove that layer')
    // Nothing else was mounted: the provider cannot register without the seam it owns.
    expect(mounts).toEqual([])
    await registry.disposeAll()
  })

  it('reports a seam conflict when the lsp tool is taken', async () => {
    const { ctx, mounts } = provisionCtx({ failOn: 'lsp-tool', message: 'tool "lsp" is already registered in this scope' })
    const registry = provisionRegistry(ctx)
    const diagnostics = await registry.reconcile([lspSuite('ts')])
    expect(diagnostics).toHaveLength(1)
    const toolConflict = required(diagnostics[0], 'the taken lsp tool to report one conflict')
    expect(toolConflict.code).toBe('seam-conflict')
    expect(toolConflict.reason).toContain('remove that layer')
    // The service mounted before the tool conflicted and must be torn back down with it.
    expect(mounts.map(record => record.label)).toEqual(['lsp-service'])
    await registry.disposeAll()
    expect(mounts.every(record => record.disposed)).toBe(true)
  })

  it('releases the seam it mounted once the last provider is gone', async () => {
    const { ctx, mounts } = provisionCtx()
    const registry = provisionRegistry(ctx)
    await registry.reconcile([lspSuite('ts')])
    expect(mounts.every(record => !record.disposed)).toBe(true)
    // Disabling the last LSP suite must not leave the model-facing tool behind.
    await registry.reconcile([])
    expect(mounts.every(record => record.disposed)).toBe(true)
    await registry.reconcile([lspSuite('ts')])
    expect(mounts).toHaveLength(6)
    await registry.disposeAll()
    expect(mounts.every(record => record.disposed)).toBe(true)
  })

  it('reports host-missing when the seam package cannot be loaded', async () => {
    const { ctx, mounts } = provisionCtx()
    const registry = provisionRegistry(ctx, [], async () => undefined)
    const diagnostics = await registry.reconcile([lspSuite('ts')])
    expect(diagnostics).toHaveLength(1)
    const missingSeam = required(diagnostics[0], 'the unloadable seam package to report one diagnostic')
    expect(missingSeam).toMatchObject({ suiteId: 'src/ts', code: 'host-missing' })
    expect(missingSeam.reason).toContain('@deepseek-ai/dsh-lsp')
    // Nothing was mounted, including the provider that would have registered into a missing seam.
    expect(mounts).toEqual([])
    await registry.disposeAll()
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
