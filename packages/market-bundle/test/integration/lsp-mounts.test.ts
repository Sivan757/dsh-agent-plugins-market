import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LspMountRegistry, toLspServerConfig, type LspStdioServerConfig } from '../../../../packages/market-lsp/src/runtime/lsp/lsp-mounts.js'
import type { LegacyLspSeam } from '../../../../packages/market-lsp/src/application/lsp/profile-seam.js'
import type { Suite } from '../../../../packages/market-contracts/src/model/types.js'
import { required } from './helpers/fixture.js'

// The registry delegates command resolution to `runtime/host/shell-path`; the
// tests below pin the registry's own contract (when it consults the resolver,
// where the extension lands, and how the fact reaches diagnostics), so the
// resolver is faked to answer deterministically.
const { resolveDeclaredCommandMock } = vi.hoisted(() => ({ resolveDeclaredCommandMock: vi.fn() }))

vi.mock('../../../../packages/market-runtime/src/runtime/host/shell-path.js', () => ({ resolveDeclaredCommand: resolveDeclaredCommandMock }))

beforeEach(() => {
  resolveDeclaredCommandMock.mockReset()
  resolveDeclaredCommandMock.mockResolvedValue(undefined)
})

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
): {
  ctx: unknown
  disposed: () => boolean
  disposedConfigs: () => MountedConfig[]
  build: (loadHost: () => Promise<unknown>) => LspMountRegistry
} {
  let disposed = false
  // Every handle — the provider mount and the capability seam — disposes
  // through this one ctx, so a bare boolean cannot say which one was released.
  const disposedConfigs: MountedConfig[] = []
  const ctx = {
    logger: { warn: () => {}, info: vi.fn() },
    plugin(plugin: unknown, config: MountedConfig) {
      // cordis mounts call the plugin function; the stub mirrors that.
      if (applyThrows) (plugin as (ctx: unknown, config: MountedConfig) => void)({}, config)
      return {
        await(): Promise<void> {
          return handleBehavior === 'await-rejects' ? Promise.reject(new Error('startup failed')) : Promise.resolve()
        },
        dispose(): void {
          disposed = true
          disposedConfigs.push(config)
        }
      }
    }
  }
  const capability = () => async () => ({ default: () => {} })
  return {
    ctx,
    disposed: () => disposed,
    disposedConfigs: () => disposedConfigs,
    build: (loadHost: () => Promise<unknown>) => new LspMountRegistry(ctx as never, loadHost as never, capability(), capability(), noProfiles)
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

/**
 * No profile carries a legacy LSP layer in these tests. The real locator reads
 * the machine's own `$DSH_HOME`, which would make a conflict message depend on
 * whatever the developer running the suite happens to have configured.
 */
const noProfiles = async (): Promise<LegacyLspSeam[]> => []

/** Build a registry whose three host loaders are instrumented stubs. */
function provisionRegistry(
  ctx: unknown,
  mounted: MountedConfig[] = [],
  service: unknown = moduleLoader('lsp-service'),
  tool: unknown = moduleLoader('lsp-tool'),
  locateSeams: () => Promise<LegacyLspSeam[]> = noProfiles
) {
  return new LspMountRegistry(ctx as never, hostLoader('ok', mounted) as never, service as never, tool as never, locateSeams)
}

/** One macrotask turn, so a queued reconcile would have started had it been able to. */
const settleTurn = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** Wait until the predicate holds, so a gated pass is provably mid-flight. */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt += 1) await settleTurn()
  expect(predicate()).toBe(true)
}

/** A loader for a capability plugin, whose mount takes no `servers` config. */
const capabilityLoader = () => async (): Promise<{ default: () => void }> => ({ default: () => {} })

interface ProviderMountRecord {
  config: MountedConfig
  disposed: boolean
}

/**
 * A ctx whose provider mount blocks until released, so a pass can be held
 * mid-flight. Capability mounts resolve at once, so the provider handle is the
 * only thing a test can park.
 */
function gatedMountCtx(): { ctx: unknown; providerMounts: ProviderMountRecord[]; release: () => void } {
  const providerMounts: ProviderMountRecord[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const ctx = {
    logger: { warn: () => {}, info: vi.fn() },
    plugin(_plugin: unknown, config: MountedConfig) {
      const provider = Object.hasOwn(config, 'servers')
      const record: ProviderMountRecord = { config, disposed: false }
      if (provider) providerMounts.push(record)
      return {
        await: async () => {
          if (provider) await gate
        },
        dispose: async () => {
          record.disposed = true
        }
      }
    }
  }
  return { ctx, providerMounts, release }
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

  it('rebuilds a live mount on an explicit restart even though its config is unchanged', async () => {
    const mounted: MountedConfig[] = []
    const { build, disposedConfigs } = mountCtx('ok', true)
    const registry = build(hostLoader('ok', mounted))
    const suite = lspSuite('ts')
    await registry.reconcile([suite])
    expect(mounted).toHaveLength(1)
    // A plain pass compares fingerprints and keeps the live provider: this is
    // the state a language server that died underneath its mount keeps.
    await registry.reconcile([suite])
    expect(mounted).toHaveLength(1)
    expect(disposedConfigs()).toEqual([])

    // A restart skips the fingerprint match: the provider is torn down and a
    // fresh one mounts with the same resolved configuration.
    registry.forceRemountAll()
    expect(await registry.reconcile([suite])).toEqual([])
    expect(disposedConfigs().filter(config => Object.hasOwn(config, 'servers'))).toHaveLength(1)
    expect(mounted).toHaveLength(2)
    expect(mounted[1]).toEqual(mounted[0])
    // The flag is spent by the pass that used it, so the next one is quiet.
    await registry.reconcile([suite])
    expect(mounted).toHaveLength(2)
    await registry.disposeAll()
  })

  it('restarts only the named mount and leaves its neighbours running', async () => {
    const mounted: MountedConfig[] = []
    const { build, disposedConfigs } = mountCtx('ok', true)
    const registry = build(hostLoader('ok', mounted))
    const alpha = lspSuite('alpha')
    const beta = lspSuite('beta')
    await registry.reconcile([alpha, beta])
    expect(mounted).toHaveLength(2)
    // The row id is the mount key: one service's dialog names one mount.
    registry.forceRemount('src/alpha/typescript')
    await registry.reconcile([alpha, beta])
    expect(disposedConfigs().filter(config => Object.hasOwn(config, 'servers'))).toHaveLength(1)
    expect(mounted).toHaveLength(3)
    await registry.disposeAll()
  })

  it('names the suites whose mount is live, so the status rows do not share one flag', async () => {
    const mounted: MountedConfig[] = []
    const { build } = mountCtx('ok', true)
    const registry = build(hostLoader('ok', mounted))
    expect([...registry.liveKeys()]).toEqual([])
    await registry.reconcile([lspSuite('ts')])
    // One child per provider, so the key names the provider the status row names.
    expect([...registry.liveKeys()]).toEqual(['src/ts/typescript'])
    await registry.disposeAll()
    expect([...registry.liveKeys()]).toEqual([])
  })

  it('records a call outcome against the provider that owns the extension, and forgets it on unmount', async () => {
    const mounted: MountedConfig[] = []
    const { build } = mountCtx('ok', true)
    const registry = build(hostLoader('ok', mounted))
    const suite = lspSuite('ts')
    await registry.reconcile([suite])
    registry.observe('/work/app.ts', { ok: false, error: 'language server exited with code 1' })
    expect(registry.observationSnapshot().get('src/ts/typescript')).toMatchObject({ ok: false, error: 'language server exited with code 1' })
    // A path no live provider claims is not attributed to anyone.
    registry.observe('/work/app.py', { ok: false, error: 'unrelated' })
    expect(registry.observationSnapshot().size).toBe(1)
    // The mount going away takes its evidence with it: a restarted provider
    // must not inherit the previous process's failure.
    await registry.disposeAll()
    expect(registry.observationSnapshot().size).toBe(0)
  })

  it('queues a restart issued during a pass instead of overlapping it', async () => {
    const { ctx, providerMounts, release } = gatedMountCtx()
    const registry = new LspMountRegistry(ctx as never, hostLoader('ok') as never, capabilityLoader(), capabilityLoader(), noProfiles)
    const suite = lspSuite('ts')
    const first = registry.reconcile([suite])
    // Pass one is held at its provider mount.
    await waitFor(() => providerMounts.length === 1)
    // A restart lands while that pass is still in flight, so its follow-up is
    // queued behind the pass rather than racing it.
    const second = registry.reconcile([suite])
    await settleTurn()
    expect(providerMounts).toHaveLength(1)
    release()
    await Promise.all([first, second])
    // The queued pass ran after the mount settled, found it live with the same
    // config, and neither remounted nor disposed it.
    expect(providerMounts).toHaveLength(1)
    expect(providerMounts[0]?.disposed).toBe(false)
    await registry.disposeAll()
  })

  it('ignores a restart flag for a key that has no live mount', async () => {
    const mounted: MountedConfig[] = []
    const { build, disposedConfigs } = mountCtx('ok', true)
    const registry = build(hostLoader('ok', mounted))
    // Nothing is live yet, so the flag has nothing to tear down and the
    // ordinary mount path is what mounts the server.
    registry.forceRemount('src/ts/typescript')
    expect(await registry.reconcile([lspSuite('ts')])).toEqual([])
    expect(mounted).toHaveLength(1)
    expect(disposedConfigs()).toEqual([])
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

  it('releases the provider mount when its only server is disabled', async () => {
    const mounted: MountedConfig[] = []
    const { build, disposedConfigs } = mountCtx('ok', true)
    const registry = build(hostLoader('ok', mounted))
    await registry.reconcile([lspSuite('ts')])
    expect(mounted).toHaveLength(1)
    expect(disposedConfigs()).toEqual([])

    // Disabling the only server leaves the suite with nothing to mount, so the
    // pass has to release the live provider mount rather than merely skip a new
    // one — `mounted` alone cannot tell those apart, it only records applies.
    registry.setDisabledProvider(async () => new Set(['src/ts/typescript']))
    expect(await registry.reconcile([lspSuite('ts')])).toEqual([])
    expect(disposedConfigs().filter(config => Object.hasOwn(config, 'servers'))).toHaveLength(1)
    expect(mounted).toHaveLength(1)
    expect(registry.disabledServers()).toEqual(new Set(['src/ts/typescript']))

    // Re-enabling mounts it again instead of leaving the key latched as dead.
    registry.setDisabledProvider(async () => new Set())
    await registry.reconcile([lspSuite('ts')])
    expect(mounted).toHaveLength(2)
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

  it('names the profile and the file to edit when a legacy layer is found', async () => {
    const { ctx } = provisionCtx({ failOn: 'lsp-service' })
    const registry = provisionRegistry(ctx, [], moduleLoader('lsp-service'), moduleLoader('lsp-tool'), async () => [
      {
        profile: 'web',
        dir: '/home/u/.dsh/profiles/web',
        patchPath: '/home/u/.dsh/profiles/web/cordis.patch.yml',
        rows: [{ id: 'lsp', name: '@deepseek-ai/dsh-lsp' }],
        bundles: [],
        dependencies: ['@deepseek-ai/dsh-lsp'],
        patchReload: 'live' as const
      }
    ])
    const conflict = required((await registry.reconcile([lspSuite('ts')]))[0], 'the taken lsp service to report one conflict')
    expect(conflict.reason).toContain('profile "web"')
    expect(conflict.reason).toContain('cordis.patch.yml')
    await registry.disposeAll()
  })

  it('still explains the conflict when the machine cannot be read', async () => {
    const { ctx } = provisionCtx({ failOn: 'lsp-service' })
    const registry = provisionRegistry(ctx, [], moduleLoader('lsp-service'), moduleLoader('lsp-tool'), async () => {
      throw new Error('unreadable')
    })
    const conflict = required((await registry.reconcile([lspSuite('ts')]))[0], 'the taken lsp service to report one conflict')
    expect(conflict.code).toBe('seam-conflict')
    expect(conflict.reason).toContain('remove that layer')
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

describe('LspMountRegistry: bare-command resolution', () => {
  it('consults the resolver for every declared server and mounts an untouched config when there is nothing to do', async () => {
    const mounted: MountedConfig[] = []
    const { build } = mountCtx('ok', true)
    const registry = build(hostLoader('ok', mounted))
    await registry.reconcile([lspSuite('ts')])
    expect(resolveDeclaredCommandMock).toHaveBeenCalledTimes(1)
    expect(resolveDeclaredCommandMock).toHaveBeenCalledWith(expect.anything(), 'typescript-language-server', {})
    const mount = required(mounted[0], 'the ts suite to mount one provider')
    expect(mount.servers['src/ts/typescript']).toMatchObject({ command: 'typescript-language-server', args: ['--stdio'] })
    expect(mount.servers['src/ts/typescript']?.env).toBeUndefined()
    await registry.disposeAll()
  })

  it('injects the extended PATH into the server env, preserving the declared env', async () => {
    resolveDeclaredCommandMock.mockResolvedValue({ path: '/opt/homebrew/bin:/usr/bin:/bin', diagnostic: 'PATH extended from the login shell: /opt/homebrew/bin' })
    const mounted: MountedConfig[] = []
    const { build } = mountCtx('ok', true)
    const registry = build(hostLoader('ok', mounted))
    const suite = lspSuite('ts')
    const server = required(required(suite.lsp, 'the ts fixture to declare lsp servers').servers['typescript'], 'the typescript server')
    server.env = { RUST_LOG: 'warn' }
    await registry.reconcile([suite])
    const mount = required(mounted[0], 'the ts suite to mount one provider')
    expect(mount.servers['src/ts/typescript']?.env).toEqual({ RUST_LOG: 'warn', PATH: '/opt/homebrew/bin:/usr/bin:/bin' })
    await registry.disposeAll()
  })

  it('never injects when the server declares its own PATH', async () => {
    const mounted: MountedConfig[] = []
    const { build } = mountCtx('ok', true)
    const registry = build(hostLoader('ok', mounted))
    const suite = lspSuite('ts')
    const server = required(required(suite.lsp, 'the ts fixture to declare lsp servers').servers['typescript'], 'the typescript server')
    server.env = { PATH: '/custom/bin' }
    await registry.reconcile([suite])
    // The resolver owns the "explicit PATH wins" rule; it receives the
    // declaration and answers `undefined`, so the env is mounted verbatim.
    expect(resolveDeclaredCommandMock).toHaveBeenCalledWith(expect.anything(), 'typescript-language-server', { PATH: '/custom/bin' })
    const mount = required(mounted[0], 'the ts suite to mount one provider')
    expect(mount.servers['src/ts/typescript']?.env).toEqual({ PATH: '/custom/bin' })
    await registry.disposeAll()
  })

  it('carries the resolution fact onto the mount failure causes', async () => {
    resolveDeclaredCommandMock.mockResolvedValue({
      diagnostic: 'could not resolve "typescript-language-server" even after extending PATH from the login shell (searched: /usr/bin:/bin)'
    })
    const { build } = mountCtx('await-rejects')
    const registry = build(hostLoader('fail-startup'))
    const diagnostics = await registry.reconcile([lspSuite('ts')])
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({ code: 'mount-failed' })
    expect(diagnostics[0]?.causes).toEqual(['typescript: could not resolve "typescript-language-server" even after extending PATH from the login shell (searched: /usr/bin:/bin)'])
    await registry.disposeAll()
  })

  it('resolves direct user-configured servers the same way', async () => {
    const mounted: MountedConfig[] = []
    const { build } = mountCtx('ok', true)
    const registry = build(hostLoader('ok', mounted))
    registry.setDirectProvider(async () => ({ gopls: { key: 'gopls', command: 'gopls', args: [], extensionToLanguage: { '.go': 'go' } } }))
    await registry.reconcile([])
    expect(resolveDeclaredCommandMock).toHaveBeenCalledWith(expect.anything(), 'gopls', {})
    const mount = required(mounted[0], 'the direct server to mount one provider')
    expect(mount.servers['direct/gopls']).toMatchObject({ command: 'gopls' })
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
