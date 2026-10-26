import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OUTPUT_STYLE_ROUTES } from '../../../../packages/market-contracts/src/contracts/output-styles.js'
import type { OutputStylesPayload } from '../../../../packages/market-contracts/src/contracts/output-styles.js'
import { mountOutputStyleRoutes } from '../../../../packages/market-bundle/src/routes-output-styles.js'
import { OutputStyleService, type OutputStyleSuitePort } from '../../../../packages/market-runtime/src/runtime/host/output-style-service.js'

type Handler = (req: unknown, res: unknown) => void | Promise<void>
interface Answer {
  status: number
  body: Record<string, unknown>
}

const roots: string[] = []
const WORKSPACE = '/work/project'
const SESSION = 'fixture'

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function service(port?: OutputStyleSuitePort): Promise<OutputStyleService> {
  const root = await mkdtemp(join(tmpdir(), 'output-style-routes-'))
  roots.push(root)
  const dataRoot = join(root, 'data')
  const agentsRoot = join(root, 'agents')
  await mkdir(dataRoot, { recursive: true })
  await mkdir(agentsRoot, { recursive: true })
  return new OutputStyleService(dataRoot, agentsRoot, port)
}

/** A suite whose SessionStart hook the test controls. */
function port(text = 'Teach as you go.'): OutputStyleSuitePort {
  return {
    candidates: async () => [{ suiteKey: 'src/teaching', label: 'teaching-style', description: 'A suite style', fingerprint: 'fp-1' }],
    capture: async (_suiteKey, fingerprint) => {
      if (fingerprint !== 'fp-1') throw new Error('suite changed')
      return JSON.stringify({ hookSpecificOutput: { additionalEvent: 'SessionStart', additionalContext: text } })
    }
  }
}

function host(): { ctx: unknown; routes: Map<string, Handler> } {
  const routes = new Map<string, Handler>()
  return {
    routes,
    ctx: {
      webServer: {
        register(entry: { path: string; handler: Handler }): () => void {
          routes.set(entry.path, entry.handler)
          return () => routes.delete(entry.path)
        }
      }
    }
  }
}

function recorded(): { response: unknown; read: () => Answer } {
  let status = 0
  let payload = ''
  return {
    response: { writeHead: (code: number) => (status = code), end: (text: string) => (payload = text) },
    read: () => ({ status, body: JSON.parse(payload) as Record<string, unknown> })
  }
}

function session(workspace = WORKSPACE) {
  return { agent: (id: string) => (id === SESSION ? ({ session: { header: { cwd: workspace } } } as never) : undefined) }
}

async function get(routes: Map<string, Handler>, url: string): Promise<Answer> {
  const { response, read } = recorded()
  await routes.get(url.split('?')[0] ?? url)?.({ method: 'GET', url, headers: { host: '127.0.0.1' } }, response)
  return read()
}

async function post(routes: Map<string, Handler>, url: string, body: Record<string, unknown>, origin?: string): Promise<Answer> {
  const { response, read } = recorded()
  const request = {
    method: 'POST',
    url,
    headers: { host: '127.0.0.1', ...(origin === undefined ? {} : { origin }) },
    on: (event: string, listener: (chunk?: unknown) => void) => {
      if (event === 'data') listener(Buffer.from(JSON.stringify(body), 'utf8'))
      if (event === 'end') listener()
    },
    destroy: () => {}
  }
  void routes.get(url.split('?')[0] ?? url)?.(request, response)
  const deadline = Date.now() + 5000
  for (;;) {
    try {
      const answer = read()
      if (answer.body !== undefined) return answer
    } catch {
      // The handler has not written its body yet.
    }
    if (Date.now() > deadline) return read()
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

const read = (): string => `${OUTPUT_STYLE_ROUTES.read}?sessionId=${SESSION}`
const post_ = (route: string): string => `${route}?sessionId=${SESSION}`

describe('output-style routes', () => {
  it('reads every style and the injected text for a session workspace', async () => {
    const { ctx, routes } = host()
    mountOutputStyleRoutes(ctx, { service: await service(port()), session: session() })
    const answer = await get(routes, read())
    const payload = answer.body as unknown as OutputStylesPayload

    expect(answer.status).toBe(200)
    expect(payload.workspace).toBe(WORKSPACE)
    expect(payload.selected).toBe('builtin:default')
    // The default style injects nothing, and the payload says so rather than
    // leaving the reader to guess from an empty preview.
    expect(payload.injected).toBe('')
    expect(payload.styles.map(row => row.id)).toContain('suite:src/teaching')
    expect(payload.styles.find(row => row.id === 'suite:src/teaching')?.capture).toBe('missing')
  })

  it('selects a style and answers the committed read', async () => {
    const { ctx, routes } = host()
    mountOutputStyleRoutes(ctx, { service: await service(), session: session() })
    const answer = await post(routes, post_(OUTPUT_STYLE_ROUTES.select), { styleId: 'builtin:concise' })

    expect(answer.status).toBe(200)
    expect(answer.body['selected']).toBe('builtin:concise')
    expect(String(answer.body['injected'])).toContain('## Output style: concise')
  })

  it('rejects an unknown style id', async () => {
    const { ctx, routes } = host()
    mountOutputStyleRoutes(ctx, { service: await service(), session: session() })
    const answer = await post(routes, post_(OUTPUT_STYLE_ROUTES.select), { styleId: 'builtin:nope' })

    expect(answer.status).toBe(400)
    expect(answer.body['error']).toContain('unknown output style')
  })

  it('rejects a cross-origin write', async () => {
    const { ctx, routes } = host()
    mountOutputStyleRoutes(ctx, { service: await service(), session: session() })
    const answer = await post(routes, post_(OUTPUT_STYLE_ROUTES.select), { styleId: 'builtin:concise' }, 'https://evil.example')

    expect(answer.status).toBe(403)
    expect(answer.body['error']).toContain('cross-origin')
  })

  it('fails a capture of a suite that does not exist with a stable error', async () => {
    const { ctx, routes } = host()
    mountOutputStyleRoutes(ctx, { service: await service(port()), session: session() })
    const answer = await post(routes, post_(OUTPUT_STYLE_ROUTES.capture), { suiteKey: 'src/missing' })

    expect(answer.status).toBe(400)
    expect(answer.body['error']).toContain('SessionStart hook')
  })

  it('captures a suite style, then selects it', async () => {
    const { ctx, routes } = host()
    const owner = await service(port())
    mountOutputStyleRoutes(ctx, { service: owner, session: session() })

    const captured = await post(routes, post_(OUTPUT_STYLE_ROUTES.capture), { suiteKey: 'src/teaching' })
    expect(captured.status).toBe(200)
    expect(captured.body['text']).toBe('Teach as you go.')

    const selected = await post(routes, post_(OUTPUT_STYLE_ROUTES.select), { styleId: 'suite:src/teaching' })
    expect(selected.status).toBe(200)
    expect(String(selected.body['injected'])).toBe('## Output style: teaching-style\nTeach as you go.')
  })

  it('refuses a suite style nobody captured yet', async () => {
    const { ctx, routes } = host()
    mountOutputStyleRoutes(ctx, { service: await service(port()), session: session() })
    const answer = await post(routes, post_(OUTPUT_STYLE_ROUTES.select), { styleId: 'suite:src/teaching' })
    expect(answer.status).toBe(400)
    expect(answer.body['error']).toContain('capture it first')
  })

  it('writes and removes a user style through its own fields', async () => {
    const { ctx, routes } = host()
    mountOutputStyleRoutes(ctx, { service: await service(), session: session() })

    const saved = await post(routes, post_(OUTPUT_STYLE_ROUTES.saveUser), { name: 'brief', description: 'Short answers', body: 'Be brief.' })
    expect(saved.status).toBe(200)
    expect((saved.body['styles'] as Array<{ id: string }>).map(row => row.id)).toContain('user:brief')

    const removed = await post(routes, post_(OUTPUT_STYLE_ROUTES.deleteUser), { name: 'brief' })
    expect(removed.status).toBe(200)
    expect((removed.body['styles'] as Array<{ id: string }>).map(row => row.id)).not.toContain('user:brief')
  })

  it('refuses a user style name that is not a file stem', async () => {
    const { ctx, routes } = host()
    mountOutputStyleRoutes(ctx, { service: await service(), session: session() })
    const answer = await post(routes, post_(OUTPUT_STYLE_ROUTES.saveUser), { name: '../escape', description: '', body: 'x' })
    expect(answer.status).toBe(400)
    expect(answer.body['error']).toContain('not a usable style name')
  })

  it('answers 404 for an unknown session instead of reading another workspace', async () => {
    const { ctx, routes } = host()
    mountOutputStyleRoutes(ctx, { service: await service(), session: session() })
    const answer = await get(routes, `${OUTPUT_STYLE_ROUTES.read}?sessionId=gone`)
    expect(answer.status).toBe(404)
    expect(answer.body['error']).toContain('no live session')
  })
})
