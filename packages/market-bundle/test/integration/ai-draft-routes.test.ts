/**
 * The remaining AI routes: a preset suggestion and a failure explanation.
 *
 * Both take a bounded request and answer with text a person reads; neither writes to disk.
 * These tests pin the bounds, the failure codes the client renders, and the rule that the
 * model only ever picks from what the server already offered it.
 */
import { describe, expect, it } from 'vitest'
import { AI_DRAFT_ROUTES } from '../../../../packages/market-contracts/src/contracts/ai-draft.js'
import type { AiPort } from '../../../../packages/market-bundle/src/application/ai-port.js'
import { createAiPresetService, parsePresetSuggestion } from '../../../../packages/market-bundle/src/application/ai-preset.js'
import { createAiDiagnoseService } from '../../../../packages/market-bundle/src/application/ai-diagnose.js'
import { mountAiDraftRoutes } from '../../../../packages/market-bundle/src/routes-ai.js'

type Handler = (req: unknown, res: unknown) => void | Promise<void>
interface Answer {
  status: number
  body: Record<string, unknown>
}

const logger = { warn: (): void => {}, info: (): void => {}, error: (): void => {} }

/** The host surface the routes mount on. */
function host(): { ctx: { get: (name: string) => unknown }; routes: Map<string, Handler> } {
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

/** A response recorder. */
function recorded(): { response: unknown; read: () => Answer } {
  let status = 0
  let payload = ''
  return {
    response: { writeHead: (code: number) => (status = code), end: (text: string) => (payload = text) },
    read: () => ({ status, body: JSON.parse(payload) as Record<string, unknown> })
  }
}

/** A trusted same-origin POST, shaped as the stream `readJsonBody` reads. */
function request(body: unknown): unknown {
  const text = JSON.stringify(body)
  const stream = {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:56780', host: '127.0.0.1:56780' },
    on(event: string, listener: (value?: unknown) => void) {
      // Body first, then the end of it: the reader attaches both before either fires.
      if (event === 'data') setTimeout(() => listener(Buffer.from(text)), 0)
      if (event === 'end') setTimeout(() => listener(), 5)
      return stream
    }
  }
  return stream
}

/** A catalogue with one installable suite and one already on. */
const catalogueStub = {
  catalogue: {
    overview: async () => ({
      suites: [
        { sourceId: 'market', suiteId: 'frontend', name: 'frontend-suite' },
        { sourceId: 'market', suiteId: 'on', name: 'already-on', enabled: true }
      ]
    })
  }
}

/** A port that answers a fixed artifact and records what it was asked. */
function port(answer = '---\ndescription: 测试\n---\n\nBody'): { port: AiPort; calls: Array<{ system: string; user: string }> } {
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

describe('ai preset suggestion', () => {
  const candidates = [
    { id: 'market:src/frontend', label: 'frontend-suite' },
    { id: 'market:src/testing', label: 'testing-suite' },
    { id: 'skills:src/frontend/review', label: 'review' }
  ]

  /** A port that answers with whatever JSON the model would have produced. */
  const answering = (text: string): AiPort => ({ complete: async () => ({ text, provider: 'deepseek', model: 'fixture' }) })

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
    const port: AiPort = {
      complete: async () => {
        called++
        return { text: '{"name":"x"}', provider: 'p', model: 'm' }
      }
    }
    mountAiDraftRoutes(ctx, {
      ...catalogueStub,
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
      presets: createAiPresetService(port),
      diagnose: createAiDiagnoseService(port),
      logger
    })
    const answer = await suggest(routes, { intent: '前端开发', candidates })
    // The model answered prose where JSON was required: that is an unusable answer, not a
    // limit, because the text carries no limit signal from the provider.
    expect(answer.status).toBe(422)

    const limited: AiPort = {
      complete: async () => {
        throw new Error('provider error (429): usage limit reached')
      }
    }
    const second = host()
    mountAiDraftRoutes(second.ctx, {
      ...catalogueStub,
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
      ...catalogueStub,
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
      ...catalogueStub,
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
      ...catalogueStub,
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
    const port: AiPort = {
      complete: async prompt => ({
        text: prompt.user.includes('frontend-suite') ? '{"name":"前端","reason":"够用","picks":["market/frontend","market/on"]}' : '{}',
        provider: 'p',
        model: 'm'
      })
    }
    mountAiDraftRoutes(ctx, {
      ...catalogueStub,
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
      ...empty,
      presets: createAiPresetService(port().port),
      diagnose: createAiDiagnoseService(port().port),
      logger
    })
    const { response, read } = recorded()
    await routes.get(AI_DRAFT_ROUTES.suggestPreset)?.(request({ intent: '前端开发', purpose: 'install' }), response)
    expect(read().status).toBe(400)
  })
})
