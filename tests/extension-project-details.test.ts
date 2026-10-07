/** Project full details must answer for one session's workspace without hiding the user catalog. */
import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  MARKET_ROUTES,
  userPanelRoute,
  userPanelTranslationRoute,
  type SuiteDetail,
  type UserPanelEntryWire,
  type UserPanelKind
} from '../packages/market-contracts/src/contracts/market.js'
import type { McpStatusPayload } from '../packages/market-mcp/src/application/mcp/mcp-status.js'
import type { LspStatusPayload } from '../packages/market-contracts/src/contracts/lsp-status.js'
import type { MarketService } from '../packages/market-contracts/src/ports/queries.js'
import type { PanelRead, PanelResourceStore } from '../packages/market-runtime/src/application/panel-resources.js'
import type { ProjectExtensionReader } from '../packages/market-bundle/src/application/extension-project.js'
import { mountSuiteRoutes, type SuiteRouteSessionResolver, type WebServerService } from '../packages/market-bundle/src/routes.js'

type RouteTable = Map<string, (request: unknown, response: unknown) => void | Promise<void>>

const mcpPayload = (marker: string, entries: McpStatusPayload['entries'] = []): McpStatusPayload => ({
  entries,
  observedAt: marker,
  totals: { all: entries.length, connected: entries.length, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
  directObservationOnly: true
})
const lspPayload = (marker: string, entries: LspStatusPayload['entries'] = []): LspStatusPayload => ({
  entries,
  observedAt: marker,
  totals: { all: entries.length, mounted: entries.length, failed: 0, blocked: 0, disabled: 0 },
  hostMissing: false
})
const mcpEntry = (id: string): McpStatusPayload['entries'][number] => ({ id, state: 'connected' }) as unknown as McpStatusPayload['entries'][number]
const lspEntry = (id: string): LspStatusPayload['entries'][number] => ({ id, state: 'mounted' }) as unknown as LspStatusPayload['entries'][number]

/** One panel store per origin marker, so a route's answer names the store it consulted. */
function panelStore(marker: string): PanelResourceStore {
  return {
    read: async (): Promise<PanelRead> => ({ entries: [], translationPending: 0 }),
    list: async (): Promise<UserPanelEntryWire[]> => [],
    get: async (id: string) => ({ id, name: marker + ':' + id }) as unknown as UserPanelEntryWire,
    translateDocument: async (id: string) => ({ text: marker + ':' + id, pending: 0 }),
    create: async (name: string) => ({ id: name, name: marker + ':' + name }) as unknown as UserPanelEntryWire,
    update: async () => {},
    remove: async () => {}
  }
}

/** A project reader standing in for one session's workspace; the real one reads that cwd's catalog. */
function projectReader(marker: string): ProjectExtensionReader {
  return {
    panels: { skills: panelStore(marker), commands: panelStore(marker), agents: panelStore(marker) },
    suites: async () => [],
    suiteDetail: async () => ({ workspace: marker, source: 'project' }) as unknown as SuiteDetail,
    suiteDocument: async (sourceId: string, suiteId: string, kind: UserPanelKind, name: string) => ({ name, content: marker + ':' + kind + ':' + name }),
    suiteDocumentTranslation: async (sourceId: string, suiteId: string, kind: UserPanelKind, name: string) => ({ text: marker + ':' + kind + ':' + name, pending: 0 }),
    mcpStatus: async () => mcpPayload(marker, [mcpEntry('plugin:' + marker + '/server')]),
    lspStatus: async () => lspPayload(marker, [lspEntry('lsp:' + marker)])
  }
}

function agentAt(cwd?: string): Agent {
  return { session: { header: cwd === undefined ? {} : { cwd } } } as unknown as Agent
}

function marketService(): MarketService {
  return {
    sources: [],
    overview: async () => ({ sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '/user', data: '/data' } }),
    mcpStatus: async () => mcpPayload('global', [mcpEntry('direct:user')]),
    lspStatus: async () => lspPayload('global', [lspEntry('lsp:direct/user')]),
    sourceProgress: () => ({ active: false, sourceId: '', step: '' }),
    serverConfig: async (kind, id) => ({ kind, id, key: 'service', editable: true, config: {} }),
    clearTranslations: async () => {},
    lspServers: async () => ({}),
    mcpOverrides: async () => ({}),
    suiteDetail: async () => ({ workspace: 'global', source: 'user' }) as unknown as SuiteDetail,
    suiteDocument: async (_sourceId: string, _suiteId: string, _kind: UserPanelKind, name: string) => ({ name, content: 'global:' + name }),
    suiteDocumentTranslation: async (_sourceId: string, _suiteId: string, _kind: UserPanelKind, name: string) => ({ text: 'global:' + name, pending: 0 }),
    addSource: async input => ({ id: 'source', ...input }),
    updateSource: async () => {},
    removeSource: async () => {},
    adoptSource: async id => ({ id, url: 'https://github.com/example/' + id, kind: 'git' as const, adopted: true as const }),
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
    migrateLegacyLspSeam: async profile => ({ profile, patchPath: '/p', backupPath: '/p.bak', restartRequired: false }),
    retryMounts: async () => {},
    reauthorizeMcpServer: async () => {},
    mcpReauthorizeAvailable: () => true,
    mcpBackendInfo: async () => ({
      backend: 'builtin' as const,
      hostClient: { available: true, version: '0.1.1-rc.2' },
      downloadRegion: { setting: 'auto' as const, effective: 'global' as const }
    }),
    setMcpBackend: async () => {},
    menuRowFaces: async () => [],
    notifyPanelsChanged: async () => {}
  }
}

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
interface RequestStub {
  method: string
  url: string
  headers: Record<string, string>
}
const hostHeaders = { host: '127.0.0.1', origin: 'http://127.0.0.1' }
const getRequest = (url: string): RequestStub => ({ method: 'GET', url, headers: hostHeaders })
const postRequest = (url: string, body: Record<string, unknown>): RequestStub =>
  ({
    method: 'POST',
    url,
    headers: hostHeaders,
    on: (event: string, listener: (chunk?: unknown) => void) => {
      if (event === 'data') listener(Buffer.from(JSON.stringify(body), 'utf8'))
      if (event === 'end') listener()
    },
    destroy: () => {}
  }) as RequestStub
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

function mount(session?: SuiteRouteSessionResolver) {
  const routes: RouteTable = new Map()
  const manager = marketService()
  const panels = { skills: panelStore('global'), commands: panelStore('global'), agents: panelStore('global') }
  const dispose = mountSuiteRoutes({ webServer: strictWebServer(routes) }, manager, panels, undefined, session)
  return { routes, manager, panels, dispose }
}
const suiteQuery = 'sourceId=shared&suiteId=shared'

describe('project detail reads answer for one session workspace', () => {
  it('answers each live session from its own workspace for the same identifiers', async () => {
    const sessions = new Map<string, Agent>([
      ['session-a', agentAt('/workspace/a')],
      ['session-b', agentAt('/workspace/b')]
    ])
    const readers = new Map<string, ProjectExtensionReader>([
      ['session-a', projectReader('a')],
      ['session-b', projectReader('b')]
    ])
    const asked: string[] = []
    const { routes } = mount({
      agent: sessionId => sessions.get(sessionId),
      project: agent => {
        const cwd = (agent.session.header as { cwd?: string }).cwd ?? ''
        asked.push(cwd)
        return readers.get(cwd.endsWith('/a') ? 'session-a' : 'session-b')!
      }
    })
    const first = response()
    await routes.get(MARKET_ROUTES.suite)!({ ...getRequest(MARKET_ROUTES.suite + '?' + suiteQuery + '&sessionId=session-a') }, first)
    const second = response()
    await routes.get(MARKET_ROUTES.suite)!({ ...getRequest(MARKET_ROUTES.suite + '?' + suiteQuery + '&sessionId=session-b') }, second)
    expect(first.value()).toMatchObject({ workspace: 'a' })
    expect(second.value()).toMatchObject({ workspace: 'b' })
    expect(asked).toEqual(['/workspace/a', '/workspace/b'])
  })

  it('refuses an unresolvable session instead of falling back to the global catalog', async () => {
    const calls: string[] = []
    const { routes, manager } = mount({ agent: sessionId => (sessionId === 'known' ? agentAt(undefined) : undefined) })
    manager.suiteDetail = async () => {
      calls.push('global')
      throw new Error('not found')
    }
    const cases: Array<[string, string]> = [
      ['sessionId=unknown', 'no live session'],
      ['sessionId=known', 'no absolute workspace']
    ]
    for (const [query, message] of cases) {
      const output = response()
      await routes.get(MARKET_ROUTES.suite)!({ ...getRequest(MARKET_ROUTES.suite + '?' + suiteQuery + '&' + query) }, output)
      expect(output.status()).toBe(404)
      expect(String(output.value()['error'])).toContain(message)
    }
    const unwired = mount({ agent: () => agentAt('/workspace/a') })
    const output = response()
    await unwired.routes.get(MARKET_ROUTES.suite)!({ ...getRequest(MARKET_ROUTES.suite + '?' + suiteQuery + '&sessionId=any') }, output)
    expect(output.status()).toBe(404)
    expect(String(output.value()['error'])).toContain('session-scoped project reads are unavailable')
    const bare = mount()
    const bareOutput = response()
    await bare.routes.get(MARKET_ROUTES.suite)!({ ...getRequest(MARKET_ROUTES.suite + '?' + suiteQuery + '&sessionId=any') }, bareOutput)
    expect(bareOutput.status()).toBe(404)
    expect(calls).toEqual([])
  })

  it('keeps the existing global read when the request names no session', async () => {
    let consulted = 0
    let globalCalls = 0
    const { routes, manager } = mount({
      agent: () => {
        consulted++
        return agentAt('/workspace/a')
      },
      project: () => projectReader('a')
    })
    manager.suiteDetail = async () => {
      globalCalls++
      return { workspace: 'global', source: 'user' } as unknown as SuiteDetail
    }
    const output = response()
    await routes.get(MARKET_ROUTES.suite)!({ ...getRequest(MARKET_ROUTES.suite + '?' + suiteQuery) }, output)
    expect(output.value()).toMatchObject({ workspace: 'global' })
    const mcp = response()
    await routes.get(MARKET_ROUTES.mcpStatus)!({ ...getRequest(MARKET_ROUTES.mcpStatus) }, mcp)
    expect(mcp.value()).toMatchObject({ observedAt: 'global' })
    expect(consulted).toBe(0)
    expect(globalCalls).toBe(1)
  })

  it('serves a user-dimension resource that merely rode along with a session', async () => {
    const reader = projectReader('a')
    reader.suiteDetail = async () => {
      throw new Error('project suite not found')
    }
    const { routes } = mount({ agent: () => agentAt('/workspace/a'), project: () => reader })
    const output = response()
    await routes.get(MARKET_ROUTES.suite)!({ ...getRequest(MARKET_ROUTES.suite + '?' + suiteQuery + '&sessionId=session-a') }, output)
    expect(output.status()).toBe(200)
    expect(output.value()).toMatchObject({ workspace: 'global', source: 'user' })
  })

  it('ignores a workspace supplied by the request', async () => {
    const asked: string[] = []
    const { routes } = mount({
      agent: () => agentAt('/workspace/a'),
      project: agent => {
        asked.push((agent.session.header as { cwd?: string }).cwd ?? '')
        return projectReader('a')
      }
    })
    const output = response()
    await routes.get(MARKET_ROUTES.suite)!({ ...getRequest(MARKET_ROUTES.suite + '?' + suiteQuery + '&sessionId=session-a&cwd=/workspace/b') }, output)
    expect(output.value()).toMatchObject({ workspace: 'a' })
    expect(asked).toEqual(['/workspace/a'])
  })

  it('keeps the user catalog visible beside a session status view', async () => {
    const { routes } = mount({ agent: () => agentAt('/workspace/a'), project: () => projectReader('a') })
    const mcp = response()
    await routes.get(MARKET_ROUTES.mcpStatus)!({ ...getRequest(MARKET_ROUTES.mcpStatus + '?sessionId=session-a') }, mcp)
    const merged = mcp.value() as unknown as McpStatusPayload
    expect(merged.entries.map(entry => entry.id)).toEqual(['direct:user', 'plugin:a/server'])
    expect(merged.totals.all).toBe(2)
    const lsp = response()
    await routes.get(MARKET_ROUTES.lspStatus)!({ ...getRequest(MARKET_ROUTES.lspStatus + '?sessionId=session-a') }, lsp)
    expect((lsp.value() as unknown as LspStatusPayload).entries.map(entry => entry.id)).toEqual(['lsp:direct/user', 'lsp:a'])
  })

  it('scopes one suite document and its translation to the named session', async () => {
    const { routes } = mount({ agent: () => agentAt('/workspace/a'), project: () => projectReader('a') })
    // The document route answers from the session's workspace, on a query-carried session.
    const doc = response()
    await routes.get(MARKET_ROUTES.suiteDocument)!({ ...getRequest(MARKET_ROUTES.suiteDocument + '?sourceId=s&suiteId=s&kind=skills&name=k&sessionId=session-a') }, doc)
    expect(doc.value()).toMatchObject({ name: 'k', content: 'a:skills:k' })
    // Without a session the same route keeps answering from the global catalog.
    const globalDoc = response()
    await routes.get(MARKET_ROUTES.suiteDocument)!({ ...getRequest(MARKET_ROUTES.suiteDocument + '?sourceId=s&suiteId=s&kind=skills&name=k') }, globalDoc)
    expect(globalDoc.value()).toMatchObject({ content: 'global:k' })
    // The translation is scoped the same way; a POST answers on a later tick.
    const translation = response()
    await routes.get(MARKET_ROUTES.suiteDocumentTranslation)!(
      { ...postRequest(MARKET_ROUTES.suiteDocumentTranslation + '?sessionId=session-a', { sourceId: 's', suiteId: 's', kind: 'skills', name: 'k' }) },
      translation
    )
    await settle()
    expect(translation.value()).toMatchObject({ text: 'a:skills:k' })
    const globalTranslation = response()
    await routes.get(MARKET_ROUTES.suiteDocumentTranslation)!(
      { ...postRequest(MARKET_ROUTES.suiteDocumentTranslation, { sourceId: 's', suiteId: 's', kind: 'skills', name: 'k' }) },
      globalTranslation
    )
    await settle()
    expect(globalTranslation.value()).toMatchObject({ text: 'global:k' })
    // Panel reads keep their own session scoping.
    const entry = response()
    await routes.get(userPanelRoute('skills') + '/entry')!({ ...getRequest(userPanelRoute('skills') + '/entry?name=list&sessionId=session-a') }, entry)
    expect(entry.value()).toMatchObject({ entry: { name: 'a:list' } })
    const panelTranslation = response()
    await routes.get(userPanelTranslationRoute('skills'))!({ ...postRequest(userPanelTranslationRoute('skills') + '?sessionId=session-a', { name: 'list' }) }, panelTranslation)
    await settle()
    expect(panelTranslation.value()).toMatchObject({ text: 'a:list' })
  })
  it('leaves panel mutations on the global store whatever the request names', async () => {
    const writes: string[] = []
    const { routes, panels } = mount({ agent: () => agentAt('/workspace/a'), project: () => projectReader('a') })
    panels.skills.create = async (name: string) => {
      writes.push('global:' + name)
      return { id: name, name } as unknown as UserPanelEntryWire
    }
    const output = response()
    await routes.get(userPanelRoute('skills') + '/create')!({ ...postRequest(userPanelRoute('skills') + '/create?sessionId=session-a', { name: 'draft', text: 'body' }) }, output)
    await settle()
    expect(writes).toEqual(['global:draft'])
  })
})
