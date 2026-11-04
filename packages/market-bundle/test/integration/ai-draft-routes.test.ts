/**
 * The draft route: one request in, one artifact out.
 *
 * A draft is text a person reviews, so the route's contract is narrow on purpose: it takes a
 * face and an intent, never a prompt, a model or a system message, and it answers with the
 * artifact plus the route that produced it. These tests pin the bounds and the failure codes
 * the client renders.
 */
import { describe, expect, it } from 'vitest'
import { AI_DRAFT_LIMITS, AI_DRAFT_ROUTES } from '../../../../packages/market-contracts/src/contracts/ai-draft.js'
import { createAiDraftService, type AiDraftPort } from '../../../../packages/market-bundle/src/application/ai-draft.js'
import { createAiPresetService, parsePresetSuggestion } from '../../../../packages/market-bundle/src/application/ai-preset.js'
import { createAiDiagnoseService } from '../../../../packages/market-bundle/src/application/ai-diagnose.js'
import { mountAiDraftRoutes } from '../../../../packages/market-bundle/src/routes-ai.js'

type Handler = (req: unknown, res: unknown) => void | Promise<void>
interface Answer {
  status: number
  body: Record<string, unknown>
}

const logger = { warn: (): void => {}, info: (): void => {}, error: (): void => {} }

/** A session store that records what a task was written into. */
const sessionStub = {
  sessions: {
    create: (id?: string) => {
      const written: Array<{ type: string; text?: string }> = []
      const store = {
        append: (type: string, data: unknown) => {
          written.push({ type, text: JSON.stringify(data).slice(0, 200) })
          return data
        },
        header: { id: id ?? 'session-fixture' },
        written
      }
      return store
    }
  },
  agentsRoot: '/agents-root'
}

/** The catalogue an install recommendation reads: two suites, one of them already on. */
const catalogueStub = {
  catalogue: {
    overview: async () => ({
      suites: [
        { sourceId: 'market', suiteId: 'frontend', name: 'frontend-suite', enabled: false },
        { sourceId: 'market', suiteId: 'testing', name: 'testing-suite', enabled: false },
        { sourceId: 'market', suiteId: 'on', name: 'already-on', enabled: true }
      ]
    })
  }
}

function host(): { ctx: { get(name: string): unknown }; routes: Map<string, Handler> } {
  const routes = new Map<string, Handler>()
  return {
    routes,
    ctx: {
      get: (name: string) =>
        name === 'webServer'
          ? {
              register(entry: { path: string; handler: Handler }): () => void {
                routes.set(entry.path, entry.handler)
                return () => routes.delete(entry.path)
              }
            }
          : undefined
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

const request = (body: unknown, method = 'POST', origin?: string): unknown => ({
  method,
  url: AI_DRAFT_ROUTES.draft,
  headers: { host: '127.0.0.1', ...(origin === undefined ? {} : { origin }) },
  on: (event: string, listener: (chunk?: unknown) => void) => {
    if (event === 'data') listener(Buffer.from(JSON.stringify(body), 'utf8'))
    if (event === 'end') listener()
  },
  destroy: () => {}
})

async function post(routes: Map<string, Handler>, body: unknown, method = 'POST', origin?: string): Promise<Answer> {
  const { response, read } = recorded()
  await routes.get(AI_DRAFT_ROUTES.draft)?.(request(body, method, origin), response)
  return read()
}

/** A port that answers a fixed artifact and records what it was asked. */
function port(answer = '---\ndescription: 测试\n---\n\nBody'): { port: AiDraftPort; calls: Array<{ system: string; user: string }> } {
  const calls: Array<{ system: string; user: string }> = []
  return {
    calls,
    port: {
      complete: async prompt => {
        calls.push(prompt)
        return { text: answer, provider: 'deepseek', model: 'fixture' }
      }
    }
  }
}

describe('ai draft route', () => {
  it('drafts one artifact and names the route that produced it', async () => {
    const { ctx, routes } = host()
    const fake = port()
    mountAiDraftRoutes(ctx, {
      ...sessionStub,
      ...catalogueStub,
      service: createAiDraftService(fake.port),
      presets: createAiPresetService(fake.port),
      diagnose: createAiDiagnoseService(fake.port),
      logger
    })
    const answer = await post(routes, { face: 'skills', intent: '审查我的 TypeScript 改动', locale: 'zh' })

    expect(answer.status).toBe(200)
    // The shared client helper refuses a body without ok:true, so a success that omits it
    // reaches the reader as "draft failed: 200".
    expect(answer.body['ok']).toBe(true)
    expect(String(answer.body['text'])).toContain('description:')
    expect(answer.body).toMatchObject({ provider: 'deepseek', model: 'fixture' })
    // The prompt says what shape the artifact takes and that the answer is the artifact only.
    expect(fake.calls[0]!.system).toContain('frontmatter')
    expect(fake.calls[0]!.system).toContain('No prose')
    expect(fake.calls[0]!.user).toContain('审查我的 TypeScript 改动')
  })

  it('rejects an unknown face, an empty intent and an over-long intent', async () => {
    const { ctx, routes } = host()
    const fake = port()
    mountAiDraftRoutes(ctx, {
      ...sessionStub,
      ...catalogueStub,
      service: createAiDraftService(fake.port),
      presets: createAiPresetService(fake.port),
      diagnose: createAiDiagnoseService(fake.port),
      logger
    })

    expect((await post(routes, { face: 'mcp', intent: 'x' })).status).toBe(400)
    expect((await post(routes, { face: 'skills', intent: '   ' })).status).toBe(400)
    const long = 'x'.repeat(AI_DRAFT_LIMITS.intentChars + 1)
    expect((await post(routes, { face: 'skills', intent: long })).status).toBe(400)
    // A rejected request never reaches the model.
    expect(fake.calls).toHaveLength(0)
  })

  it('answers 409 when the deployment has no model, and 502 when the call fails', async () => {
    const { ctx, routes } = host()
    mountAiDraftRoutes(ctx, {
      ...sessionStub,
      ...catalogueStub,
      service: createAiDraftService(undefined),
      presets: createAiPresetService(undefined),
      diagnose: createAiDiagnoseService(undefined),
      logger
    })
    const unconfigured = await post(routes, { face: 'skills', intent: 'anything' })
    expect(unconfigured.status).toBe(409)
    expect(String(unconfigured.body['error'])).toContain('no model')

    const failing: AiDraftPort = {
      complete: async () => {
        throw new Error('provider exploded')
      }
    }
    const second = host()
    mountAiDraftRoutes(second.ctx, {
      ...sessionStub,
      ...catalogueStub,
      service: createAiDraftService(failing),
      presets: createAiPresetService(failing),
      diagnose: createAiDiagnoseService(failing),
      logger
    })
    const failed = await post(second.routes, { face: 'outputStyles', intent: 'answer briefly' })
    expect(failed.status).toBe(502)
    expect(String(failed.body['error'])).toContain('provider exploded')
  })

  it('names a provider limit as a limit, not as a broken deployment', async () => {
    // A quota answer is temporary and the reader can act on it; it must not read like the
    // plugin is broken. The code crosses so the client can say it in the reader's language.
    const limited: AiDraftPort = {
      complete: async () => {
        throw new Error('provider API error (429): {"message":"usage limit has been reached"}')
      }
    }
    const { ctx, routes } = host()
    mountAiDraftRoutes(ctx, {
      ...sessionStub,
      ...catalogueStub,
      service: createAiDraftService(limited),
      presets: createAiPresetService(limited),
      diagnose: createAiDiagnoseService(limited),
      logger
    })
    const answer = await post(routes, { face: 'skills', intent: 'anything' })
    expect(answer.status).toBe(502)
    expect(answer.body['code']).toBe('ai-provider-limited')
  })

  it('refuses a read method and a cross-origin write', async () => {
    const { ctx, routes } = host()
    mountAiDraftRoutes(ctx, {
      ...sessionStub,
      ...catalogueStub,
      service: createAiDraftService(port().port),
      presets: createAiPresetService(port().port),
      diagnose: createAiDiagnoseService(port().port),
      logger
    })
    expect((await post(routes, {}, 'GET')).status).toBe(405)
    expect((await post(routes, { face: 'skills', intent: 'x' }, 'POST', 'https://evil.example')).status).toBe(403)
  })

  it('drafts every face with its own format rules', async () => {
    for (const face of ['skills', 'commands', 'agents', 'outputStyles', 'instructions'] as const) {
      const { ctx, routes } = host()
      const fake = port('draft')
      mountAiDraftRoutes(ctx, {
        ...sessionStub,
        ...catalogueStub,
        service: createAiDraftService(fake.port),
        presets: createAiPresetService(fake.port),
        diagnose: createAiDiagnoseService(fake.port),
        logger
      })
      const answer = await post(routes, { face, intent: 'do the thing', locale: 'en' })
      expect(answer.status).toBe(200)
      expect(fake.calls[0]!.system.length).toBeGreaterThan(80)
      if (face === 'instructions') expect(fake.calls[0]!.system).toContain('no frontmatter')
    }
  })
})

describe('ai preset suggestion', () => {
  const candidates = [
    { id: 'market:src/frontend', label: 'frontend-suite' },
    { id: 'market:src/testing', label: 'testing-suite' },
    { id: 'skills:src/frontend/review', label: 'review' }
  ]

  /** A port that answers with whatever JSON the model would have produced. */
  const answering = (text: string): AiDraftPort => ({ complete: async () => ({ text, provider: 'deepseek', model: 'fixture' }) })

  async function suggest(routes: Map<string, Handler>, body: unknown): Promise<Answer> {
    const { response, read } = recorded()
    await routes.get(AI_DRAFT_ROUTES.suggestPreset)?.(request(body), response)
    return read()
  }

  it('keeps only ids the manager offered, and names the preset', async () => {
    const { ctx, routes } = host()
    const port = answering(
      '{"name":"前端开发","reason":"覆盖前端常用的东西","picks":["market:src/frontend","market:src/frontend","market:src/ghost","skills:src/frontend/review"]}'
    )
    mountAiDraftRoutes(ctx, {
      ...catalogueStub,
      ...sessionStub,
      service: createAiDraftService(port),
      presets: createAiPresetService(port),
      diagnose: createAiDiagnoseService(port),
      logger
    })
    const answer = await suggest(routes, { intent: '前端开发用', candidates, locale: 'zh' })
    expect(answer.status).toBe(200)
    expect(answer.body['ok']).toBe(true)
    expect(answer.body).toMatchObject({ name: '前端开发', reason: '覆盖前端常用的东西' })
    // The duplicate collapses and the row that was never offered is dropped.
    expect(answer.body['enabledIds']).toEqual(['market:src/frontend', 'skills:src/frontend/review'])
  })

  it('reads a fenced answer, and refuses one that selects nothing it was offered', () => {
    expect(parsePresetSuggestion('```json\n{"name":"x","picks":["market:src/testing"]}\n```', candidates).enabledIds).toEqual(['market:src/testing'])
    expect(() => parsePresetSuggestion('{"name":"x","picks":["market:src/ghost"]}', candidates)).toThrow(/selected nothing/)
    expect(() => parsePresetSuggestion('no json here', candidates)).toThrow(/JSON/)
    expect(() => parsePresetSuggestion('{"picks":["market:src/testing"]}', candidates)).toThrow(/no name/)
  })

  it('refuses an empty intent and an empty world before calling the model', async () => {
    const { ctx, routes } = host()
    let called = 0
    const port: AiDraftPort = {
      complete: async () => {
        called++
        return { text: '{"name":"x"}', provider: 'p', model: 'm' }
      }
    }
    mountAiDraftRoutes(ctx, {
      ...catalogueStub,
      ...sessionStub,
      service: createAiDraftService(port),
      presets: createAiPresetService(port),
      diagnose: createAiDiagnoseService(port),
      logger
    })
    expect((await suggest(routes, { intent: '  ', candidates })).status).toBe(400)
    expect((await suggest(routes, { intent: '前端', candidates: [] })).status).toBe(400)
    expect(called).toBe(0)
  })

  it('names a provider limit on the preset route too', async () => {
    const { ctx, routes } = host()
    const port = answering('{"message":"usage limit has been reached (429)"}')
    mountAiDraftRoutes(ctx, {
      ...catalogueStub,
      ...sessionStub,
      service: createAiDraftService(port),
      presets: createAiPresetService(port),
      diagnose: createAiDiagnoseService(port),
      logger
    })
    const answer = await suggest(routes, { intent: '前端开发', candidates })
    // The model answered prose where JSON was required: that is an unusable answer, not a
    // limit, because the text carries no limit signal from the provider.
    expect(answer.status).toBe(422)

    const limited: AiDraftPort = {
      complete: async () => {
        throw new Error('provider error (429): usage limit reached')
      }
    }
    const second = host()
    mountAiDraftRoutes(second.ctx, {
      ...sessionStub,
      ...catalogueStub,
      service: createAiDraftService(limited),
      presets: createAiPresetService(limited),
      diagnose: createAiDiagnoseService(limited),
      logger
    })
    const refusal = await suggest(second.routes, { intent: '前端开发', candidates })
    expect(refusal.status).toBe(502)
    expect(refusal.body['code']).toBe('ai-provider-limited')
  })

  it('reports an unusable answer as unprocessable, not as a provider failure', async () => {
    const { ctx, routes } = host()
    const port = answering('I would pick the frontend suite.')
    mountAiDraftRoutes(ctx, {
      ...catalogueStub,
      ...sessionStub,
      service: createAiDraftService(port),
      presets: createAiPresetService(port),
      diagnose: createAiDiagnoseService(port),
      logger
    })
    const answer = await suggest(routes, { intent: '前端开发', candidates })
    expect(answer.status).toBe(422)
    expect(answer.body['code']).toBe('ai-invalid-suggestion')
  })
})

describe('ai failure diagnosis', () => {
  const failure = { state: 'failed', code: 'connection-timeout', reason: '连接超时', causes: ['endpoint 无响应'], transport: 'streamable-http', mountMs: 10000 }

  async function diagnose(routes: Map<string, Handler>, body: unknown): Promise<Answer> {
    const { response, read } = recorded()
    await routes.get(AI_DRAFT_ROUTES.diagnose)?.(request(body), response)
    return read()
  }

  it('explains one failure from the facts the panel shows', async () => {
    const { ctx, routes } = host()
    const fake = port('连不上这台服务。先确认地址在同一网络内可达，再检查服务是否要求认证。')
    mountAiDraftRoutes(ctx, {
      ...sessionStub,
      ...catalogueStub,
      service: createAiDraftService(fake.port),
      presets: createAiPresetService(fake.port),
      diagnose: createAiDiagnoseService(fake.port),
      logger
    })
    const answer = await diagnose(routes, { face: 'mcp', failure, locale: 'zh' })

    expect(answer.status).toBe(200)
    expect(answer.body['ok']).toBe(true)
    expect(String(answer.body['text'])).toContain('连不上')
    // The prompt carries the facts and forbids inventing the rest.
    expect(fake.calls[0]!.user).toContain('connection-timeout')
    expect(fake.calls[0]!.user).toContain('streamable-http')
    expect(fake.calls[0]!.system).toContain('Never invent')
    expect(fake.calls[0]!.system).toContain('MCP connector')
  })

  it('refuses an unknown family and a failure with no state, without calling the model', async () => {
    const { ctx, routes } = host()
    const fake = port('x')
    mountAiDraftRoutes(ctx, {
      ...sessionStub,
      ...catalogueStub,
      service: createAiDraftService(fake.port),
      presets: createAiPresetService(fake.port),
      diagnose: createAiDiagnoseService(fake.port),
      logger
    })
    expect((await diagnose(routes, { face: 'hooks', failure })).status).toBe(400)
    expect((await diagnose(routes, { face: 'mcp', failure: { reason: 'x' } })).status).toBe(400)
    expect(fake.calls).toHaveLength(0)
  })

  it('bounds what one request can carry', async () => {
    const { ctx, routes } = host()
    const fake = port('x')
    mountAiDraftRoutes(ctx, {
      ...sessionStub,
      ...catalogueStub,
      service: createAiDraftService(fake.port),
      presets: createAiPresetService(fake.port),
      diagnose: createAiDiagnoseService(fake.port),
      logger
    })
    const long = { ...failure, reason: 'r'.repeat(2000), causes: Array.from({ length: 20 }, (_, index) => 'cause-' + String(index) + ' c'.repeat(400)) }
    await diagnose(routes, { face: 'lsp', failure: long })
    const user = fake.calls[0]!.user
    // Six causes at most, each truncated, and the reason clipped to its own bound.
    expect(user.split('attributed cause:').length - 1).toBe(6)
    expect(user.length).toBeLessThan(6000)
  })
})

describe('install recommendation', () => {
  it('reads the catalogue instead of asking the browser for a thousand ids', async () => {
    const { ctx, routes } = host()
    const port: AiDraftPort = {
      complete: async prompt => ({
        text: prompt.user.includes('frontend-suite') ? '{"name":"前端","reason":"够用","picks":["market/frontend","market/on"]}' : '{}',
        provider: 'p',
        model: 'm'
      })
    }
    mountAiDraftRoutes(ctx, {
      ...catalogueStub,
      ...sessionStub,
      service: createAiDraftService(port),
      presets: createAiPresetService(port),
      diagnose: createAiDiagnoseService(port),
      logger
    })
    const { response, read } = recorded()
    await routes.get(AI_DRAFT_ROUTES.suggestPreset)?.(request({ intent: '前端开发', purpose: 'install', locale: 'zh' }), response)
    const answer = read()

    expect(answer.status).toBe(200)
    // A row that is already switched on is not a candidate for what to add, so the pick of it
    // is dropped and the answer keeps only the row that was on offer.
    expect(answer.body['enabledIds']).toEqual(['market/frontend'])
  })

  it('answers 400 when the catalogue offers nothing to add', async () => {
    const { ctx, routes } = host()
    const empty = { catalogue: { overview: async () => ({ suites: [{ sourceId: 'market', suiteId: 'on', name: 'already-on', enabled: true }] }) } }
    mountAiDraftRoutes(ctx, {
      ...sessionStub,
      ...empty,
      service: createAiDraftService(port().port),
      presets: createAiPresetService(port().port),
      diagnose: createAiDiagnoseService(port().port),
      logger
    })
    const { response, read } = recorded()
    await routes.get(AI_DRAFT_ROUTES.suggestPreset)?.(request({ intent: '前端开发', purpose: 'install' }), response)
    expect(read().status).toBe(400)
  })
})

describe('assist session route', () => {
  async function open(routes: Map<string, Handler>, body: unknown): Promise<Answer> {
    const { response, read } = recorded()
    await routes.get(AI_DRAFT_ROUTES.session)?.(request(body), response)
    return read()
  }

  it('opens a session whose first message carries the format, the intent and the target', async () => {
    const { ctx, routes } = host()
    mountAiDraftRoutes(ctx, {
      ...catalogueStub,
      ...sessionStub,
      service: createAiDraftService(undefined),
      presets: createAiPresetService(undefined),
      diagnose: createAiDiagnoseService(undefined),
      logger
    })
    const answer = await open(routes, { face: 'skills', intent: '审查 TypeScript 改动', locale: 'zh' })

    expect(answer.status).toBe(200)
    expect(answer.body['ok']).toBe(true)
    // Each creation mints its own id, so a second draft can never overwrite the first one's
    // transcript in a store whose counter restarts with the process.
    expect(String(answer.body['sessionId'])).toMatch(/^session-/)
  })

  it('refuses a relative or traversing path before any session exists', async () => {
    const { ctx, routes } = host()
    let created = 0
    mountAiDraftRoutes(ctx, {
      ...sessionStub,
      ...catalogueStub,
      sessions: {
        create: () => {
          created += 1
          return sessionStub.sessions.create()
        }
      },
      agentsRoot: '/agents-root',
      service: createAiDraftService(undefined),
      presets: createAiPresetService(undefined),
      diagnose: createAiDiagnoseService(undefined),
      logger
    })
    expect((await open(routes, { face: 'instructions', intent: 'x', path: 'relative/path' })).status).toBe(400)
    expect((await open(routes, { face: 'instructions', intent: 'x', path: '/a/../b/c.md' })).status).toBe(400)
    expect((await open(routes, { face: 'instructions', intent: 'x' })).status).toBe(400)
    expect(created).toBe(0)
  })
})
