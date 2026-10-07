/** The project detail read must answer for the user-hooks configuration row even when no valid hook exists. */
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Catalog } from '../src/application/catalog.js'
import { createProjectExtensionResources } from '../src/application/extension-project.js'
import { loadUserHooksSuite, USER_HOOKS_SOURCE, USER_HOOKS_SUITE } from '../src/application/panels/user-hooks.js'
import { MARKET_ROUTES, type SuiteDetail } from '../src/contracts/market.js'
import { mountSuiteRoutes, type WebServerService } from '../src/routes.js'
import type { MarketService } from '../src/application/queries.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function root(prefix: string): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), prefix))
  roots.push(value)
  return value
}
const hook = (command: string) => ({ matcher: '*', hooks: [{ type: 'command', command }] })
/** The detail read never touches the panel stores; the structural surface still needs every member. */
const noLists: Parameters<typeof createProjectExtensionResources>[1]['skills'] = {
  list: async () => [],
  create: async (name: string) => ({ name }) as never,
  update: async () => {},
  remove: async () => {}
}

/** One project reader over a real catalog, mirroring how the route mounts it per session. */
async function reader(agentsRoot: string, cwd: string) {
  const catalog = new Catalog({ userRoot: await root('market-hooks-detail-user-'), dataRoot: await root('market-hooks-detail-data-'), agentsRoot, onChanged: () => {} })
  await catalog.load()
  return { reader: createProjectExtensionResources(catalog, { skills: noLists, commands: noLists, agents: noLists }, cwd), catalog }
}

/** The query the client sends for the user-hooks configuration row's detail. */
const hooksDetailQuery = MARKET_ROUTES.suite + '?sourceId=' + encodeURIComponent(USER_HOOKS_SOURCE) + '&suiteId=' + USER_HOOKS_SUITE + '&sessionId='

type RouteTable = Map<string, (request: unknown, response: unknown) => void | Promise<void>>
/** One strict web server double that records the exact routes the plugin mounts. */
function strictWebServer(routes: RouteTable): WebServerService {
  return {
    register: route => {
      if (routes.has(route.path)) throw new Error('webserver: duplicate exact route')
      routes.set(route.path, route.handler as (request: unknown, response: unknown) => void | Promise<void>)
      return () => routes.delete(route.path)
    }
  }
}
function response() {
  let body = ''
  let code = 0
  return {
    value: (): Record<string, unknown> => JSON.parse(body) as Record<string, unknown>,
    status: (): number => code,
    writeHead: (status: number) => {
      code = status
    },
    end: (value: string) => {
      body = value
    }
  }
}
/** A market service double over the same real catalog, so the global fallback path answers the same fixtures. */
function marketService(catalog: Catalog): MarketService {
  return {
    sources: [],
    overview: async () => ({ sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: catalog.userRoot, data: catalog.dataRoot } }),
    mcpStatus: async () => ({
      entries: [],
      observedAt: '',
      totals: { all: 0, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
      directObservationOnly: true
    }),
    lspStatus: async () => ({ entries: [], observedAt: '', totals: { all: 0, mounted: 0, failed: 0, blocked: 0, disabled: 0 }, hostMissing: false }),
    suiteDetail: async (sourceId: string, suiteId: string) => catalog.suiteDetail(sourceId, suiteId),
    suiteDocument: async () => ({ name: '', content: '' }),
    suiteDocumentTranslation: async () => ({ text: '', pending: 0 }),
    sourceProgress: () => ({ active: false, sourceId: '', step: '' }),
    serverConfig: async (kind, id) => ({ kind, id, key: '', editable: false, config: {} }),
    clearTranslations: async () => {},
    lspServers: async () => ({}),
    mcpOverrides: async () => ({}),
    addSource: async input => ({ id: '', ...input }),
    updateSource: async () => {},
    removeSource: async () => {},
    adoptSource: async id => ({ id, url: '', kind: 'git' as const, adopted: true as const }),
    refreshSource: async () => {},
    install: async () => {},
    uninstall: async () => {},
    setEnabled: async () => {},
    setSurface: async () => {},
    setMcpOverride: async () => {},
    setMcpServerEnabled: async () => {},
    setMcpServerToolEnabled: async () => {},
    addMcpServer: async () => {},
    saveServerConfig: async () => {},
    addLspServer: async () => {},
    setLspServers: async () => ({}),
    setLspServerEnabled: async () => {},
    migrateLegacyLspSeam: async profile => ({ profile, patchPath: '', backupPath: '', restartRequired: false }),
    retryMounts: async () => {},
    reauthorizeMcpServer: async () => {},
    mcpReauthorizeAvailable: () => true,
    mcpBackendInfo: async () => ({
      backend: 'builtin' as const,
      hostClient: { available: true, version: '' },
      downloadRegion: { setting: 'auto' as const, effective: 'global' as const }
    }),
    setMcpBackend: async () => {},
    menuRowFaces: async () => [],
    notifyPanelsChanged: async () => {}
  }
}
/** Mount the suite routes the way the plugin entry does: the market service beside one session's project reader. */
function mountRoutes(catalog: Catalog, project: ReturnType<typeof createProjectExtensionResources>, cwd: string) {
  const routes: RouteTable = new Map()
  const agent = { session: { header: { cwd } } } as unknown as Agent
  const dispose = mountSuiteRoutes({ webServer: strictWebServer(routes) }, marketService(catalog), undefined, undefined, {
    agent: () => agent,
    project: () => project
  })
  return { routes, dispose }
}
const getRequest = (url: string) => ({ method: 'GET', url, headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } })
/** A recursively sorted snapshot of one directory tree, so a read-only assertion sees content changes, not mtime. */
async function treeSnapshot(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const lines: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      lines.push(entry.name + '/', ...(await treeSnapshot(full)).map(row => entry.name + '/' + row))
    } else {
      lines.push(entry.name + ':' + (await stat(full)).size)
    }
  }
  return lines
}

describe('project suite detail for the user-hooks configuration', () => {
  it('answers with diagnostics instead of a 404 when no hook file exists', async () => {
    const agentsRoot = await root('market-hooks-detail-empty-')
    const { reader: project } = await reader(agentsRoot, await root('market-hooks-detail-cwd-'))
    // The catalog omits the suite from the enabled set: surfaces.hooks is 0.
    expect((await loadUserHooksSuite(agentsRoot)).surfaces.hooks).toBe(0)
    const detail = await project.suiteDetail(USER_HOOKS_SOURCE, USER_HOOKS_SUITE)
    expect(detail.sourceId).toBe(USER_HOOKS_SOURCE)
    expect(detail.suiteId).toBe(USER_HOOKS_SUITE)
    expect(detail.hooks.count).toBe(0)
    expect(detail.hooks.entries).toEqual([])
    expect(detail.errors).toEqual([])
  })

  it('carries the malformed-file diagnostic through to the detail response', async () => {
    const agentsRoot = await root('market-hooks-detail-broken-')
    await writeFile(join(agentsRoot, 'hooks.json'), '{broken')
    const { reader: project } = await reader(agentsRoot, await root('market-hooks-detail-cwd-'))
    const detail = await project.suiteDetail(USER_HOOKS_SOURCE, USER_HOOKS_SUITE)
    expect(detail.hooks.count).toBe(0)
    expect(detail.errors).toEqual(['hooks.json: hook file is invalid JSON'])
  })

  it('keeps answering when the configuration declares events, without adopting the layout root\u2019s other surfaces', async () => {
    const agentsRoot = await root('market-hooks-detail-live-')
    await mkdir(join(agentsRoot, 'hooks'), { recursive: true })
    await writeFile(join(agentsRoot, 'hooks/hooks.json'), JSON.stringify({ PreToolUse: [hook('echo detail')] }))
    // The shared Agent layout root also carries documents and an LSP table; none of them are this configuration\u2019s surfaces.
    await mkdir(join(agentsRoot, 'commands/git'), { recursive: true })
    await writeFile(join(agentsRoot, 'commands/git/commit.md'), '---\ndescription: Commit.\n---\nCommit.')
    const { reader: project } = await reader(agentsRoot, await root('market-hooks-detail-cwd-'))
    const detail = await project.suiteDetail(USER_HOOKS_SOURCE, USER_HOOKS_SUITE)
    expect(detail.hooks.count).toBe(1)
    expect(detail.hooks.entries[0]).toMatchObject({ event: 'PreToolUse', command: 'echo detail' })
    expect(detail.commands).toEqual([])
    expect(detail.agents).toEqual([])
    expect(detail.skills).toEqual([])
    expect(detail.mcpServers).toEqual([])
    expect(detail.errors).toEqual([])
  })

  it('still misses an unknown suite id instead of answering the hooks configuration', async () => {
    const agentsRoot = await root('market-hooks-detail-miss-')
    await writeFile(join(agentsRoot, 'hooks.json'), JSON.stringify({ PreToolUse: [hook('echo detail')] }))
    const { reader: project } = await reader(agentsRoot, await root('market-hooks-detail-cwd-'))
    await expect(project.suiteDetail(USER_HOOKS_SOURCE, 'other-suite')).rejects.toThrow('project suite not found')
    await expect(project.suiteDetail('native', USER_HOOKS_SUITE)).rejects.toThrow('project suite not found')
  })

  it('serves the empty configuration detail over the suite route instead of the former 404', async () => {
    const agentsRoot = await root('market-hooks-detail-route-empty-')
    const cwd = await root('market-hooks-detail-route-cwd-')
    const { reader: project, catalog } = await reader(agentsRoot, cwd)
    const { routes, dispose } = mountRoutes(catalog, project, cwd)
    try {
      const output = response()
      await routes.get(MARKET_ROUTES.suite)!({ ...getRequest(hooksDetailQuery + 'session-a') }, output)
      expect(output.status()).toBe(200)
      expect(output.value()).toMatchObject({ sourceId: USER_HOOKS_SOURCE, suiteId: USER_HOOKS_SUITE, hooks: { count: 0, entries: [] }, errors: [] })
    } finally {
      dispose()
    }
  })

  it('serves the malformed-file diagnostic over the suite route with ok status', async () => {
    const agentsRoot = await root('market-hooks-detail-route-broken-')
    await writeFile(join(agentsRoot, 'hooks.json'), '{broken')
    const cwd = await root('market-hooks-detail-route-cwd-')
    const { reader: project, catalog } = await reader(agentsRoot, cwd)
    const { routes, dispose } = mountRoutes(catalog, project, cwd)
    try {
      const output = response()
      await routes.get(MARKET_ROUTES.suite)!({ ...getRequest(hooksDetailQuery + 'session-a') }, output)
      expect(output.status()).toBe(200)
      expect(output.value()).toMatchObject({ hooks: { count: 0, entries: [] }, errors: ['hooks.json: hook file is invalid JSON'] })
    } finally {
      dispose()
    }
  })

  it('reads the detail without writing catalog state, data, or the agents layout root', async () => {
    const agentsRoot = await root('market-hooks-detail-readonly-')
    await mkdir(join(agentsRoot, 'hooks'), { recursive: true })
    await writeFile(join(agentsRoot, 'hooks/hooks.json'), JSON.stringify({ PreToolUse: [hook('echo readonly')] }))
    const cwd = await root('market-hooks-detail-readonly-cwd-')
    const { reader: project, catalog } = await reader(agentsRoot, cwd)
    const { routes, dispose } = mountRoutes(catalog, project, cwd)
    try {
      const before = {
        user: await treeSnapshot(catalog.userRoot),
        data: await treeSnapshot(catalog.dataRoot),
        agents: await treeSnapshot(agentsRoot)
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        const output = response()
        await routes.get(MARKET_ROUTES.suite)!({ ...getRequest(hooksDetailQuery + 'session-a') }, output)
        expect(output.status()).toBe(200)
      }
      expect(await treeSnapshot(catalog.userRoot)).toEqual(before.user)
      expect(await treeSnapshot(catalog.dataRoot)).toEqual(before.data)
      expect(await treeSnapshot(agentsRoot)).toEqual(before.agents)
      expect(detailIsReadOnly(await project.suiteDetail(USER_HOOKS_SOURCE, USER_HOOKS_SUITE))).toBe(true)
    } finally {
      dispose()
    }
  })
})

/** The detail answer itself must stay a read-only projection: nothing installed, nothing enabled, no override surface. */
function detailIsReadOnly(detail: SuiteDetail): boolean {
  return (
    detail.installed === false && detail.enabled === false && detail.mcpOverrides !== undefined && Object.keys(detail.mcpOverrides).length === 0 && detail.surfaceToggles !== null
  )
}
