import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchModelCatalog, fetchOverview, READ_TIMEOUT_MS } from '../src/client/api.js'
import { RequestTimeoutError } from '../src/client/request-error.js'
import { clientErrorMessage } from '../src/client/ui/error-message.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('client request bounds', () => {
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
    await fetchModelCatalog('deepseek', controller.signal)
    expect(observed).toEqual([true])
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
