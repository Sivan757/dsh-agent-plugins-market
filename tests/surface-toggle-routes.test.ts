import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mountSuiteRoutes } from '../src/routes.js'
import { SurfaceToggleService } from '../src/runtime/host/surface-toggle-service.js'
import { ALL_SURFACES_ON } from '../src/contracts/surface-toggles.js'

type Handler = (req: unknown, res: unknown) => void
interface RecordedRoutes extends Map<string, { handler: Handler }> {}

function fakeHost(): { host: Record<string, unknown>; routes: RecordedRoutes } {
  const routes = new Map<string, { handler: Handler }>() as RecordedRoutes
  const host = {
    webServer: {
      register(entry: { path: string; handler: Handler }): () => void {
        routes.set(entry.path, { handler: entry.handler })
        return () => routes.delete(entry.path)
      }
    }
  }
  return { host: host as unknown as Record<string, unknown>, routes }
}

async function makeService(workspace: string): Promise<SurfaceToggleService> {
  const dataRoot = await mkdtemp(join(tmpdir(), 'toggle-routes-'))
  return new SurfaceToggleService(dataRoot, workspace, { onTogglesChanged: () => {} })
}

describe('surface toggle routes', () => {
  it('registers both routes and serves the current toggles', async () => {
    const service = await makeService('/ws/alpha')
    const { host, routes } = fakeHost()
    const dispose = mountSuiteRoutes(host as never, {} as never, undefined, service)

    expect(routes.get('/api/agent-plugins/surface-toggles')).toBeDefined()
    expect(routes.get('/api/agent-plugins/surface-toggles/set')).toBeDefined()

    let served: unknown
    routes.get('/api/agent-plugins/surface-toggles')?.handler({}, {
      writeHead: () => {},
      end: (body: string) => (served = JSON.parse(body))
    })
    expect(served).toEqual(ALL_SURFACES_ON)
    dispose()
  })

  it('serves the service state after a flip', async () => {
    const service = await makeService('/ws/beta')
    await service.set('mcp', false)
    expect(service.currentToggles()).toEqual({ ...ALL_SURFACES_ON, mcp: false })
  })
})
