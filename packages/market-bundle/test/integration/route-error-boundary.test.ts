/**
 * The route error boundary must not hand a filesystem layout to the browser.
 *
 * A failure from the filesystem or git layer carries an absolute path in its
 * message, and the browser is not the reader who needs it: a page can read any
 * response it is allowed to send, while the operator who can act on the path
 * already has the filesystem. The detail therefore goes to the log, and the
 * response carries a stable code and a message with no path in it.
 */
import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MARKET_ROUTES } from '../../../../packages/market-contracts/src/contracts/market.js'
import { mountSuiteRoutes, type WebServerService } from '../../../../packages/market-bundle/src/routes.js'
import { Catalog } from '../../../../packages/market-bundle/src/application/catalog.js'
import type { MarketService } from '../../../../packages/market-contracts/src/ports/queries.js'
import { removeTempRoot } from './helpers/temp-root.js'

type RouteTable = Map<string, (request: unknown, response: unknown) => void | Promise<void>>

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(removeTempRoot))
})

/** A POST request stub carrying a JSON body and a loopback same-origin pair. */
function postRequest(url: string, body: Record<string, unknown>): unknown {
  return {
    method: 'POST',
    url,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
    on: (event: string, listener: (chunk?: unknown) => void) => {
      if (event === 'data') listener(Buffer.from(JSON.stringify(body), 'utf8'))
      if (event === 'end') listener()
    },
    destroy: () => {}
  }
}

function response(): { value: () => Record<string, unknown>; writeHead: () => void; end: (body: string) => void } {
  let body = ''
  return {
    value: () => JSON.parse(body) as Record<string, unknown>,
    writeHead: () => {},
    end: value => {
      body = value
    }
  }
}

/** A webserver mock that keeps each registered handler reachable by path. */
function routes(): WebServerService & { table: RouteTable } {
  const table: RouteTable = new Map()
  return {
    table,
    register: route => {
      table.set(route.path, route.handler as (request: unknown, response: unknown) => void | Promise<void>)
      return () => table.delete(route.path)
    }
  }
}

/** Minimal service surface: only the route under test has to answer. */
function service(overrides: Partial<MarketService>): MarketService {
  return {
    addSource: async () => ({ id: 'source', url: 'https://example.com/x', kind: 'git' as const }),
    clearTranslations: async () => {},
    overview: async () => ({ sources: [], suites: [], totals: { all: 0, installed: 0, enabled: 0 }, roots: { user: '/user', data: '/data' } }),
    ...overrides
  } as MarketService
}

/** Run one POST through the mounted route and return the response body. */
async function post(webServer: WebServerService, path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handler = (webServer as WebServerService & { table?: RouteTable }).table?.get(path)
  if (handler === undefined) throw new Error('route not registered: ' + path)
  const output = response()
  let finish!: () => void
  const finished = new Promise<void>(resolve => {
    finish = resolve
  })
  const end = output.end
  output.end = value => {
    end(value)
    finish()
  }
  await handler(postRequest(path, body), output)
  await finished
  return output.value()
}

describe('the route error boundary', () => {
  it('produces an absolute path from the real source store for a missing local directory', async () => {
    const userRoot = await mkdtemp(join(tmpdir(), 'market-error-boundary-'))
    roots.push(userRoot)
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
    await catalog.load()
    const missing = join(userRoot, 'definitely-not-here')
    const thrown = await catalog.addSource({ url: missing, local: true }).catch((error: unknown) => error)
    // The producer names the absolute path. This is the detail the log keeps and
    // the browser must not receive.
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain(missing)
  })

  it('returns a stable code and no filesystem path when the application reports a missing directory', async () => {
    const missing = '/Users/someone/private-checkout'
    const logged: string[] = []
    const webServer = routes()
    const manager = service({
      addSource: async () => {
        throw new Error('local source directory ' + missing + ' is missing')
      }
    })
    const dispose = mountSuiteRoutes({ webServer, logger: { warn: (message: string) => logged.push(message) } }, manager)
    try {
      const body = await post(webServer, MARKET_ROUTES.addSource, { url: missing, local: true })
      expect(body['ok']).toBe(false)
      // The security property first: no filesystem layout crosses the boundary.
      expect(JSON.stringify(body)).not.toContain(missing)
      expect(body['code']).toBe('request-failed')
      // The diagnosis survives, because only the location was withheld.
      expect(body['error']).toContain('<path>')
      expect(body['error']).toContain('local source directory')
      expect(body['error']).toContain('is missing')
      // The operator still gets the detail, in the log.
      expect(logged.join('\n')).toContain(missing)
    } finally {
      dispose()
    }
  })

  it('keeps the authored reason when the rejected value echoes a slash', async () => {
    // The rejected value is the user's own input, and a slash in it is why the
    // request was refused. Redaction must withhold the value, not the rule.
    const webServer = routes()
    const dispose = mountSuiteRoutes({ webServer, logger: { warn: () => {} } }, service({}))
    try {
      const body = await post(webServer, MARKET_ROUTES.addSource, { url: 'https://example.com/x', kind: '/etc/passwd' })
      expect(body['ok']).toBe(false)
      expect(body['error']).toContain('invalid source kind')
      expect(JSON.stringify(body)).not.toContain('/etc/passwd')
    } finally {
      dispose()
    }
  })

  it('keeps an authored validation message that carries no path', async () => {
    const webServer = routes()
    const dispose = mountSuiteRoutes({ webServer, logger: { warn: () => {} } }, service({}))
    try {
      const body = await post(webServer, MARKET_ROUTES.addSource, { url: '', local: false })
      expect(body['ok']).toBe(false)
      expect(body['error']).toBe('missing source url')
    } finally {
      dispose()
    }
  })
})
