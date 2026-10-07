import { afterEach, describe, expect, it, vi } from 'vitest'
import { runChain, resetCircuitBreaker } from '../src/application/translation/chain.js'
import { googleTranslate, microsoftTranslate } from '../src/runtime/host/machine-translator.js'
import { createTranslationProviders } from '../src/runtime/host/translation-providers.js'

/** One recorded fetch call, with the request the adapter built. */
interface RecordedCall {
  url: string
  init: RequestInit | undefined
}

/**
 * Replace the global fetch with a recorder.
 *
 * The adapters talk to the public internet; every case here answers from a
 * canned response so the suite never leaves the machine.
 */
function recordFetch(respond: (call: RecordedCall) => Response): RecordedCall[] {
  const calls: RecordedCall[] = []
  vi.stubGlobal('fetch', async (url: unknown, init?: RequestInit): Promise<Response> => {
    const call: RecordedCall = { url: String(url), init }
    calls.push(call)
    return respond(call)
  })
  return calls
}

/** A JSON response with the given status. */
function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

/** A request carrying the given batch, targeting Simplified Chinese. */
function request(texts: readonly string[], locale = 'zh'): { texts: readonly string[]; locale: string; signal: AbortSignal } {
  return { texts, locale, signal: new AbortController().signal }
}

/** The headers of one recorded call, as a plain lookup. */
function headersOf(call: RecordedCall | undefined): Record<string, string> {
  return (call?.init?.headers ?? {}) as Record<string, string>
}

/**
 * The request body of one recorded call.
 *
 * The adapters always send a string, but `RequestInit.body` is a union that
 * includes streams, so the value is narrowed here rather than at each use.
 */
function bodyOf(call: RecordedCall | undefined): string {
  const body = call?.init?.body
  return typeof body === 'string' ? body : ''
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('googleTranslate', () => {
  it('auto-detects Chinese source while targeting English', async () => {
    const calls = recordFetch(() => jsonResponse([['Read files']]))
    expect(await googleTranslate(request(['读取文件'], 'en'))).toEqual({ texts: ['Read files'], provider: 'google' })
    expect(JSON.parse(bodyOf(calls[0]))).toEqual([[['读取文件'], 'auto', 'en'], 'wt_lib'])
  })

  it('posts the protobuf envelope and returns the inner batch', async () => {
    const calls = recordFetch(() => jsonResponse([['你好', '世界']]))
    const result = await googleTranslate(request(['Hello', 'World']))
    expect(result).toEqual({ texts: ['你好', '世界'], provider: 'google' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://translate-pa.googleapis.com/v1/translateHtml')
    expect(calls[0]?.init?.method).toBe('POST')
    // The endpoint's envelope: [texts, from, to] tagged `wt_lib`.
    expect(JSON.parse(bodyOf(calls[0]))).toEqual([[['Hello', 'World'], 'auto', 'zh'], 'wt_lib'])
  })

  it('sends the protobuf content type and the public API key header', async () => {
    const calls = recordFetch(() => jsonResponse([['你好']]))
    await googleTranslate(request(['Hello']))
    const headers = headersOf(calls[0])
    expect(headers['content-type']).toBe('application/json+protobuf')
    expect(headers['x-goog-api-key']).toMatch(/^AIza/)
  })

  it('forwards the caller signal', async () => {
    const calls = recordFetch(() => jsonResponse([['你好']]))
    const controller = new AbortController()
    await googleTranslate({ texts: ['Hello'], locale: 'zh', signal: controller.signal })
    expect(calls[0]?.init?.signal).toBe(controller.signal)
  })

  it('keeps a plain zh target rather than a region-qualified tag', async () => {
    const calls = recordFetch(() => jsonResponse([['你好']]))
    await googleTranslate(request(['Hello']))
    expect(JSON.parse(bodyOf(calls[0]))).toEqual([[['Hello'], 'auto', 'zh'], 'wt_lib'])
  })

  it('passes a non-Chinese locale through unchanged', async () => {
    const calls = recordFetch(() => jsonResponse([['こんにちは']]))
    await googleTranslate(request(['Hello'], 'ja'))
    expect(JSON.parse(bodyOf(calls[0]))).toEqual([[['Hello'], 'auto', 'ja'], 'wt_lib'])
  })

  it('forwards a script-qualified tag rather than flattening it to zh', async () => {
    // Flattening `zh-Hant` to `zh` would silently answer in Simplified.
    const calls = recordFetch(() => jsonResponse([['你好']]))
    await googleTranslate(request(['Hello'], 'zh-Hant'))
    expect(JSON.parse(bodyOf(calls[0]))).toEqual([[['Hello'], 'auto', 'zh-Hant'], 'wt_lib'])
  })

  it('returns an empty batch without touching the network', async () => {
    const calls = recordFetch(() => jsonResponse([[]]))
    expect(await googleTranslate(request([]))).toEqual({ texts: [], provider: 'google' })
    expect(calls).toHaveLength(0)
  })

  it('rejects a non-2xx answer with the status and the body head', async () => {
    const body = 'x'.repeat(300)
    recordFetch(() => new Response(body, { status: 429 }))
    await expect(googleTranslate(request(['Hello']))).rejects.toThrow(/HTTP 429/)
    await expect(googleTranslate(request(['Hello']))).rejects.toThrow(new RegExp('x'.repeat(200)))
  })

  it('rejects a batch whose length does not match the request', async () => {
    recordFetch(() => jsonResponse([['only one']]))
    await expect(googleTranslate(request(['a', 'b']))).rejects.toThrow(/google translate: expected 2 results, got 1/)
  })

  it('rejects an answer that is not an array of strings', async () => {
    recordFetch(() => jsonResponse([{ text: '你好' }]))
    await expect(googleTranslate(request(['Hello']))).rejects.toThrow(/google translate: expected 1 results, got not an array/)
  })

  it('prefixes a network failure with the provider name', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED')
    })
    await expect(googleTranslate(request(['Hello']))).rejects.toThrow(/^google translate: ECONNREFUSED$/)
  })
})

describe('microsoftTranslate', () => {
  it('omits the source language so Chinese can translate into English', async () => {
    const calls = recordFetch(() => jsonResponse([{ translations: [{ text: 'Read files' }] }]))
    expect(await microsoftTranslate(request(['读取文件'], 'en'))).toEqual({ texts: ['Read files'], provider: 'microsoft' })
    const url = new URL(calls[0]!.url)
    expect(url.searchParams.has('from')).toBe(false)
    expect(url.searchParams.get('to')).toBe('en')
  })

  it('posts the bare array and reads the translations back in order', async () => {
    const calls = recordFetch(() => jsonResponse([{ translations: [{ text: '你好' }] }, { translations: [{ text: '世界' }] }]))
    const result = await microsoftTranslate(request(['Hello', 'World']))
    expect(result).toEqual({ texts: ['你好', '世界'], provider: 'microsoft' })
    expect(calls[0]?.url).toBe('https://edge.microsoft.com/translate/translatetext?to=zh-Hans&isEnterpriseClient=false')
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.body).toBe(JSON.stringify(['Hello', 'World']))
  })

  it('sends only the JSON content type, with no credential', async () => {
    const calls = recordFetch(() => jsonResponse([{ translations: [{ text: '你好' }] }]))
    await microsoftTranslate(request(['Hello']))
    expect(headersOf(calls[0])).toEqual({ 'content-type': 'application/json' })
  })

  it('passes a non-Chinese locale through unchanged', async () => {
    const calls = recordFetch(() => jsonResponse([{ translations: [{ text: 'こんにちは' }] }]))
    await microsoftTranslate(request(['Hello'], 'ja'))
    expect(calls[0]?.url).toContain('to=ja')
  })

  it('forwards a script-qualified tag rather than forcing zh-Hans', async () => {
    // `zh-Hant` already names its script; forcing Simplified would mistranslate.
    const calls = recordFetch(() => jsonResponse([{ translations: [{ text: '你好' }] }]))
    await microsoftTranslate(request(['Hello'], 'zh-Hant'))
    expect(calls[0]?.url).toContain('to=zh-Hant')
  })

  it('returns an empty batch without touching the network', async () => {
    const calls = recordFetch(() => jsonResponse([]))
    expect(await microsoftTranslate(request([]))).toEqual({ texts: [], provider: 'microsoft' })
    expect(calls).toHaveLength(0)
  })

  it('rejects a non-2xx answer with the status and the body head', async () => {
    const body = 'y'.repeat(300)
    recordFetch(() => new Response(body, { status: 503 }))
    await expect(microsoftTranslate(request(['Hello']))).rejects.toThrow(/HTTP 503/)
    await expect(microsoftTranslate(request(['Hello']))).rejects.toThrow(new RegExp('y'.repeat(200)))
  })

  it('rejects a batch whose length does not match the request', async () => {
    recordFetch(() => jsonResponse([{ translations: [{ text: 'only one' }] }]))
    await expect(microsoftTranslate(request(['a', 'b']))).rejects.toThrow(/microsoft translate: expected 2 results, got 1/)
  })

  it('rejects an entry that carries no translation text', async () => {
    recordFetch(() => jsonResponse([{}]))
    await expect(microsoftTranslate(request(['Hello']))).rejects.toThrow(/microsoft translate: expected 1 results, but 1 carried no text/)
  })

  it('rejects a payload that is not an array', async () => {
    recordFetch(() => jsonResponse({ error: 'nope' }))
    await expect(microsoftTranslate(request(['Hello']))).rejects.toThrow(/microsoft translate: expected 1 results, got not an array/)
  })

  it('prefixes a network failure with the provider name', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ENOTFOUND')
    })
    await expect(microsoftTranslate(request(['Hello']))).rejects.toThrow(/^microsoft translate: ENOTFOUND$/)
  })
})
describe('createTranslationProviders', () => {
  /** A stub model provider that answers by echoing a marker. */
  function stubLlm(texts: readonly string[]): { id: 'llm'; available: () => boolean; translate: (request: { texts: readonly string[] }) => Promise<string[]> } {
    return {
      id: 'llm',
      available: () => true,
      translate: async (request: { texts: readonly string[] }) => request.texts.map(text => `[llm] ${text}`)
    }
  }

  it('orders the chain google -> microsoft and omits an absent model hop', () => {
    const providers = createTranslationProviders({ host: {} })
    expect(providers.map(provider => provider.id)).toEqual(['google', 'microsoft'])
  })

  it('appends the model hop last when the caller supplies one', () => {
    const providers = createTranslationProviders({ host: {}, llm: stubLlm([]) })
    expect(providers.map(provider => provider.id)).toEqual(['google', 'microsoft', 'llm'])
  })

  it('reports both keyless endpoints available without a host seam', () => {
    const providers = createTranslationProviders({ host: {} })
    expect(providers.every(provider => provider.available())).toBe(true)
  })

  it('masks before the request leaves and restores what comes back', async () => {
    const seen: string[][] = []
    recordFetch(call => {
      // The body is `[[texts, from, to], "wt_lib"]`; the batch is nested inside it.
      const envelope = JSON.parse(bodyOf(call)) as [[string[], string, string], string]
      const batch = envelope[0][0]
      seen.push(batch)
      // Answer in the endpoint's shape, echoing the masked payload back.
      return jsonResponse([batch])
    })
    const [google] = createTranslationProviders({ host: {} })
    const result = await google?.translate(request(['Run MCP now']))
    // The endpoint saw placeholders, and the caller got the original terms.
    expect(seen[0]).toEqual(['Run ⟦K1⟧ now'])
    expect(result).toEqual(['Run MCP now'])
  })

  it('rejects the whole batch when the answer lost a placeholder', async () => {
    // The engine kept one term and dropped the other.
    recordFetch(() => jsonResponse([['⟦K1⟧']]))
    const [google] = createTranslationProviders({ host: {} })
    await expect(google?.translate(request(['MCP and LSP']))).rejects.toThrow(/lost or duplicated a placeholder/)
  })

  it('rejects the whole batch when the answer invented a placeholder', async () => {
    recordFetch(() => jsonResponse([['⟦K1⟧ ⟦K9⟧']]))
    const [google] = createTranslationProviders({ host: {} })
    await expect(google?.translate(request(['MCP']))).rejects.toThrow(/lost or duplicated a placeholder/)
  })

  it('leaves the model hop unmasked text when it masks nothing', async () => {
    const providers = createTranslationProviders({ host: {}, llm: stubLlm([]) })
    const llm = providers[2]
    expect(await llm?.translate(request(['plain words']))).toEqual(['[llm] plain words'])
  })
})
describe('the host chain through runChain', () => {
  afterEach(() => {
    resetCircuitBreaker()
  })

  it('answers through google and hands back restored text', async () => {
    recordFetch(call => {
      const envelope = JSON.parse(bodyOf(call)) as [[string[], string, string], string]
      return jsonResponse([envelope[0][0]])
    })
    const providers = createTranslationProviders({ host: {} })
    const result = await runChain(providers, ['Use MCP here'], 'zh')
    expect(result.provider).toBe('google')
    expect(result.texts).toEqual(['Use MCP here'])
  })

  it('falls through to microsoft when google fails, with masking intact on both hops', async () => {
    const seen: string[] = []
    recordFetch(call => {
      if (call.url.includes('googleapis')) return new Response('blocked', { status: 403 })
      const batch = JSON.parse(bodyOf(call)) as string[]
      seen.push(...batch)
      return jsonResponse(batch.map(text => ({ translations: [{ text }] })))
    })
    const providers = createTranslationProviders({ host: {} })
    const result = await runChain(providers, ['Read https://example.com/docs'], 'zh')
    expect(result.provider).toBe('microsoft')
    // Microsoft saw the placeholder, and the caller got the URL back.
    expect(seen).toEqual(['Read ⟦U1⟧'])
    expect(result.texts).toEqual(['Read https://example.com/docs'])
  })

  it('skips a provider the breaker already tripped', async () => {
    const urls: string[] = []
    // Google fails, Microsoft answers: only the first hop is taken out.
    recordFetch(call => {
      urls.push(call.url)
      if (call.url.includes('googleapis')) return new Response('down', { status: 500 })
      const batch = JSON.parse(bodyOf(call)) as string[]
      return jsonResponse(batch.map(text => ({ translations: [{ text }] })))
    })
    const providers = createTranslationProviders({ host: {} })
    expect((await runChain(providers, ['Hello'], 'zh')).provider).toBe('microsoft')
    urls.length = 0
    expect((await runChain(providers, ['Hello'], 'zh')).provider).toBe('microsoft')
    // The second batch goes straight to the fallback; google is never retried.
    expect(urls.some(url => url.includes('googleapis'))).toBe(false)
    expect(urls.some(url => url.includes('edge.microsoft.com'))).toBe(true)
  })
})
