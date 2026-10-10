import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountSuiteRoutes } from '../packages/market-bundle/src/routes.js'
import { ResourceFilterService } from '../packages/market-runtime/src/runtime/host/resource-filter-service.js'
import { SurfaceToggleService } from '../packages/market-runtime/src/runtime/host/surface-toggle-service.js'
import { ALL_SURFACES_ON } from '../packages/market-contracts/src/contracts/surface-toggles.js'

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
  return { host: host, routes }
}

async function makeService(workspace: string): Promise<SurfaceToggleService> {
  const dataRoot = await mkdtemp(join(tmpdir(), 'toggle-routes-'))
  return new SurfaceToggleService(new ResourceFilterService(dataRoot, workspace, { onFiltersChanged: () => {} }))
}

describe('surface toggle routes', () => {
  it('registers both routes and serves the current toggles', async () => {
    const service = await makeService('/ws/alpha')
    const { host, routes } = fakeHost()
    const dispose = mountSuiteRoutes(host, {} as never, undefined, service)

    expect(routes.get('/api/agent-plugins/surface-toggles')).toBeDefined()
    expect(routes.get('/api/agent-plugins/surface-toggles/set')).toBeDefined()

    let served: unknown
    routes.get('/api/agent-plugins/surface-toggles')?.handler(
      {},
      {
        writeHead: () => {},
        end: (body: string) => (served = JSON.parse(body) as unknown)
      }
    )
    expect(served).toEqual(ALL_SURFACES_ON)
    dispose()
  })

  it('serves the service state after a flip', async () => {
    const service = await makeService('/ws/beta')
    await service.set('mcp', false)
    expect(service.currentToggles()).toEqual({ ...ALL_SURFACES_ON, mcp: false })
  })

  it('rejects an unknown surface key without touching the stored state', async () => {
    const service = await makeService('/ws/gamma')
    const { host, routes } = fakeHost()
    const dispose = mountSuiteRoutes(host, {} as never, undefined, service)

    const output = await postToggle(routes, { key: 'not-a-surface', enabled: false })
    expect(output.status).toBe(400)
    expect(output.body).toMatchObject({ ok: false, error: 'invalid surface key' })
    expect(service.currentToggles()).toEqual(ALL_SURFACES_ON)
    dispose()
  })

  it('rejects a non-boolean enabled value on a valid key', async () => {
    const service = await makeService('/ws/delta')
    const { host, routes } = fakeHost()
    const dispose = mountSuiteRoutes(host, {} as never, undefined, service)

    for (const enabled of ['false', 0, null, undefined]) {
      const output = await postToggle(routes, { key: 'mcp', enabled })
      expect(output.status).toBe(400)
      expect(output.body).toMatchObject({ ok: false, error: 'enabled must be a boolean' })
    }
    // The rejection happens before the write, so nothing was persisted.
    expect(service.currentToggles()).toEqual(ALL_SURFACES_ON)
    dispose()
  })

  it('applies a well-formed flip and answers with the new state', async () => {
    const service = await makeService('/ws/epsilon')
    const { host, routes } = fakeHost()
    const dispose = mountSuiteRoutes(host, {} as never, undefined, service)

    const output = await postToggle(routes, { key: 'lsp', enabled: false })
    expect(output.status).toBe(200)
    expect(output.body).toMatchObject({ ok: true, toggles: { ...ALL_SURFACES_ON, lsp: false } })
    dispose()
  })
})

interface ToggleAnswer {
  status: number
  body: Record<string, unknown>
}

/**
 * Drive the registered POST handler the way the host does: a same-origin JSON
 * request whose body is read from the request stream, then the recorded
 * response. Exercising the registered handler rather than a re-implementation
 * is what pins the validation the route actually performs.
 */
async function postToggle(routes: RecordedRoutes, body: Record<string, unknown>): Promise<ToggleAnswer> {
  let status = 0
  let payload = ''
  const request = {
    method: 'POST',
    url: '/api/agent-plugins/surface-toggles/set',
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
    end: (value: string) => {
      payload = value
    }
  }
  const handler = routes.get('/api/agent-plugins/surface-toggles/set')?.handler
  if (handler === undefined) throw new Error('the surface-toggle route is not registered')
  // The handler starts its body-read and response write as a detached async
  // task, so calling it returns before the write lands. Poll rather than
  // sleeping one tick: the write crosses several awaits and a single tick is
  // not enough under a loaded full-suite run.
  handler(request, response)
  for (let attempt = 0; payload === '' && attempt < 200; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  return { status, body: JSON.parse(payload) as Record<string, unknown> }
}
