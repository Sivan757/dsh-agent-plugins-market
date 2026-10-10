import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Lsp, { LspProviderId } from '@deepseek-ai/dsh-lsp'
import { LspMountRegistry, type LspStdioServerConfig } from '../packages/market-lsp/src/runtime/lsp/lsp-mounts.js'
import { effectiveSurfaces, type Suite } from '../packages/market-contracts/src/model/types.js'

vi.mock('../packages/market-runtime/src/runtime/host/shell-path.js', () => ({ resolveDeclaredCommand: async () => undefined }))
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})
function suite(keys: string[]): Suite {
  return {
    sourceId: 'source',
    id: 'suite',
    root: '/unused',
    manifest: { layout: 'claude-code', path: '', id: 'suite', name: 'Suite' },
    skills: [],
    dimension: 'user',
    enabled: true,
    errors: [],
    activeSurfaces: effectiveSurfaces(undefined),
    surfaces: { skills: 0, commands: 0, agents: 0, hooks: 0, mcp: 0, lsp: keys.length },
    lsp: { servers: Object.fromEntries(keys.map(key => [key, { key, command: key, args: [], extensionToLanguage: { ['.' + key]: key } }])) }
  }
}
function setup() {
  const mounts: Array<{ ids: string[]; dispose: ReturnType<typeof vi.fn> }> = []
  const failures = new Map<string, string>()
  const ctx = {
    logger: { warn: vi.fn(), info: vi.fn() },
    plugin(_plugin: unknown, config: { servers?: Record<string, LspStdioServerConfig> }) {
      const ids = Object.keys(config.servers ?? {})
      const dispose = vi.fn(async () => {})
      mounts.push({ ids, dispose })
      return {
        await: async () => {
          for (const id of ids) {
            const error = failures.get(id)
            if (error) throw new Error(error)
          }
        },
        dispose
      }
    }
  }
  const loader = async () => ({ default: () => {} })
  const registry = new LspMountRegistry(ctx as unknown as Context, loader, loader, loader, async () => [])
  cleanups.push(() => registry.disposeAll())
  return { registry, mounts, failures }
}
it('adds and removes same-suite providers without restarting an unchanged sibling, then releases the last seat', async () => {
  const { registry, mounts } = setup()
  expect(await registry.reconcile([suite(['ts'])])).toEqual([])
  const ts = mounts.find(mount => mount.ids.includes('source/suite/ts'))!
  expect(await registry.reconcile([suite(['ts', 'py'])])).toEqual([])
  expect(ts.dispose).not.toHaveBeenCalled()
  expect(mounts.filter(mount => mount.ids.includes('source/suite/ts'))).toHaveLength(1)
  const py = mounts.find(mount => mount.ids.includes('source/suite/py'))!
  expect(py.ids).toEqual(['source/suite/py'])
  await registry.reconcile([suite(['ts'])])
  expect(py.dispose).toHaveBeenCalledTimes(1)
  expect(ts.dispose).not.toHaveBeenCalled()
  expect(registry.providerOwnership()).toEqual([{ resourceId: 'lsp:source/suite/ts', suiteId: 'source/suite', extensions: ['.ts'] }])
  await registry.reconcile([])
  expect(ts.dispose).toHaveBeenCalledTimes(1)
  expect(mounts.filter(mount => mount.ids.length === 0).every(mount => mount.dispose.mock.calls.length === 1)).toBe(true)
  expect(registry.hasLiveMounts()).toBe(false)
  expect(registry.ownsTool()).toBe(false)
})
it('retains a healthy sibling while reporting provider startup and collision failures with unchanged suite identity', async () => {
  const { registry, mounts, failures } = setup()
  failures.set('source/suite/py', 'extension already handled by another LSP provider')
  const diagnostics = await registry.reconcile([suite(['ts', 'py'])])
  expect(diagnostics).toMatchObject([{ suiteId: 'source/suite', serverKey: 'source/suite/py', code: 'seam-conflict' }])
  expect(registry.diagnosticsSnapshot().get('source/suite')).toEqual(diagnostics[0])
  const ts = mounts.find(mount => mount.ids.includes('source/suite/ts'))!
  expect(ts.dispose).not.toHaveBeenCalled()
  failures.set('source/suite/py', 'executable unavailable')
  expect(await registry.reconcile([suite(['py', 'ts'])])).toMatchObject([{ suiteId: 'source/suite', serverKey: 'source/suite/py', code: 'mount-failed' }])
  expect(registry.diagnosticsSnapshot().get('source/suite')?.serverKey).toBe('source/suite/py')
  expect(ts.dispose).not.toHaveBeenCalled()
  failures.clear()
  expect(await registry.reconcile([suite(['ts', 'py'])])).toEqual([])
  expect(registry.diagnosticsSnapshot().size).toBe(0)
  expect(ts.dispose).not.toHaveBeenCalled()
})
it('keeps direct providers independent and still honors disabled-provider policy', async () => {
  const { registry, mounts } = setup()
  const direct = suite(['ts', 'py']).lsp!.servers
  registry.setDirectProvider(async () => direct)
  const disabled = new Set<string>()
  registry.setDisabledProvider(async () => disabled)
  await registry.reconcile([])
  const ts = mounts.find(mount => mount.ids.includes('direct/ts'))!
  const py = mounts.find(mount => mount.ids.includes('direct/py'))!
  disabled.add('direct/py')
  await registry.reconcile([])
  expect(ts.dispose).not.toHaveBeenCalled()
  expect(py.dispose).toHaveBeenCalledTimes(1)
  expect(registry.providerOwnership()).toEqual([{ resourceId: 'lsp:direct/ts', extensions: ['.ts'] }])
  registry.setDirectProvider(async () => ({}))
  await registry.reconcile([])
  expect(ts.dispose).toHaveBeenCalledTimes(1)
})

it('preserves real host extension ownership while rejecting a conflicting provider and releases routes last', async () => {
  const ctx = new Context()
  cleanups.push(async () => {
    await ctx.fiber.dispose()
  })
  const queries = vi.fn(async () => ({ kind: 'hover' as const, hover: { contents: 'live' } }))
  const releases = new Map<string, ReturnType<typeof vi.fn>>()
  const providerPlugin = {
    inject: ['lsp'],
    apply(inner: Context, config: { servers: Record<string, LspStdioServerConfig> }) {
      for (const [id, server] of Object.entries(config.servers)) {
        const release = inner.lsp.registerProvider({ id: LspProviderId(id), extensionToLanguage: server.extensionToLanguage, query: queries })
        const observed = vi.fn(release)
        releases.set(id, observed)
        inner.effect(() => observed)
      }
    }
  }
  const registry = new LspMountRegistry(
    ctx,
    async () => ({ default: providerPlugin }),
    async () => ({ default: Lsp }),
    async () => ({ default: () => {} }),
    async () => []
  )
  cleanups.push(() => registry.disposeAll())
  const demanded = new Set<string>()
  registry.setDemandedProviderIdsProvider(() => demanded)
  registry.setDisabledProvider(async () => new Set(['source/suite/other', 'source/suite/invalid']))
  const original = suite(['ts'])
  expect(await registry.reconcile([original])).toEqual([])
  const conflict = suite(['ts', 'other'])
  conflict.lsp!.servers['other']!.extensionToLanguage = { '.ts': 'typescript' }
  demanded.add('source/suite/other')
  expect(await registry.reconcile([conflict])).toMatchObject([{ suiteId: 'source/suite', serverKey: 'source/suite/other', code: 'seam-conflict' }])
  expect(releases.get('source/suite/ts')).not.toHaveBeenCalled()
  expect(await ctx.lsp.query({ operation: 'hover', filePath: 'file.ts', position: { line: 0, character: 0 }, workspaceRoot: '/unused' })).toMatchObject({ kind: 'hover' })
  expect(queries).toHaveBeenCalledTimes(1)
  const invalid = suite(['ts', 'invalid'])
  invalid.lsp!.servers['invalid']!.extensionToLanguage = { '.bad/path': 'typescript' }
  demanded.clear()
  demanded.add('source/suite/invalid')
  expect(await registry.reconcile([invalid])).toMatchObject([{ suiteId: 'source/suite', serverKey: 'source/suite/invalid', code: 'mount-failed' }])
  expect(registry.providerOwnership()).toHaveLength(1)
  expect(releases.get('source/suite/ts')).not.toHaveBeenCalled()
  await registry.reconcile([original])
  expect(registry.diagnosticsSnapshot().size).toBe(0)
  expect(releases.get('source/suite/ts')).not.toHaveBeenCalled()
  await registry.reconcile([])
  expect(releases.get('source/suite/ts')).toHaveBeenCalledTimes(1)
})

it('mounts explicitly demanded disabled suite and direct providers without bypassing entry filters', async () => {
  const { registry } = setup()
  const input = suite(['ts'])
  registry.setDirectProvider(async () => suite(['py']).lsp!.servers)
  registry.setDisabledProvider(async () => new Set(['source/suite/ts', 'direct/py']))
  await registry.reconcile([input])
  expect(registry.hasLiveMounts()).toBe(false)
  const demanded = new Set(['source/suite/ts', 'direct/py'])
  registry.setDemandedProviderIdsProvider(() => demanded)
  expect(await registry.reconcile([input])).toEqual([])
  expect(registry.providerOwnership().map(provider => provider.resourceId)).toEqual(['lsp:source/suite/ts', 'lsp:direct/py'])
  registry.setEntryFilter(() => ({ allows: () => false }))
  await registry.reconcile([input])
  expect(registry.hasLiveMounts()).toBe(false)
  registry.setEntryFilter(() => ({ allows: () => true }))
  demanded.clear()
  await registry.reconcile([input])
  expect(registry.hasLiveMounts()).toBe(false)
})
