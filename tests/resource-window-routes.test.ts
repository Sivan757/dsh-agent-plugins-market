import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountResourceRoutes, type ResourceRouteDeps } from '../packages/market-bundle/src/routes-resources.js'
import { ResourceFilterService } from '../packages/market-runtime/src/runtime/host/resource-filter-service.js'
import { buildResourceWindow } from '../packages/market-bundle/src/application/resource-inventory.js'
import { ALL_SURFACES_ON } from '../packages/market-contracts/src/contracts/surface-toggles.js'
import type { ResourceWindowPayload } from '../packages/market-contracts/src/contracts/resource-window.js'
import type { McpStatusPayload } from '../packages/market-contracts/src/contracts/mcp-status.js'
import type { LspStatusPayload } from '../packages/market-contracts/src/contracts/lsp-status.js'
import type { UserPanelEntryWire } from '../packages/market-contracts/src/contracts/market.js'
import type { PanelResourceStore } from '../packages/market-runtime/src/application/panel-resources.js'

type Handler = (req: unknown, res: unknown) => void
type RecordedRoutes = Map<string, { handler: Handler }>

function fakeHost(): { host: Record<string, unknown>; routes: RecordedRoutes } {
  const routes: RecordedRoutes = new Map<string, { handler: Handler }>()
  const host = {
    webServer: {
      register(entry: { path: string; handler: Handler }): () => void {
        routes.set(entry.path, { handler: entry.handler })
        return () => routes.delete(entry.path)
      }
    }
  }
  return { host, routes }
}

/** A catalog double with one installed suite, one MCP row, one LSP row. */
function catalogDouble() {
  return {
    overview: async () => ({
      sources: [],
      suites: [
        {
          sourceId: 'demo',
          suiteId: 'alpha',
          name: 'Alpha suite',
          version: '1.0.0',
          description: 'demo suite',
          keywords: [],
          surfaces: { skills: 2, mcp: 1, hooks: 0, commands: 1, agents: 0, lsp: 1 },
          enabled: true,
          installed: true,
          dimension: 'user',
          layout: 'agent-plugin-v1',
          errors: []
        }
      ],
      totals: { all: 1, installed: 1, enabled: 1 },
      roots: { user: '/u', data: '/d' }
    }),
    mcpStatus: async () => ({
      entries: [{ id: 'demo/alpha/db', name: 'alpha__db', kind: 'plugin', state: 'connected', source: 'demo', transport: 'stdio', tools: [] }],
      observedAt: '2026-10-03T00:00:00.000Z',
      totals: { all: 1, connected: 1, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
      directObservationOnly: false
    }),
    lspStatus: async () => ({
      entries: [
        {
          id: 'demo/alpha/typescript',
          serverKey: 'typescript',
          suiteId: 'demo/alpha',
          suiteName: 'Alpha suite',
          sourceId: 'demo',
          kind: 'plugin',
          command: 'typescript-language-server',
          args: [],
          extensions: {},
          state: 'mounted'
        }
      ],
      observedAt: '2026-10-03T00:00:00.000Z',
      totals: { all: 1, mounted: 1, failed: 0, blocked: 0, disabled: 0 },
      hostMissing: false
    })
  }
}

function panelDouble(names: string[], disabled = false): PanelResourceStore {
  const entries = (): UserPanelEntryWire[] =>
    names.map(name => ({
      name,
      description: name + ' entry',
      disabled,
      origin: 'user',
      rawText: '',
      metadata: {},
      path: '/nowhere',
      content: ''
    }))
  const list = async (): Promise<UserPanelEntryWire[]> => entries()
  return {
    // A panel read reports its translation count beside the rows; these stubs
    // serve settled text, so the count is always zero.
    read: async () => ({ entries: await list(), translationPending: 0 }),
    list,
    get: async name => (await list()).find(entry => entry.name === name),
    create: async () => (await list())[0]!,
    update: async () => {},
    remove: async () => {},
    // These stubs serve settled text, so the document read answers with an
    // empty body and nothing left in flight.
    translateDocument: async () => ({ text: '', pending: 0 })
  }
}

async function makeDeps(): Promise<{ deps: ResourceRouteDeps; service: ResourceFilterService }> {
  const dataRoot = await mkdtemp(join(tmpdir(), 'resource-routes-'))
  const service = new ResourceFilterService(dataRoot, '/ws/routes', { onFiltersChanged: () => {} })
  await service.reload()
  const deps: ResourceRouteDeps = {
    catalog: catalogDouble() as never,
    panels: { skills: panelDouble(['dsh-doc']), commands: panelDouble(['/market']), agents: panelDouble(['test-engineer']) },
    filters: service,
    workspace: '/ws/routes',
    setEntry: (face, entryId, enabled) => service.setEntry(face, entryId, enabled),
    applyFavorite: async id => {
      const favorite = (await service.favorites()).find(entry => entry.id === id)
      if (favorite === undefined) throw new Error('favorite not found')
      const offEntries: Record<string, string[]> = {}
      for (const entry of favorite.offEntries) {
        const face = entry.slice(0, entry.indexOf(':'))
        ;(offEntries[face] ??= []).push(entry)
      }
      await service.applyFilters(favorite.surfaces, offEntries)
    },
    resetWorkspace: async () => {
      await service.applyFilters({ ...ALL_SURFACES_ON }, {})
    },
    saveFavorite: async name => {
      const filters = service.currentFilters()
      const offEntries = Object.entries(filters.offEntries).flatMap(([, ids]) => ids ?? [])
      return (await service.saveFavorite({ name, surfaces: filters.toggles, offEntries })).id
    },
    deleteFavorite: id => service.deleteFavorite(id)
  }
  return { deps, service }
}

interface Answer {
  status: number
  body: Record<string, unknown>
}

async function post(routes: RecordedRoutes, path: string, body: Record<string, unknown>): Promise<Answer> {
  let status = 0
  let payload = ''
  const request = {
    method: 'POST',
    url: path,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
    on: (event: string, listener: (chunk?: unknown) => void) => {
      if (event === 'data') listener(Buffer.from(JSON.stringify(body), 'utf8'))
      if (event === 'end') listener()
    },
    destroy: () => {}
  }
  const response = {
    writeHead: (code: number) => {
      status = code
    },
    end: (text: string) => {
      payload = text
    }
  }
  routes.get(path)?.handler(request, response)
  // The registered handler is fire-and-forget async; poll until the recorded
  // response lands so the assertion observes the handler's own output.
  const deadline = Date.now() + 5000
  while (payload === '' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  return { status, body: JSON.parse(payload) as Record<string, unknown> }
}

async function getWindow(routes: RecordedRoutes): Promise<ResourceWindowPayload> {
  let payload = ''
  routes.get('/api/agent-plugins/resource-window')?.handler(
    {},
    {
      writeHead: () => {},
      end: (body: string) => {
        payload = body
      }
    }
  )
  const deadline = Date.now() + 5000
  while (payload === '' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
  return JSON.parse(payload) as ResourceWindowPayload
}

describe('resource window routes', () => {
  it('registers the five routes and serves the installed inventory', async () => {
    const { deps } = await makeDeps()
    const { host, routes } = fakeHost()
    const dispose = mountResourceRoutes(host, deps)
    expect(routes.get('/api/agent-plugins/resource-window')).toBeDefined()
    expect(routes.get('/api/agent-plugins/resource-window/entry')).toBeDefined()
    expect(routes.get('/api/agent-plugins/resource-window/favorites/apply')).toBeDefined()
    expect(routes.get('/api/agent-plugins/resource-window/favorites/save')).toBeDefined()
    expect(routes.get('/api/agent-plugins/resource-window/favorites/delete')).toBeDefined()
    const window = await getWindow(routes)
    expect(window.workspace).toBe('/ws/routes')
    // One row per face: the suite, the skill, the command, the agent, the MCP server, the LSP server.
    expect(window.entries.map(entry => entry.face)).toEqual(['market', 'skills', 'commands', 'agents', 'mcp', 'lsp'])
    expect(window.entries.every(entry => entry.enabled)).toBe(true)
    expect(window.favorites).toEqual([])
    dispose()
  })

  it('flips one entry and answers with the refreshed window', async () => {
    const { deps } = await makeDeps()
    const { host, routes } = fakeHost()
    const dispose = mountResourceRoutes(host, deps)
    const answer = await post(routes, '/api/agent-plugins/resource-window/entry', { face: 'mcp', entryId: 'mcp:alpha__db', enabled: false })
    expect(answer.status).toBe(200)
    const window = answer.body.window as ResourceWindowPayload
    const row = window.entries.find(entry => entry.id === 'mcp:alpha__db')
    expect(row?.enabled).toBe(false)
    // Every other row keeps its state: the deny is per entry.
    expect(window.entries.filter(entry => entry.enabled)).toHaveLength(5)
    dispose()
  })

  it('rejects an unknown face, a missing entry id, and a non-boolean enabled', async () => {
    const { deps } = await makeDeps()
    const { host, routes } = fakeHost()
    const dispose = mountResourceRoutes(host, deps)
    const badFace = await post(routes, '/api/agent-plugins/resource-window/entry', { face: 'nope', entryId: 'x', enabled: false })
    expect(badFace.status).toBe(400)
    expect(badFace.body.error).toBe('invalid resource face')
    const noId = await post(routes, '/api/agent-plugins/resource-window/entry', { face: 'mcp', enabled: false })
    expect(noId.status).toBe(400)
    const badEnabled = await post(routes, '/api/agent-plugins/resource-window/entry', { face: 'mcp', entryId: 'x', enabled: 'false' })
    expect(badEnabled.status).toBe(400)
    dispose()
  })

  it('saves, applies, and deletes a favorite through the window state', async () => {
    const { deps } = await makeDeps()
    const { host, routes } = fakeHost()
    const dispose = mountResourceRoutes(host, deps)
    // Deny one entry, then snapshot.
    await post(routes, '/api/agent-plugins/resource-window/entry', { face: 'skills', entryId: 'skills:dsh-doc', enabled: false })
    const saved = await post(routes, '/api/agent-plugins/resource-window/favorites/save', { name: 'daily' })
    expect(saved.status).toBe(200)
    expect(typeof saved.body.favoriteId).toBe('string')
    const favoriteId = saved.body.favoriteId as string
    // Applying the favorite restores the snapshot exactly.
    const applied = await post(routes, '/api/agent-plugins/resource-window/favorites/apply', { id: favoriteId })
    expect(applied.status).toBe(200)
    const reapplied = applied.body.window as ResourceWindowPayload
    expect(reapplied.entries.find(entry => entry.id === 'skills:dsh-doc')?.enabled).toBe(false)
    // Deleting the favorite leaves the workspace state untouched.
    const deleted = await post(routes, '/api/agent-plugins/resource-window/favorites/delete', { id: favoriteId })
    expect(deleted.status).toBe(200)
    expect((deleted.body.window as ResourceWindowPayload).favorites).toEqual([])
    dispose()
  })

  it('rejects a blank favorite name and a missing favorite id', async () => {
    const { deps } = await makeDeps()
    const { host, routes } = fakeHost()
    const dispose = mountResourceRoutes(host, deps)
    const blank = await post(routes, '/api/agent-plugins/resource-window/favorites/save', { name: '   ' })
    expect(blank.status).toBe(400)
    const missing = await post(routes, '/api/agent-plugins/resource-window/favorites/apply', { id: 'not-there' })
    expect(missing.status).toBe(400)
    const noId = await post(routes, '/api/agent-plugins/resource-window/favorites/delete', { id: '' })
    expect(noId.status).toBe(400)
    dispose()
  })

  it('rejects a cross-origin mutation', async () => {
    const { deps } = await makeDeps()
    const { host, routes } = fakeHost()
    const dispose = mountResourceRoutes(host, deps)
    let status = 0
    let payload = ''
    const request = {
      method: 'POST',
      url: '/api/agent-plugins/resource-window/entry',
      headers: { host: '127.0.0.1', origin: 'http://evil.example' },
      on: (event: string, listener: (chunk?: unknown) => void) => {
        if (event === 'data') listener(Buffer.from('{}', 'utf8'))
        if (event === 'end') listener()
      },
      destroy: () => {}
    }
    routes.get('/api/agent-plugins/resource-window/entry')?.handler(request, {
      writeHead: (code: number) => {
        status = code
      },
      end: (body: string) => {
        payload = body
      }
    })
    const deadline = Date.now() + 5000
    while (payload === '' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5))
    expect(status).toBe(403)
    expect(JSON.parse(payload)).toMatchObject({ ok: false })
    dispose()
  })
})

describe('buildResourceWindow', () => {
  it('serves the plain installed inventory without any derived favorite state', async () => {
    const { deps, service } = await makeDeps()
    await service.saveFavorite({ name: 'A', surfaces: { ...ALL_SURFACES_ON }, offEntries: [] })
    // Favorites are presets the user applies; the payload carries no derived
    // "currently followed" favorite.
    expect(await buildResourceWindow(deps)).not.toHaveProperty('activeFavoriteId')
    await service.setEntry('mcp', 'mcp:alpha__db', false)
    expect(await buildResourceWindow(deps)).not.toHaveProperty('activeFavoriteId')
  })

  it('mirrors the user-level state: globally off entries read disabled and carry the flag', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'resource-routes-'))
    const service = new ResourceFilterService(dataRoot, '/ws/global', { onFiltersChanged: () => {} })
    await service.reload()
    const base = catalogDouble()
    const deps: ResourceRouteDeps = {
      catalog: {
        overview: async () => {
          const overview = await base.overview()
          return { ...overview, suites: overview.suites.map(suite => ({ ...suite, enabled: false })) }
        },
        mcpStatus: async () => {
          const status = await base.mcpStatus()
          return { ...status, entries: status.entries.map(row => ({ ...row, state: 'disabled' })) } as McpStatusPayload
        },
        lspStatus: async () => {
          const status = await base.lspStatus()
          return { ...status, entries: status.entries.map(row => ({ ...row, state: 'disabled' })) } as LspStatusPayload
        }
      },
      panels: {
        skills: panelDouble(['dsh-doc'], true),
        commands: panelDouble(['/market']),
        agents: panelDouble(['test-engineer'])
      },
      filters: service,
      workspace: '/ws/global',
      setEntry: (face, entryId, enabled) => service.setEntry(face, entryId, enabled),
      applyFavorite: async () => {},
      resetWorkspace: async () => {},
      saveFavorite: async () => 'x',
      deleteFavorite: async () => {}
    }
    const window = await buildResourceWindow(deps)
    // Follow-global: the window mirrors the user-level state exactly — every
    // row its source surface reports off reads disabled with the flag set.
    const market = window.entries.find(entry => entry.face === 'market')!
    expect(market.globalDisabled).toBe(true)
    expect(market.enabled).toBe(false)
    const skill = window.entries.find(entry => entry.id === 'skills:dsh-doc')!
    expect(skill.globalDisabled).toBe(true)
    expect(skill.enabled).toBe(false)
    const mcp = window.entries.find(entry => entry.face === 'mcp')!
    expect(mcp.globalDisabled).toBe(true)
    const lsp = window.entries.find(entry => entry.face === 'lsp')!
    expect(lsp.globalDisabled).toBe(true)
    // A workspace filter stacks on top; it can filter further, never re-enable.
    await service.setEntry('skills', 'skills:dsh-doc', true)
    const filtered = await buildResourceWindow(deps)
    const filteredSkill = filtered.entries.find(entry => entry.id === 'skills:dsh-doc')!
    expect(filteredSkill.enabled).toBe(false)
    expect(filteredSkill.globalDisabled).toBe(true)
  })
})
