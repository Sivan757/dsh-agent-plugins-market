import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDocumentTranslation, fetchSuiteDocumentTranslation, fetchModelCatalog, fetchOverview, READ_TIMEOUT_MS } from '../packages/market-ui/src/api.js'
import { RequestTimeoutError } from '../packages/market-ui/src/request-error.js'
import { clientErrorMessage } from '../packages/market-ui/src/ui/error-message.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('client request bounds', () => {
  it.each(['panel', 'market'] as const)('bounds stalled %s translation response bodies by the read deadline', async surface => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        signal = init.signal ?? undefined
        return { ok: true, json: () => new Promise<never>(() => {}) } as unknown as Response
      })
    )
    const work = surface === 'panel' ? fetchDocumentTranslation('skills', 'audit') : fetchSuiteDocumentTranslation('source', 'suite', 'skills', 'audit')
    const rejected = expect(work).rejects.toBeInstanceOf(RequestTimeoutError)
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS)
    await rejected
    expect(signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('bounds translation fetch even when its implementation ignores abort', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<never>(() => {}))
    )
    const rejected = expect(fetchDocumentTranslation('skills', 'audit')).rejects.toBeInstanceOf(RequestTimeoutError)
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each(['panel', 'market'] as const)('preserves bilingual document content from the %s transport', async surface => {
    const payload = { text: '译文', bilingualText: 'Original\n译文', pending: 2 }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, ...payload }), { status: 200 }))
    vi.stubGlobal('fetch', fetcher)
    const result = surface === 'panel' ? await fetchDocumentTranslation('skills', 'audit') : await fetchSuiteDocumentTranslation('source', 'suite', 'skills', 'audit')
    expect(result).toEqual(payload)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('honours a caller signal that was already aborted', async () => {
    // The editor aborts a superseded model read on unmount; by then the signal
    // has no listener left to fire, so the request must not start anyway.
    const controller = new AbortController()
    controller.abort()
    const observed: Array<boolean | undefined> = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        observed.push(init.signal?.aborted)
        return Promise.resolve(new Response('{}', { status: 200 }))
      })
    )
    await expect(fetchModelCatalog('deepseek', controller.signal)).rejects.toBe(controller.signal.reason)
    expect(observed).toEqual([])
  })

  it('stops waiting on a read at the deadline instead of holding the page', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            ;(init.signal as AbortSignal).addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
          })
      )
    )
    const pending = fetchOverview()
    const failure = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError)
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS)
    await failure
  })

  it('reads a timeout as the shared label and keeps every other message', () => {
    const t = (key: 'requestTimeout'): string => `label:${key}`
    expect(clientErrorMessage(t, new RequestTimeoutError(1_000))).toBe('label:requestTimeout')
    expect(clientErrorMessage(t, new Error('mount failed'))).toBe('mount failed')
    expect(clientErrorMessage(t, 'plain text')).toBe('plain text')
  })
})
