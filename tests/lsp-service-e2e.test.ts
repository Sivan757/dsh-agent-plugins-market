/**
 * End-to-end LSP service tests: the HTTP route layer over a real `Catalog`
 * working on real temporary directories. A request travels routes →
 * MarketService → LspService → lsp.json on disk and back, so the assertions
 * cover the same wire shapes the market page consumes. The full-table
 * replacement (no HTTP caller today) is covered at the application layer with
 * its documented `{ lspServers }` document shape.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MARKET_ROUTES } from '../src/contracts/market.js'
import { Catalog } from '../src/application/catalog.js'
import { mountSuiteRoutes, type WebServerService } from '../src/routes.js'
import { loadDisabledLspServers } from '../src/application/lsp/lsp-server-state.js'

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
  status: () => number
  written: () => boolean
  writeHead: (status: number) => void
  end: (body: string) => void
}

function response(): WireResponse {
  let status = 200
  let body = ''
  return {
    body: () => JSON.parse(body) as WireBody,
    status: () => status,
    written: () => body !== '',
    writeHead: code => {
      status = code
    },
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

interface Fixture {
  catalog: Catalog
  routes: RouteTable
  agentsRoot: string
  dataRoot: string
  dispose: () => void
}

/** Build the full stack: routes over a real catalog over real directories. */
async function fixture(): Promise<Fixture> {
  const userRoot = await mkdtemp(join(tmpdir(), 'market-e2e-lsp-'))
  roots.push(userRoot)
  const agentsRoot = join(userRoot, 'agents')
  const dataRoot = join(userRoot, 'data')
  await mkdir(agentsRoot, { recursive: true })
  const catalog = new Catalog({ userRoot, dataRoot, agentsRoot, onChanged: () => {} })
  await catalog.load()
  const routes: RouteTable = new Map()
  const dispose = mountSuiteRoutes({ webServer: strictWebServer(routes) }, catalog)
  return { catalog, routes, agentsRoot, dataRoot, dispose }
}

describe('the LSP service end to end through the HTTP routes', () => {
  it('creates, lists, reads back, and edits a direct server on disk', async () => {
    const { catalog, routes, agentsRoot, dataRoot, dispose } = await fixture()
    try {
      // Create: the route validates the name, persists the table, and the
      // lspServers GET answers with the normalized spec.
      const createResponse = response()
      await routes.get(MARKET_ROUTES.addLspServer)!(postRequest({ name: ' clangd ', config: { command: 'clangd', extensionToLanguage: { C: 'c' } } }), createResponse)
      expect(await settle(createResponse)).toMatchObject({ ok: true })

      const listResponse = response()
      await routes.get(MARKET_ROUTES.lspServers)!({ url: MARKET_ROUTES.lspServers, headers: {} }, listResponse)
      const listed = listResponse.body() as { lspServers: Record<string, { key: string; command: string; args: string[]; extensionToLanguage: Record<string, string> }> }
      expect(listed.lspServers['clangd']).toEqual({ key: 'clangd', command: 'clangd', args: [], extensionToLanguage: { '.c': 'c' } })

      const disk: unknown = JSON.parse(await readFile(join(agentsRoot, 'lsp.json'), 'utf8'))
      expect(disk).toMatchObject({ lspServers: { clangd: { command: 'clangd', extensionToLanguage: { '.c': 'c' } } } })

      // Edit: the config dialog reads the view through serverConfig, and saves
      // a single-server replacement back through the config save route.
      const readResponse = response()
      await routes.get(MARKET_ROUTES.serverConfig)!({ url: `${MARKET_ROUTES.serverConfig}?kind=lsp&id=direct%2Fclangd`, headers: {} }, readResponse)
      expect(readResponse.body()).toMatchObject({ kind: 'lsp', id: 'direct/clangd', editable: true, config: { command: 'clangd' } })

      const saveResponse = response()
      await routes.get(MARKET_ROUTES.saveServerConfig)!(
        postRequest({ kind: 'lsp', id: 'direct/clangd', config: { command: 'clangd', args: ['--log'], extensionToLanguage: { '.c': 'c', '.h': 'cpp' } } }),
        saveResponse
      )
      expect(await settle(saveResponse)).toMatchObject({ ok: true })
      const edited: unknown = JSON.parse(await readFile(join(agentsRoot, 'lsp.json'), 'utf8'))
      expect(edited).toMatchObject({ lspServers: { clangd: { args: ['--log'], extensionToLanguage: { '.c': 'c', '.h': 'cpp' } } } })

      // The enable switch writes its own state file under the data root; the
      // declaration in lsp.json is untouched.
      const disableResponse = response()
      await routes.get(`${MARKET_ROUTES.lspServers}/enabled`)!(postRequest({ id: 'direct/clangd', enabled: false }), disableResponse)
      expect(await settle(disableResponse)).toMatchObject({ ok: true })
      await expect(loadDisabledLspServers(dataRoot)).resolves.toEqual(new Set(['direct/clangd']))
      expect(JSON.parse(await readFile(join(agentsRoot, 'lsp.json'), 'utf8'))).toMatchObject({
        lspServers: { clangd: { args: ['--log'] } }
      })

      // Re-enable clears the switch again.
      const enableResponse = response()
      await routes.get(`${MARKET_ROUTES.lspServers}/enabled`)!(postRequest({ id: 'direct/clangd', enabled: true }), enableResponse)
      expect(await settle(enableResponse)).toMatchObject({ ok: true })
      await expect(loadDisabledLspServers(dataRoot)).resolves.toEqual(new Set())
      expect(catalog.isInstalled('direct', 'clangd')).toBe(false)
    } finally {
      dispose()
    }
  })

  it('rejects invalid names and tables without touching the file', async () => {
    const { routes, agentsRoot, dispose } = await fixture()
    try {
      const invalidConfig = 'invalid LSP configuration'
      const cases: Array<{ body: Record<string, unknown>; error: string }> = [
        { body: { name: 'bad name', config: { command: 'x', extensionToLanguage: { '.c': 'c' } } }, error: 'invalid LSP server name' },
        { body: { name: 'x'.repeat(65), config: { command: 'x', extensionToLanguage: { '.c': 'c' } } }, error: 'invalid LSP server name' },
        { body: { name: 'ok', config: { command: '', extensionToLanguage: { '.c': 'c' } } }, error: invalidConfig },
        { body: { name: 'ok', config: { command: 'clangd' } }, error: invalidConfig },
        { body: { config: { command: 'clangd', extensionToLanguage: { '.c': 'c' } } }, error: 'missing LSP server name' }
      ]
      for (const { body, error } of cases) {
        const output = response()
        await routes.get(MARKET_ROUTES.addLspServer)!(postRequest(body), output)
        const wire = await settle(output)
        expect(wire, JSON.stringify(body)).toMatchObject({ ok: false })
        expect(String(wire['error']), JSON.stringify(body)).toContain(error)
      }
      await expect(readFile(join(agentsRoot, 'lsp.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      dispose()
    }
  })

  it('serves the status surface with the rows it persisted', async () => {
    const { catalog, routes, dataRoot, dispose } = await fixture()
    try {
      await catalog.addLspServer('clangd', { command: 'clangd', extensionToLanguage: { '.c': 'c' } })
      await catalog.addLspServer('lua', { command: 'lua-language-server', extensionToLanguage: { '.lua': 'lua' } })
      await catalog.setLspServerEnabled('direct/lua', false)
      // The disable switch lives in the plugin data root state file.
      await expect(loadDisabledLspServers(dataRoot)).resolves.toEqual(new Set(['direct/lua']))

      const statusResponse = response()
      await routes.get(MARKET_ROUTES.lspStatus)!({ url: MARKET_ROUTES.lspStatus, headers: {} }, statusResponse)
      const payload = statusResponse.body() as {
        entries: Array<{ id: string; kind: string; state: string; command: string; extensions: Record<string, string>; suiteName: string }>
        totals: { all: number }
        hostMissing: boolean
      }
      expect(payload.entries.map(entry => entry.id).sort()).toEqual(['direct/clangd', 'direct/lua'])
      const lua = payload.entries.find(entry => entry.id === 'direct/lua')
      if (lua === undefined) throw new Error('expected the lua row to be listed')
      // No reconciler is attached in this composition, so unmounted rows read
      // as starting: a declaration with neither a diagnostic nor a live mount.
      expect(lua.state).toBe('starting')
      expect(lua.kind).toBe('direct')
      expect(lua.command).toBe('lua-language-server')
      expect(payload.totals.all).toBe(2)
      expect(payload.hostMissing).toBe(false)
    } finally {
      dispose()
    }
  })

  it('reports the unknown server and unknown profile paths as request errors', async () => {
    const { routes, dispose } = await fixture()
    try {
      const config = response()
      await routes.get(MARKET_ROUTES.serverConfig)!({ url: `${MARKET_ROUTES.serverConfig}?kind=lsp&id=direct%2Fghost`, headers: {} }, config)
      expect(config.status()).toBe(400)
      expect(config.body()).toMatchObject({ ok: false, error: 'LSP server not found' })

      const badKind = response()
      await routes.get(MARKET_ROUTES.serverConfig)!({ url: `${MARKET_ROUTES.serverConfig}?kind=yaml&id=x`, headers: {} }, badKind)
      expect(badKind.body()).toMatchObject({ ok: false, error: 'invalid service kind' })

      const migrate = response()
      await routes.get(MARKET_ROUTES.migrateLspSeam)!(postRequest({ profile: 'nope' }), migrate)
      const migration = await settle(migrate)
      expect(migration).toMatchObject({ ok: false })
      expect(migration.error).toContain('no longer registers an LSP layer')
    } finally {
      dispose()
    }
  })

  it('edits one suite-declared LSP server through the override file, never the checkout', async () => {
    const { catalog, routes, dataRoot, dispose } = await fixture()
    try {
      // A local source carrying a v1 manifest plus a lsp.json declaration.
      const sourceRoot = await mkdtemp(join(tmpdir(), 'market-e2e-lsp-src-'))
      roots.push(sourceRoot)
      await writeFile(
        join(sourceRoot, 'plugin.json'),
        JSON.stringify({
          $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
          name: 'lsp-suite',
          version: '1.0.0',
          description: 'suite declaring an LSP server'
        })
      )
      await writeFile(join(sourceRoot, 'lsp.json'), JSON.stringify({ lspServers: { clangd: { command: 'clangd', extensionToLanguage: { '.c': 'c' } } } }))
      await catalog.addSource({ url: sourceRoot, local: true })
      await catalog.install('lsp-suite', 'lsp-suite')

      // Read the declared config through the serverConfig route; the row id is
      // the source-qualified suite id plus the server key.
      const rowId = 'lsp-suite/lsp-suite/clangd'
      const readResponse = response()
      await routes.get(MARKET_ROUTES.serverConfig)!({ url: `${MARKET_ROUTES.serverConfig}?kind=lsp&id=${encodeURIComponent(rowId)}`, headers: {} }, readResponse)
      expect(readResponse.body()).toMatchObject({ kind: 'lsp', config: { command: 'clangd' } })

      // Save a replacement: it lands in the plugin data root overrides file.
      const saveResponse = response()
      await routes.get(MARKET_ROUTES.saveServerConfig)!(
        postRequest({ kind: 'lsp', id: rowId, config: { command: 'clangd-16', args: ['--pch-storage', 'memory'], extensionToLanguage: { '.c': 'c' } } }),
        saveResponse
      )
      expect(await settle(saveResponse)).toMatchObject({ ok: true })
      const overridesPath = join(dataRoot, 'lsp-overrides.json')
      expect(JSON.parse(await readFile(overridesPath, 'utf8'))).toMatchObject({
        [rowId]: { command: 'clangd-16', args: ['--pch-storage', 'memory'] }
      })

      // The read-back reflects the override.
      const reread = response()
      await routes.get(MARKET_ROUTES.serverConfig)!({ url: `${MARKET_ROUTES.serverConfig}?kind=lsp&id=${encodeURIComponent(rowId)}`, headers: {} }, reread)
      expect((reread.body() as { config: { command: string } }).config.command).toBe('clangd-16')

      // The status surface shows the suite row with the effective command.
      const statusResponse = response()
      await routes.get(MARKET_ROUTES.lspStatus)!({ url: MARKET_ROUTES.lspStatus, headers: {} }, statusResponse)
      const entries = (statusResponse.body() as { entries: Array<{ id: string; kind: string; state: string; command: string; suiteName: string }> }).entries
      const row = entries.find(entry => entry.id === rowId)
      if (row === undefined) throw new Error('expected the installed suite row to appear in the status payload')
      expect(row.kind).toBe('plugin')
      expect(row.command).toBe('clangd-16')
      expect(row.suiteName).toBe('lsp-suite')
    } finally {
      dispose()
    }
  })

  it('replaces the whole direct table through the application layer, atomically', async () => {
    const { catalog, routes, agentsRoot, dispose } = await fixture()
    try {
      // Seed one entry through the route, then replace the full table.
      await catalog.addLspServer('old', { command: 'old-server', extensionToLanguage: { '.old': 'old' } })
      const replaced = await catalog.setLspServers({
        lspServers: {
          clangd: { command: 'clangd', extensionToLanguage: { C: 'c' } },
          lua: { command: 'lua-language-server', args: ['-E'], extensionToLanguage: { '.lua': 'lua' } }
        }
      })
      expect(Object.keys(replaced).sort()).toEqual(['clangd', 'lua'])
      expect(replaced['clangd']?.extensionToLanguage).toEqual({ '.c': 'c' })

      const disk: unknown = JSON.parse(await readFile(join(agentsRoot, 'lsp.json'), 'utf8'))
      expect(disk).toMatchObject({ lspServers: { clangd: { command: 'clangd' }, lua: { command: 'lua-language-server' } } })
      expect(disk).not.toMatchObject({ lspServers: { old: {} } })

      const listResponse = response()
      await routes.get(MARKET_ROUTES.lspServers)!({ url: MARKET_ROUTES.lspServers, headers: {} }, listResponse)
      expect(Object.keys((listResponse.body() as { lspServers: Record<string, unknown> }).lspServers).sort()).toEqual(['clangd', 'lua'])

      // One bad row rejects the whole document and keeps the previous file.
      const before = await readFile(join(agentsRoot, 'lsp.json'), 'utf8')
      await expect(
        catalog.setLspServers({ lspServers: { clangd: { command: 'clangd', extensionToLanguage: { '.c': 'c' } }, bad: { command: 42, extensionToLanguage: { '.c': 'c' } } } })
      ).rejects.toThrow('invalid lspServers')
      await expect(readFile(join(agentsRoot, 'lsp.json'), 'utf8')).resolves.toBe(before)
    } finally {
      dispose()
    }
  })
})
