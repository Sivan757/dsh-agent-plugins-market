/**
 * The ordered provider chain: fallback order, timeouts, and the circuit breaker.
 *
 * Providers are hand-built stubs so each case isolates one property of the
 * chain rather than the behaviour of a real endpoint.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROVIDER_TIMEOUT_MS, isTripped, resetCircuitBreaker, runChain, type TranslationProvider } from '../src/application/translation/chain.js'
import type { TranslationProviderId } from '../src/contracts/translation.js'

afterEach(() => {
  resetCircuitBreaker()
  vi.useRealTimers()
})

/** One stub provider; omit an override to accept the default behaviour. */
function provider(id: TranslationProviderId, overrides: Partial<TranslationProvider> = {}): TranslationProvider {
  return {
    id,
    available: () => true,
    translate: async ({ texts }) => texts.map(text => '[' + id + '] ' + text),
    ...overrides
  }
}

describe('runChain', () => {
  it('returns the first provider that answers', async () => {
    const result = await runChain([provider('google'), provider('microsoft')], ['hello'], 'zh')
    expect(result.provider).toBe('google')
    expect(result.texts).toEqual(['[google] hello'])
  })

  it('falls through to the next provider when the first throws', async () => {
    const google = provider('google', {
      translate: async () => {
        throw new Error('network down')
      }
    })
    const result = await runChain([google, provider('microsoft')], ['hello'], 'zh')
    expect(result.provider).toBe('microsoft')
    expect(result.texts).toEqual(['[microsoft] hello'])
  })

  it('skips a provider that reports itself unavailable', async () => {
    const google = provider('google', { available: () => false })
    const result = await runChain([google, provider('microsoft')], ['hello'], 'zh')
    expect(result.provider).toBe('microsoft')
  })

  it('rejects a short result and falls through', async () => {
    const google = provider('google', { translate: async () => ['only one'] })
    const result = await runChain([google, provider('microsoft')], ['a', 'b'], 'zh')
    expect(result.provider).toBe('microsoft')
    expect(result.texts).toHaveLength(2)
  })

  it('throws with every reason when no provider can serve the batch', async () => {
    const failing = provider('google', {
      translate: async () => {
        throw new Error('boom')
      }
    })
    await expect(runChain([failing, provider('microsoft', { available: () => false })], ['x'], 'zh')).rejects.toThrow(/google: boom; microsoft: unavailable/)
  })

  it('rejects an empty batch rather than calling a provider', async () => {
    const translate = vi.fn()
    await expect(runChain([provider('google', { translate })], [], 'zh')).rejects.toThrow(/nothing to translate/)
    expect(translate).not.toHaveBeenCalled()
  })

  it('trips the breaker so a failed provider is skipped for the rest of the process', async () => {
    const google = provider('google', {
      translate: async () => {
        throw new Error('blocked network')
      }
    })
    await runChain([google, provider('microsoft')], ['one'], 'zh')
    expect(isTripped('google')).toBe(true)

    // The second call never reaches google again, even though it is available.
    const spy = vi.fn(async () => ['reached'])
    const second = await runChain([provider('google', { translate: spy }), provider('microsoft')], ['two'], 'zh')
    expect(spy).not.toHaveBeenCalled()
    expect(second.provider).toBe('microsoft')
  })

  it('does not trip the breaker on caller cancellation', async () => {
    const controller = new AbortController()
    const google = provider('google', {
      translate: async () => {
        controller.abort()
        throw new Error('aborted')
      }
    })
    await expect(runChain([google, provider('microsoft')], ['x'], 'zh', controller.signal)).rejects.toThrow(/cancelled/)
    expect(isTripped('google')).toBe(false)
  })

  it('times a hung provider out and moves on', async () => {
    vi.useFakeTimers()
    const google = provider('google', {
      translate: request =>
        new Promise((_resolve, reject) => {
          request.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
    })
    const pending = runChain([google, provider('microsoft')], ['hello'], 'zh')
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS.google + 1)
    const result = await pending
    expect(result.provider).toBe('microsoft')
  })

  it('gives each provider the documented budget', () => {
    expect(PROVIDER_TIMEOUT_MS.google).toBeLessThan(PROVIDER_TIMEOUT_MS.microsoft)
    expect(PROVIDER_TIMEOUT_MS.microsoft).toBeLessThan(PROVIDER_TIMEOUT_MS.llm)
  })
})
