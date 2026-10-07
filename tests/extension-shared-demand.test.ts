import { afterEach, describe, expect, it, vi } from 'vitest'
import { RuntimeReconciler } from '../src/runtime/core/reconciler.js'
import { McpMountRegistry } from '../src/runtime/mcp/mcp-mounts.js'
import { LspMountRegistry } from '../src/runtime/lsp/lsp-mounts.js'
import { CommandMountRegistry } from '../src/runtime/surfaces/commands-mounts.js'
import { HooksMountRegistry } from '../src/runtime/surfaces/hooks-mounts.js'
import { deriveServerName } from '../src/application/mcp/mcp-config.js'
import * as projection from '../src/application/extension-suite-selection.js'
import { effectiveSurfaces, type Suite } from '../src/model/types.js'
import type { McpSuiteOverrides } from '../src/application/mcp/mcp-overrides.js'

afterEach(() => vi.restoreAllMocks())
function suite(command = 'current'): Suite {
  return {
    sourceId: 'source',
    id: 'suite',
    root: '/suite',
    dimension: 'user',
    enabled: false,
    activeSurfaces: effectiveSurfaces(undefined),
    manifest: { id: 'suite', name: 'Suite', layout: 'agent-plugin-v1', path: '/suite/plugin.json' },
    skills: [],
    resources: { commands: [], agents: [] },
    errors: [],
    surfaces: { skills: 0, commands: 0, agents: 0, hooks: 0, mcp: 1, lsp: 1 },
    mcp: { schema: 'test', servers: { db: { type: 'stdio', command, disabledTools: ['delete'] } } },
    lsp: { servers: { ts: { key: 'ts', command, args: [], extensionToLanguage: { '.ts': 'typescript' } } } }
  }
}
function setup() {
  let mounted: Suite[] = []
  let lspMounted: Suite[] = []
  let overrides: () => Promise<Map<string, McpSuiteOverrides>> = async () => new Map()
  let demanded: () => ReadonlySet<string> = () => new Set()
  vi.spyOn(McpMountRegistry.prototype, 'setOverridesProvider').mockImplementation(provider => {
    overrides = provider
  })
  vi.spyOn(LspMountRegistry.prototype, 'globalDisabledProviderIds').mockResolvedValue(new Set(['direct/python']))
  vi.spyOn(LspMountRegistry.prototype, 'setDemandedProviderIdsProvider').mockImplementation(provider => {
    demanded = provider
  })
  const mcp = vi.spyOn(McpMountRegistry.prototype, 'reconcile').mockImplementation(async rows => {
    mounted = structuredClone(rows)
    await overrides()
    return []
  })
  const lsp = vi.spyOn(LspMountRegistry.prototype, 'reconcile').mockImplementation(async rows => {
    lspMounted = structuredClone(rows)
    return []
  })
  const owner = vi.spyOn(McpMountRegistry.prototype, 'serverOwner').mockImplementation(name => {
    for (const row of mounted)
      for (const key of Object.keys(row.mcp?.servers ?? {})) if (deriveServerName(row, key) === name) return { suiteId: row.sourceId + '/' + row.id, serverKey: key }
    return undefined
  })
  vi.spyOn(LspMountRegistry.prototype, 'providerOwnership').mockImplementation(() =>
    lspMounted.flatMap(row =>
      Object.values(row.lsp?.servers ?? {}).map(spec => ({ resourceId: 'lsp:' + row.sourceId + '/' + row.id + '/' + spec.key, extensions: Object.keys(spec.extensionToLanguage) }))
    )
  )
  const commands = vi.spyOn(CommandMountRegistry.prototype, 'reconcile').mockResolvedValue([])
  vi.spyOn(HooksMountRegistry.prototype, 'reconcile').mockResolvedValue([])
  vi.spyOn(McpMountRegistry.prototype, 'disposeAll').mockResolvedValue()
  vi.spyOn(LspMountRegistry.prototype, 'disposeAll').mockResolvedValue()
  vi.spyOn(CommandMountRegistry.prototype, 'disposeAll').mockImplementation(() => {})
  vi.spyOn(HooksMountRegistry.prototype, 'disposeAll').mockResolvedValue()
  const warn = vi.fn()
  const reconciler = new RuntimeReconciler({ logger: { warn } } as never, '/data')
  return { reconciler, mcp, lsp, owner, commands, warn, mounted: () => mounted, overrides: () => overrides(), demanded: () => demanded() }
}
const candidates = (row: Suite) => [{ suite: row, validSurfaces: effectiveSurfaces(undefined) }]

describe('shared session service demand', () => {
  it('shares committed and staged demand across legacy refresh and releases only the last owner', async () => {
    const f = setup()
    const a = {}
    const b = {}
    const row = suite()
    await f.reconciler.refreshCatalog(candidates(row), [])
    const first = await f.reconciler.stageSessionDemand(a, [row])
    first.commit()
    const second = await f.reconciler.stageSessionDemand(b, [row])
    second.commit()
    await f.reconciler.reconcile([])
    expect(f.mounted()).toHaveLength(1)
    await f.reconciler.releaseSessionDemand(a)
    expect(f.mounted()).toHaveLength(1)
    await f.reconciler.releaseSessionDemand(b)
    expect(f.mounted()).toEqual([])
    await f.reconciler.dispose()
  })
  it('takes current authority config, not requested snapshots, and hard revokes without throwing after durable commit', async () => {
    const f = setup()
    const owner = {}
    const current = suite('new')
    await f.reconciler.refreshCatalog(candidates(current), [])
    const receipt = await f.reconciler.stageSessionDemand(owner, [suite('stale')])
    expect(f.mounted()[0]!.mcp!.servers.db).toMatchObject({ command: 'new', disabledTools: ['delete'] })
    await f.reconciler.refreshCatalog([], [])
    expect(() => receipt.commit()).not.toThrow()
    await f.reconciler.reconcile([])
    expect(f.mounted()).toEqual([])
    await f.reconciler.dispose()
  })
  it('intersects stale global base with current valid server declarations', async () => {
    const f = setup()
    const stale = suite('old')
    const current = suite('new')
    current.mcp!.servers = {}
    await f.reconciler.refreshCatalog(candidates(current), [stale])
    await f.reconciler.reconcile([stale])
    expect(f.mounted()[0]!.mcp!.servers).toEqual({})
    expect(f.lsp.mock.calls.at(-1)![0][0]!.lsp!.servers.ts!.command).toBe('new')
    await f.reconciler.refreshCatalog([], [stale])
    expect(f.mounted()).toEqual([])
    await f.reconciler.dispose()
  })
  it('requires positive target ownership even when diagnostics are empty', async () => {
    const f = setup()
    const row = suite()
    await f.reconciler.refreshCatalog(candidates(row), [])
    f.owner.mockReturnValue(undefined)
    await expect(f.reconciler.stageSessionDemand({}, [row])).rejects.toThrow('extension-shared-mcp-unavailable')
    expect(f.mounted()).toEqual([])
    await f.reconciler.dispose()
  })
  it('stages and rolls back global-covered or empty selections without waiting for default network work', async () => {
    const f = setup()
    const global = suite()
    global.enabled = true
    f.reconciler.setCatalogAuthority(candidates(global), [global])
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    f.mcp.mockImplementationOnce(async () => {
      entered.resolve()
      await release.promise
      return []
    })
    const network = f.reconciler.reconcile([global])
    await entered.promise
    try {
      const empty = await f.reconciler.stageSessionDemand({}, [])
      await empty.rollback()
      const covered = await f.reconciler.stageSessionDemand({}, [global])
      covered.commit()
      expect(f.mcp).toHaveBeenCalledTimes(1)
    } finally {
      release.resolve()
    }
    await network
    expect(f.mcp).toHaveBeenCalledTimes(1)
    await f.reconciler.dispose()
  })
  it('rejects a changed authority during async default classification without starting a network pass', async () => {
    const f = setup()
    const row = suite()
    row.enabled = true
    f.reconciler.setCatalogAuthority(candidates(row), [row])
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    f.reconciler.setMcpOverridesProvider(async () => {
      entered.resolve()
      await release.promise
      return new Map()
    })
    const staging = f.reconciler.stageSessionDemand({}, [row])
    const rejected = expect(staging).rejects.toThrow('extension-shared-catalog-conflict')
    await entered.promise
    f.reconciler.setCatalogAuthority([], [])
    release.resolve()
    await rejected
    expect(f.mcp).not.toHaveBeenCalled()
    await f.reconciler.dispose()
  })
  it('keeps the newest overlapping catalog refresh and does not conflict on identical publication', async () => {
    const f = setup()
    const a = suite('a')
    a.enabled = true
    const b = suite('b')
    b.enabled = true
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const original = f.mcp.getMockImplementation()!
    f.mcp.mockImplementationOnce(async rows => {
      entered.resolve()
      await release.promise
      return original(rows)
    })
    const first = f.reconciler.refreshCatalog(candidates(a), [a])
    await entered.promise
    const second = f.reconciler.refreshCatalog(candidates(b), [b])
    release.resolve()
    await Promise.all([first, second])
    expect(f.mounted()[0]!.mcp!.servers.db).toMatchObject({ command: 'b' })
    f.reconciler.setMcpOverridesProvider(async () => {
      f.reconciler.setCatalogAuthority(candidates(b), [b])
      return new Map()
    })
    const receipt = await f.reconciler.stageSessionDemand({}, [b])
    receipt.commit()
    await f.reconciler.dispose()
  })
  it('keeps local queues progressing while an authority-enabled shared pass is held', async () => {
    const f = setup()
    await f.reconciler.refreshCatalog(candidates(suite()), [])
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    f.mcp.mockImplementationOnce(async () => {
      entered.resolve()
      await release.promise
      return []
    })
    const first = f.reconciler.reconcile([])
    await entered.promise
    const before = f.commands.mock.calls.length
    const second = f.reconciler.reconcile([])
    try {
      await vi.waitFor(() => expect(f.commands).toHaveBeenCalledTimes(before + 1))
    } finally {
      release.resolve()
    }
    await Promise.all([first, second])
    await f.reconciler.dispose()
  })
  it('does not let an offline global default poison successful explicit activation', async () => {
    const f = setup()
    const global = suite()
    global.enabled = true
    const requested = suite()
    requested.id = 'activated'
    await f.reconciler.refreshCatalog([...candidates(global), ...candidates(requested)], [global])
    const reconcile = f.mcp.getMockImplementation()!
    f.mcp.mockImplementation(async rows => {
      await reconcile(rows)
      return [{ suiteId: 'source/suite', serverKey: 'db', reason: 'offline', code: 'mount-failed' }]
    })
    const resolveOwner = f.owner.getMockImplementation()!
    f.owner.mockImplementation(name => (name === deriveServerName(global, 'db') ? undefined : resolveOwner(name)))
    const receipt = await f.reconciler.stageSessionDemand({}, [global, requested])
    expect(() => receipt.commit()).not.toThrow()
    await f.reconciler.reconcile([global])
    await f.reconciler.dispose()
  })
  it('still requires activation when a globally listed server has its ordinary override off', async () => {
    const f = setup()
    const row = suite()
    row.enabled = true
    f.reconciler.setMcpOverridesProvider(async () => new Map([['source/suite', { db: { enabled: false } }]]))
    await f.reconciler.refreshCatalog(candidates(row), [row])
    f.owner.mockReturnValue(undefined)
    await expect(f.reconciler.stageSessionDemand({}, [row])).rejects.toThrow('extension-shared-mcp-unavailable')
    await f.reconciler.dispose()
  })
  it('preserves the original stage error when rollback projection also throws', async () => {
    const f = setup()
    const row = suite()
    await f.reconciler.refreshCatalog(candidates(row), [])
    const original = new Error('stage ownership failure')
    f.owner.mockImplementationOnce(() => {
      vi.spyOn(projection, 'projectExtensionSuites').mockImplementationOnce(() => {
        throw new Error('cleanup projection failure')
      })
      throw original
    })
    await expect(f.reconciler.stageSessionDemand({}, [row])).rejects.toBe(original)
    expect(f.warn).toHaveBeenCalledWith(expect.stringContaining('cleanup projection failure'))
    await f.reconciler.dispose()
  })
  it('self-rolls back failed staging and preserves previous committed demand', async () => {
    const f = setup()
    const owner = {}
    const old = suite()
    const next = suite()
    next.id = 'next'
    await f.reconciler.refreshCatalog([...candidates(old), ...candidates(next)], [])
    const committed = await f.reconciler.stageSessionDemand(owner, [old])
    committed.commit()
    await f.reconciler.reconcile([])
    f.mcp.mockResolvedValueOnce([{ suiteId: 'source/next', serverKey: 'db', reason: 'missing secret', code: 'missing-credential' }])
    await expect(f.reconciler.stageSessionDemand(owner, [next])).rejects.toThrow()
    expect(f.mounted().map(row => row.id)).toEqual(['suite'])
    await f.reconciler.dispose()
  })
  it('merges only MCP enabled and exposes only validated demanded LSP IDs', async () => {
    const f = setup()
    const row = suite()
    const original = new Map<string, McpSuiteOverrides>([['source/suite', { db: { enabled: false, disabledTools: ['secret'], headers: { Authorization: '${TOKEN}' } } }]])
    f.reconciler.setMcpOverridesProvider(async () => original)
    await f.reconciler.refreshCatalog(candidates(row), [])
    const receipt = await f.reconciler.stageSessionDemand({}, [row])
    expect((await f.overrides()).get('source/suite')!.db).toEqual({ enabled: true, disabledTools: ['secret'], headers: { Authorization: '${TOKEN}' } })
    expect(original.get('source/suite')!.db!.enabled).toBe(false)
    expect([...f.demanded()]).toEqual(['source/suite/ts'])
    await receipt.rollback()
    expect((await f.overrides()).get('source/suite')!.db!.enabled).toBe(false)
    await f.reconciler.dispose()
  })
  it('shares direct LSP demand, rolls back, releases, and observes hard configuration removal', async () => {
    const f = setup()
    let exists = true
    vi.spyOn(LspMountRegistry.prototype, 'providerOwnership').mockImplementation(() =>
      exists && f.demanded().has('direct/python') ? [{ resourceId: 'lsp:direct/python', extensions: ['.py'] }] : []
    )
    await f.reconciler.refreshCatalog([], [])
    const a = {}
    const b = {}
    const first = await f.reconciler.stageSessionDemand(a, [], ['direct/python'])
    first.commit()
    const second = await f.reconciler.stageSessionDemand(b, [], ['direct/python'])
    await second.rollback()
    expect([...f.demanded()]).toEqual(['direct/python'])
    await f.reconciler.releaseSessionDemand(a)
    expect([...f.demanded()]).toEqual([])
    const pending = await f.reconciler.stageSessionDemand(b, [], ['direct/python'])
    exists = false
    await f.reconciler.refreshCatalog([], [])
    expect(() => pending.commit()).not.toThrow()
    await expect(f.reconciler.stageSessionDemand({}, [], ['direct/python'])).rejects.toThrow('extension-shared-lsp-unavailable')
    await f.reconciler.releaseSessionDemand(b)
    expect([...f.demanded()]).toEqual([])
    await f.reconciler.dispose()
  })
  it('invalidates released and disposed receipts and excludes project or invalid requests', async () => {
    const f = setup()
    const owner = {}
    const row = suite()
    await expect(f.reconciler.stageSessionDemand(owner, [row])).rejects.toThrow()
    await f.reconciler.refreshCatalog([{ suite: row, validSurfaces: effectiveSurfaces({ mcp: false }) }], [])
    await expect(f.reconciler.stageSessionDemand(owner, [row])).rejects.toThrow()
    await f.reconciler.refreshCatalog(candidates(row), [])
    const receipt = await f.reconciler.stageSessionDemand(owner, [row])
    await f.reconciler.releaseSessionDemand(owner)
    receipt.commit()
    await receipt.rollback()
    await f.reconciler.reconcile([])
    expect(f.mounted()).toEqual([])
    const project = suite()
    project.dimension = 'project'
    const empty = await f.reconciler.stageSessionDemand({}, [project])
    empty.commit()
    const disposed = await f.reconciler.stageSessionDemand({}, [row])
    await f.reconciler.dispose()
    expect(() => disposed.commit()).not.toThrow()
    await disposed.rollback()
  })
})
