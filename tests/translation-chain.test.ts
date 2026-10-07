/**
 * The ordered provider chain: fallback order, timeouts, and the circuit breaker.
 *
 * Providers are hand-built stubs so each case isolates one property of the
 * chain rather than the behaviour of a real endpoint.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROVIDER_TIMEOUT_MS, isTripped, resetCircuitBreaker, runChain, type TranslationProvider } from '../packages/market-translation/src/application/translation/chain.js'
import type { TranslationProviderId } from '../packages/market-contracts/src/contracts/translation.js'
import { createLlmTranslator } from '../packages/market-translation/src/runtime/host/llm-translator.js'

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

  it('rejects a late successful response after caller cancellation without retiring the provider', async () => {
    const controller = new AbortController()
    const google = provider('google', {
      translate: async () => {
        controller.abort()
        return ['late answer']
      }
    })
    const fallback = vi.fn(async () => ['fallback'])
    await expect(runChain([google, provider('llm', { translate: fallback })], ['text'], 'zh', controller.signal)).rejects.toThrow(/cancelled/)
    expect(fallback).not.toHaveBeenCalled()
    expect(isTripped('google')).toBe(false)
  })

  it('stops future hops when the live work gate closes during a provider failure', async () => {
    let enabled = true
    const google = provider('google', {
      translate: async () => {
        enabled = false
        throw new Error('offline')
      }
    })
    const fallback = vi.fn(async () => ['fallback'])
    await expect(runChain([google, provider('llm', { translate: fallback })], ['text'], 'zh', undefined, () => enabled)).rejects.toThrow(/cancelled/)
    expect(fallback).not.toHaveBeenCalled()
    expect(isTripped('google')).toBe(false)
  })

  it('falls back by the deadline even when the provider ignores its abort signal', async () => {
    vi.useFakeTimers()
    let outcome = 'pending'
    let signal: AbortSignal | undefined
    const google = provider('google', {
      translate: request => {
        signal = request.signal
        return new Promise<string[]>(() => {})
      }
    })
    void runChain([google, provider('microsoft')], ['hello'], 'zh').then(
      result => {
        outcome = result.provider
      },
      () => {
        outcome = 'rejected'
      }
    )
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS.google + 1)
    expect(signal?.aborted).toBe(true)
    expect(outcome).toBe('microsoft')
    expect(isTripped('google')).toBe(true)
  })

  it('settles caller cancellation when the provider ignores its abort signal', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let outcome = 'pending'
    const translate = vi.fn(() => new Promise<string[]>(() => {}))
    const fallback = vi.fn(async () => ['fallback'])
    void runChain([provider('google', { translate }), provider('microsoft', { translate: fallback })], ['hello'], 'zh', controller.signal).then(
      () => {
        outcome = 'resolved'
      },
      () => {
        outcome = 'cancelled'
      }
    )
    controller.abort()
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toBe('cancelled')
    expect(fallback).not.toHaveBeenCalled()
    expect(isTripped('google')).toBe(false)
  })

  it('bounds the real LLM adapter when its host capability lookup never settles', async () => {
    vi.useFakeTimers()
    let outcome = 'pending'
    const stream = vi.fn()
    const resolveCallConfig = vi.fn(() => new Promise<unknown>(() => {}))
    const translator = createLlmTranslator({
      get: name => (name === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'synthetic', model: 'synthetic' }) } : { stream, resolveCallConfig })
    })
    void runChain([translator], ['Translate this sentence'], 'zh').then(
      () => {
        outcome = 'resolved'
      },
      () => {
        outcome = 'rejected'
      }
    )
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS.llm + 1)
    expect(resolveCallConfig).toHaveBeenCalledTimes(1)
    expect(stream).not.toHaveBeenCalled()
    expect(outcome).toBe('rejected')
    expect(isTripped('llm')).toBe(true)
  })

  it('bounds the real LLM adapter when the stream stops yielding without honoring abort', async () => {
    vi.useFakeTimers()
    let outcome = 'pending'
    const next = vi.fn(() => new Promise<IteratorResult<never>>(() => {}))
    const translator = createLlmTranslator({
      get: name =>
        name === 'agentDefaultModel'
          ? { currentSelection: () => ({ provider: 'synthetic', model: 'synthetic', reasoningEffort: 'off' }) }
          : { stream: () => ({ [Symbol.asyncIterator]: () => ({ next }) }) }
    })
    void runChain([translator], ['Translate this sentence'], 'zh').then(
      () => {
        outcome = 'resolved'
      },
      () => {
        outcome = 'rejected'
      }
    )
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS.llm + 1)
    expect(next).toHaveBeenCalledTimes(1)
    expect(outcome).toBe('rejected')
    expect(isTripped('llm')).toBe(true)
  })

  it('ignores a late provider success after fallback and removes its deadline timer', async () => {
    vi.useFakeTimers()
    let resolveLate: (texts: string[]) => void = () => {}
    let outcome = 'pending'
    const google = provider('google', {
      translate: () =>
        new Promise<string[]>(resolve => {
          resolveLate = resolve
        })
    })
    const result = runChain([google, provider('microsoft')], ['hello'], 'zh')
    void result.then(
      answer => {
        outcome = answer.provider
      },
      () => {
        outcome = 'rejected'
      }
    )
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS.google + 1)
    expect(outcome).toBe('microsoft')
    resolveLate(['stale answer'])
    await vi.advanceTimersByTimeAsync(0)
    expect((await result).texts).toEqual(['[microsoft] hello'])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('observes a late provider rejection after fallback without an unhandled error', async () => {
    vi.useFakeTimers()
    let rejectLate: (error: Error) => void = () => {}
    let outcome = 'pending'
    const google = provider('google', {
      translate: () =>
        new Promise<string[]>((_resolve, reject) => {
          rejectLate = reject
        })
    })
    void runChain([google, provider('microsoft')], ['hello'], 'zh').then(
      answer => {
        outcome = answer.provider
      },
      () => {
        outcome = 'rejected'
      }
    )
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS.google + 1)
    expect(outcome).toBe('microsoft')
    rejectLate(new Error('late failure'))
    await vi.advanceTimersByTimeAsync(0)
    expect(outcome).toBe('microsoft')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start a model stream when capability lookup completes after cancellation', async () => {
    vi.useFakeTimers()
    let resolveLookup: (value: unknown) => void = () => {}
    let outcome = 'pending'
    const stream = vi.fn(() => ({
      async *[Symbol.asyncIterator]() {
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }))
    const translator = createLlmTranslator({
      get: name =>
        name === 'agentDefaultModel'
          ? { currentSelection: () => ({ provider: 'synthetic', model: 'synthetic' }) }
          : {
              stream,
              resolveCallConfig: () =>
                new Promise<unknown>(resolve => {
                  resolveLookup = resolve
                })
            }
    })
    void runChain([translator], ['Translate this sentence'], 'zh').then(
      () => {
        outcome = 'resolved'
      },
      () => {
        outcome = 'rejected'
      }
    )
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS.llm + 1)
    expect(outcome).toBe('rejected')
    resolveLookup({})
    await vi.advanceTimersByTimeAsync(0)
    expect(stream).not.toHaveBeenCalled()
  })

  it('gives each provider the documented budget', () => {
    expect(PROVIDER_TIMEOUT_MS.google).toBeLessThan(PROVIDER_TIMEOUT_MS.microsoft)
    expect(PROVIDER_TIMEOUT_MS.microsoft).toBeLessThan(PROVIDER_TIMEOUT_MS.llm)
  })
})
