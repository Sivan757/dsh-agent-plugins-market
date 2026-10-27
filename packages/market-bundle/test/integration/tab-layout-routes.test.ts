import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountTabLayoutRoutes } from '../../../../packages/market-bundle/src/routes-tab-layout.js'
import { TabLayoutService } from '../../../../packages/market-runtime/src/runtime/host/tab-layout-service.js'
import { MARKET_ROUTES } from '../../../../packages/market-contracts/src/contracts/market.js'
import { DEFAULT_STOWED_TABS, WORKSPACE_TAB_KEYS } from '../../../../packages/market-contracts/src/contracts/tab-layout.js'

/** The row a workspace with no recorded choice serves. */
const DEFAULT_HIDDEN = WORKSPACE_TAB_KEYS.filter(key => (DEFAULT_STOWED_TABS as readonly string[]).includes(key))

type Handler = (request: unknown, response: unknown) => void
type RouteTable = Map<string, { handler: Handler }>

interface Answer {
  status: number
  body: Record<string, unknown>
}

async function harness(): Promise<{ routes: RouteTable; service: TabLayoutService; dispose: () => void }> {
  const routes: RouteTable = new Map()
  const webServer = {
    register(entry: { path: string; handler: Handler }): () => void {
      // The host throws on a duplicate exact path, which is what keeps a
      // same-path GET/POST pair from mounting silently.
      if (routes.has(entry.path)) throw new Error('duplicate route ' + entry.path)
      routes.set(entry.path, { handler: entry.handler })
      return () => routes.delete(entry.path)
    }
  }
  const root = await mkdtemp(join(tmpdir(), 'tab-layout-routes-'))
  const service = new TabLayoutService(root, '/work/routes')
  await service.reload()
  const dispose = mountTabLayoutRoutes({ webServer }, service)
  return { routes, service, dispose }
}

/** Drive one registered GET the way the host does. */
async function get(routes: RouteTable, path: string): Promise<Answer> {
  let status = 0
  let payload = ''
  const response = {
    writeHead: (code: number) => {
      status = code
    },
    end: (value: string) => {
      payload = value
    }
  }
  routes.get(path)?.handler({ method: 'GET', url: path, headers: {} }, response)
  for (let attempt = 0; payload === '' && attempt < 200; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
  return { status, body: JSON.parse(payload) as Record<string, unknown> }
}

/** Drive one registered same-origin POST the way the host does. */
async function post(routes: RouteTable, path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Answer> {
  let status = 0
  let payload = ''
  const request = {
    method: 'POST',
    url: path,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1', ...headers },
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
    end: (value: string) => {
      payload = value
    }
  }
  routes.get(path)?.handler(request, response)
  for (let attempt = 0; payload === '' && attempt < 200; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
  return { status, body: JSON.parse(payload) as Record<string, unknown> }
}

describe('tab-layout routes', () => {
  it('registers the shared constants and disposes them together', async () => {
    const { routes, dispose } = await harness()
    expect([...routes.keys()].sort()).toEqual([MARKET_ROUTES.tabLayout, MARKET_ROUTES.setTabLayout].sort())
    dispose()
    expect(routes.size).toBe(0)
  })

  it('serves the live layout and the layout it commits', async () => {
    const { routes, dispose } = await harness()
    expect(await get(routes, MARKET_ROUTES.tabLayout)).toEqual({ status: 200, body: { hidden: DEFAULT_HIDDEN } })

    const written = await post(routes, MARKET_ROUTES.setTabLayout, { hidden: ['lsp', 'hooks'] })
    expect(written.status).toBe(200)
    expect(written.body).toEqual({ ok: true, hidden: ['lsp', 'hooks'] })
    expect(await get(routes, MARKET_ROUTES.tabLayout)).toEqual({ status: 200, body: { hidden: ['lsp', 'hooks'] } })
    dispose()
  })

  it('rejects an unknown tab key without changing the layout', async () => {
    const { routes, dispose } = await harness()
    await post(routes, MARKET_ROUTES.setTabLayout, { hidden: ['mcp'] })

    const answer = await post(routes, MARKET_ROUTES.setTabLayout, { hidden: ['mcp', 'nope'] })
    expect(answer.status).toBe(400)
    expect(answer.body).toMatchObject({ ok: false, error: 'unknown tab key "nope"' })
    expect(await get(routes, MARKET_ROUTES.tabLayout)).toEqual({ status: 200, body: { hidden: ['mcp'] } })
    dispose()
  })

  it('rejects a body that would hide every tab', async () => {
    const { routes, dispose } = await harness()

    // The pinned tab is the one key that keeps the row non-empty, so a request
    // naming it is refused rather than silently corrected.
    const pinned = await post(routes, MARKET_ROUTES.setTabLayout, { hidden: ['market'] })
    expect(pinned.status).toBe(400)
    expect(pinned.body).toMatchObject({ ok: false, error: 'the "market" tab cannot be stowed' })

    const everything = await post(routes, MARKET_ROUTES.setTabLayout, { hidden: [...WORKSPACE_TAB_KEYS] })
    expect(everything.status).toBe(400)

    // Stowing every other tab is legal: the pinned tab stays.
    const rest = await post(routes, MARKET_ROUTES.setTabLayout, { hidden: WORKSPACE_TAB_KEYS.filter(key => key !== 'market') })
    expect(rest.status).toBe(200)
    expect(rest.body).toEqual({ ok: true, hidden: WORKSPACE_TAB_KEYS.filter(key => key !== 'market') })
    dispose()
  })

  it('rejects a body whose hidden field is not an array of keys', async () => {
    const { routes, dispose } = await harness()
    for (const body of [{}, { hidden: 'skills' }, { hidden: [7] }]) {
      const answer = await post(routes, MARKET_ROUTES.setTabLayout, body)
      expect(answer.status).toBe(400)
      expect(answer.body).toMatchObject({ ok: false, error: 'hidden must be an array of tab keys' })
    }
    dispose()
  })

  it('rejects a cross-origin write and keeps the layout', async () => {
    const { routes, dispose } = await harness()
    const answer = await post(routes, MARKET_ROUTES.setTabLayout, { hidden: ['mcp'] }, { origin: 'http://evil.example' })
    expect(answer.status).toBe(403)
    expect(answer.body).toMatchObject({ ok: false, error: 'cross-origin request rejected' })
    expect(await get(routes, MARKET_ROUTES.tabLayout)).toEqual({ status: 200, body: { hidden: DEFAULT_HIDDEN } })
    dispose()
  })

  it('rejects an unreadable body', async () => {
    const { routes, dispose } = await harness()
    let status = 0
    let payload = ''
    const request = {
      method: 'POST',
      url: MARKET_ROUTES.setTabLayout,
      headers: { host: '127.0.0.1' },
      on: (event: string, listener: (chunk?: unknown) => void) => {
        if (event === 'data') listener(Buffer.from('{ not json', 'utf8'))
        if (event === 'end') listener()
      },
      destroy: () => {}
    }
    routes.get(MARKET_ROUTES.setTabLayout)?.handler(request, {
      writeHead: (code: number) => {
        status = code
      },
      end: (value: string) => {
        payload = value
      }
    })
    for (let attempt = 0; payload === '' && attempt < 200; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
    expect(status).toBe(400)
    expect(JSON.parse(payload)).toMatchObject({ ok: false, error: 'invalid JSON body' })
    dispose()
  })
})
