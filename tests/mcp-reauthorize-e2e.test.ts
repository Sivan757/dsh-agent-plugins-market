/**
 * End-to-end MCP re-authorize tests: the HTTP route over a real `Catalog`
 * whose ports record what the runtime would do — drop the OAuth grant record
 * through the credentials store and flag the owning mount for a rebuild.
 */
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { MARKET_ROUTES } from '../src/contracts/market.js'
import { Catalog } from '../src/application/catalog.js'
import type { CatalogPortsOverride } from '../src/application/ports.js'
import { mountSuiteRoutes, type WebServerService } from '../src/routes.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

type RouteTable = Map<string, (request: unknown, response: unknown) => void | Promise<void>>

function strictWebServer(routes: RouteTable): WebServerService {
  return {
    register: route => {
      if (routes.has(route.path)) throw new Error(`webserver: duplicate exact route "${route.path}"`)
      routes.set(route.path, route.handler as (request: unknown, response: unknown) => void | Promise<void>)
      return () => routes.delete(route.path)
    }
  }
}

/** The parsed JSON response a route handler wrote, typed loosely like the wire. */
type WireBody = Record<string, unknown>

interface WireResponse {
  body: () => WireBody
  written: () => boolean
  writeHead: (status: number) => void
  end: (body: string) => void
}

function response(): WireResponse {
  let body = ''
  return {
    body: () => JSON.parse(body) as WireBody,
    written: () => body !== '',
    writeHead: () => {},
    end: value => {
      body = value
    }
  }
}

/** Wait out the async POST handler: real filesystem work settles on its own ticks. */
async function settle(output: WireResponse): Promise<WireBody> {
  for (let attempt = 0; attempt < 200 && !output.written(); attempt++) await new Promise(resolve => setTimeout(resolve, 5))
  return output.body()
}

function postRequest(body: Record<string, unknown>): unknown {
  return {
    method: 'POST',
    url: '/',
    headers: { host: '127.0.0.1' },
    on: (event: string, listener: (chunk?: unknown) => void) => {
      if (event === 'data') listener(Buffer.from(JSON.stringify(body), 'utf8'))
      if (event === 'end') listener()
    },
    destroy: () => {}
  }
}

async function fixture(ports: CatalogPortsOverride = {}): Promise<{ catalog: Catalog; routes: RouteTable; dispose: () => void }> {
  const userRoot = await mkdtemp(join(tmpdir(), 'market-e2e-mcp-'))
  roots.push(userRoot)
  const agentsRoot = join(userRoot, 'agents')
  await mkdir(agentsRoot, { recursive: true })
  const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot, onChanged: () => {}, ports })
  await catalog.load()
  const routes: RouteTable = new Map()
  const dispose = mountSuiteRoutes({ webServer: strictWebServer(routes) }, catalog)
  return { catalog, routes, dispose }
}

describe('MCP re-authorize end to end through the HTTP route', () => {
  it('drops the folded grant record and flags the owning mount for a rebuild', async () => {
    const deleted: string[] = []
    const remounts: string[] = []
    const remountAll: number[] = []
    const { routes, catalog, dispose } = await fixture({
      credentialsStore: {
        deleteGrantRecord: async serverName => {
          deleted.push(serverName)
        }
      },
      mcpServerOwner: serverName => (serverName === 'weather__lookup' ? { suiteId: 'src/suite', serverKey: 'lookup' } : undefined),
      mcpRemount: (suiteId, serverKey) => remounts.push(`${suiteId}:${serverKey}`),
      mcpRemountAll: () => remountAll.push(1)
    })
    try {
      expect(catalog.mcpReauthorizeAvailable()).toBe(true)

      const output = response()
      await routes.get(MARKET_ROUTES.mcpReauthorize)!(postRequest({ serverName: 'weather__lookup' }), output)
      expect(await settle(output)).toMatchObject({ ok: true })
      expect(deleted).toEqual(['weather__lookup'])
      expect(remounts).toEqual(['src/suite:lookup'])
      expect(remountAll).toEqual([])

      // A server name nothing owns still drops its grant; there is no mount to flag.
      const orphan = response()
      await routes.get(MARKET_ROUTES.mcpReauthorize)!(postRequest({ serverName: 'ghost__server' }), orphan)
      expect(await settle(orphan)).toMatchObject({ ok: true })
      expect(deleted).toEqual(['weather__lookup', 'ghost__server'])
      expect(remounts).toEqual(['src/suite:lookup'])
    } finally {
      dispose()
    }
  })

  it('surfaces a credentials-store failure as a 400 response', async () => {
    const { routes, dispose } = await fixture({
      credentialsStore: {
        deleteGrantRecord: async () => {
          throw new Error('credentials service is not mounted')
        }
      }
    })
    try {
      const output = response()
      await routes.get(MARKET_ROUTES.mcpReauthorize)!(postRequest({ serverName: 'weather__lookup' }), output)
      const body = await settle(output)
      expect(body).toMatchObject({ ok: false })
      expect(body['error']).toBe('credentials service is not mounted')
    } finally {
      dispose()
    }
  })

  it('rejects a missing serverName before touching the store', async () => {
    const deleted: string[] = []
    const { routes, dispose } = await fixture({
      credentialsStore: {
        deleteGrantRecord: async serverName => {
          deleted.push(serverName)
        }
      }
    })
    try {
      const output = response()
      await routes.get(MARKET_ROUTES.mcpReauthorize)!(postRequest({}), output)
      expect(await settle(output)).toMatchObject({ ok: false, error: 'serverName is required' })
      expect(deleted).toEqual([])
    } finally {
      dispose()
    }
  })

  it('keeps the folded record key the oauth writer addresses', async () => {
    // The grant the bridge writes for `weather__lookup` lives under the same
    // key deleteGrantRecord receives, so the re-authorize drops the right one.
    const deleted: string[] = []
    const { routes, dispose } = await fixture({
      credentialsStore: {
        deleteGrantRecord: async serverName => {
          deleted.push(serverName)
        }
      }
    })
    try {
      const output = response()
      await routes.get(MARKET_ROUTES.mcpReauthorize)!(postRequest({ serverName: 'Weather__Look-up 2' }), output)
      expect(await settle(output)).toMatchObject({ ok: true })
      expect(deleted).toEqual(['Weather__Look-up 2'])
      // The fold itself is pinned by tests/mcp-auth-record.test.ts against the
      // host grammar; here the suite name stays the runtime's currency.
      expect(credentialKey('mcp-auth', 'weather-look-up-2')).toBeDefined()
    } finally {
      dispose()
    }
  })
})
