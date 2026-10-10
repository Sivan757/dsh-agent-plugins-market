import { describe, expect, it } from 'vitest'
import type { FinishReason, StreamChunk } from '@deepseek-ai/dsh-llm'
import { MAX_OUTPUT_TOKENS_CAP, createLlmTranslator, outputTokenBudget } from '../packages/market-translation/src/runtime/host/llm-translator.js'
import { isTripped, resetCircuitBreaker, runChain } from '../packages/market-translation/src/application/translation/chain.js'

/** A text delta for one assistant block, in the host's own chunk vocabulary. */
function textDelta(text: string, index = 0): StreamChunk {
  return { type: 'text-delta', index, text }
}

/** The terminal chunk every stream ends with. */
function finish(reason: FinishReason = { kind: 'stop' }): StreamChunk {
  return { type: 'finish', reason }
}

/** A stub host exposing only what the translator reads, resolved by name. */
function hostWith(options: {
  selection?: { provider: string; model: string; reasoningEffort?: string } | undefined
  stream?: (options: unknown) => AsyncIterable<StreamChunk>
  /** Answers resolveCallConfig; rejecting stands in for an unsupported effort. */
  resolveCallConfig?: (config: { provider: string; model: string; reasoningEffort?: string }) => Promise<unknown>
}): {
  get(name: string): unknown
} {
  return {
    get(name: string) {
      if (name === 'agentDefaultModel') {
        return options.selection === undefined ? undefined : { currentSelection: () => options.selection }
      }
      if (name === 'llm') {
        if (options.stream === undefined) return undefined
        return {
          stream: options.stream,
          ...(options.resolveCallConfig === undefined ? {} : { resolveCallConfig: options.resolveCallConfig })
        }
      }
      return undefined
    }
  }
}

/** A stream that yields the given chunks in order. */
function streamOf(chunks: StreamChunk[]): (options?: unknown) => AsyncIterable<StreamChunk> {
  return () => ({
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    }
  })
}

describe('createLlmTranslator availability', () => {
  it('reports unavailable with no model route and becomes available once one lands', () => {
    // The host provisions services after apply(), so availability is read per call.
    const services: {
      selection?: { provider: string; model: string }
      stream?: (options: unknown) => AsyncIterable<StreamChunk>
    } = {}
    const host = {
      get(name: string) {
        if (name === 'agentDefaultModel') return services.selection === undefined ? undefined : { currentSelection: () => services.selection }
        if (name === 'llm') return services.stream === undefined ? undefined : { stream: services.stream }
        return undefined
      }
    }
    const translator = createLlmTranslator(host)
    expect(translator.available()).toBe(false)
    services.selection = { provider: 'local', model: 'deepseek-flash' }
    expect(translator.available()).toBe(false)
    services.stream = streamOf([textDelta('管理套件来源'), finish()])
    expect(translator.available()).toBe(true)
  })

  it('reports unavailable when the selection is half-specified or blank', () => {
    for (const selection of [
      { provider: 'local', model: '' },
      { provider: '', model: 'm' }
    ]) {
      expect(createLlmTranslator(hostWith({ selection, stream: streamOf([]) })).available()).toBe(false)
    }
  })

  it('reports unavailable when the default-model service throws', () => {
    const host = {
      get(name: string) {
        if (name === 'agentDefaultModel') {
          return {
            currentSelection: () => {
              throw new Error('not provisioned')
            }
          }
        }
        return { stream: streamOf([]) }
      }
    }
    expect(createLlmTranslator(host).available()).toBe(false)
  })
})

describe('createLlmTranslator translate', () => {
  it('requests English for Chinese source without rewriting the source message', async () => {
    const seen: Array<Record<string, unknown>> = []
    const provider = createLlmTranslator(
      hostWith({
        selection: { provider: 'local', model: 'm' },
        stream: options => {
          seen.push(options as Record<string, unknown>)
          return streamOf([textDelta('Read files'), finish()])()
        }
      })
    )
    expect(await provider.translate({ texts: ['读取文件'], locale: 'en', signal: new AbortController().signal })).toEqual(['Read files'])
    expect(String(seen[0]?.system)).toContain('into English.')
    expect(JSON.stringify(seen[0]?.messages)).toContain('读取文件')
  })

  it('sends the selected route, the locale instruction, and the description', async () => {
    const seen: Array<Record<string, unknown>> = []
    const host = hostWith({
      selection: { provider: 'local', model: 'deepseek-flash' },
      stream: options => {
        seen.push(options as Record<string, unknown>)
        return streamOf([textDelta('管理套件来源'), finish()])()
      }
    })
    const [text] = await createLlmTranslator(host).translate({ texts: ['Manage suite sources'], locale: 'zh', signal: new AbortController().signal })
    expect(text).toBe('管理套件来源')
    expect(seen[0]).toMatchObject({ provider: 'local', model: 'deepseek-flash', temperature: 0, maxTokens: 512 })
    // The published purpose field accepts only compaction and session-title,
    // neither of which describes a translation, so the call leaves it unset.
    expect(seen[0]?.purpose).toBeUndefined()
    expect(String(seen[0]?.system)).toContain('Simplified Chinese')
    expect(JSON.stringify(seen[0]?.messages)).toContain('Manage suite sources')
  })

  it('names the language a target tag asks for, by script', async () => {
    const seen: Array<Record<string, unknown>> = []
    const host = hostWith({
      selection: { provider: 'local', model: 'm' },
      stream: options => {
        seen.push(options as Record<string, unknown>)
        return streamOf([textDelta('x'), finish()])()
      }
    })
    const translator = createLlmTranslator(host)
    // The layer resolves an interface preference to the language the market
    // renders (`resolveTranslationTarget`) before it calls the chain, so the
    // tags that arrive here name a language rather than a preference: a script
    // tag is answered in that script, and the market's own target is Chinese.
    for (const [locale, expected] of [
      ['zh', 'Simplified Chinese'],
      ['zh-CN', 'Simplified Chinese'],
      ['zh-Hant', 'Traditional Chinese'],
      ['en', 'English']
    ] as const) {
      await translator.translate({ texts: ['t'], locale, signal: new AbortController().signal })
      expect(String(seen.at(-1)?.system)).toContain('into ' + expected + '.')
    }
  })

  it('allows more output for Chinese-to-English batches while keeping the absolute cap', async () => {
    const seen: Array<Record<string, unknown>> = []
    const provider = createLlmTranslator(
      hostWith({
        selection: { provider: 'local', model: 'm' },
        stream: options => {
          seen.push(options as Record<string, unknown>)
          return streamOf([textDelta('Read files'), finish()])()
        }
      })
    )
    await provider.translate({ texts: ['文'.repeat(2_400)], locale: 'en', signal: new AbortController().signal })
    expect(seen[0]?.maxTokens).toBe(3_600)
    expect(outputTokenBudget(2_400, 'en')).toBeGreaterThan(outputTokenBudget(2_400, 'zh'))
    expect(outputTokenBudget(99_999, 'en')).toBe(MAX_OUTPUT_TOKENS_CAP)
  })

  it('sizes the output ceiling from the source the call carries', async () => {
    const seen: Array<Record<string, unknown>> = []
    const host = hostWith({
      selection: { provider: 'local', model: 'm' },
      stream: options => {
        seen.push(options as Record<string, unknown>)
        // Echo the turn back: a batched call then answers with the same number
        // of segments, which is all this case cares about.
        const messages = (options as { messages?: Array<{ content?: Array<{ text?: string }> }> }).messages
        return streamOf([textDelta(messages?.[0]?.content?.[0]?.text ?? '译文'), finish()])()
      }
    })
    const translator = createLlmTranslator(host)
    const long = 'word '.repeat(240)
    expect(long).toHaveLength(1_200)
    await translator.translate({ texts: [long], locale: 'zh', signal: new AbortController().signal })
    // A single text used to get 512 tokens whatever it was, which is where the
    // expansion of a ~1,200-character description stopped fitting.
    expect(seen[0]?.maxTokens).toBe(outputTokenBudget(1_200))
    expect(seen[0]?.maxTokens).toBeGreaterThan(512)

    // A short text keeps the floor; a full batch is sized by everything it
    // carries and stays under the call's ceiling.
    await translator.translate({ texts: ['Read files'], locale: 'zh', signal: new AbortController().signal })
    expect(seen.at(-1)?.maxTokens).toBe(outputTokenBudget('Read files'.length))
    expect(seen.at(-1)?.maxTokens).toBe(512)
    const batch = Array.from({ length: 20 }, () => 'x'.repeat(320))
    await translator.translate({ texts: batch, locale: 'zh', signal: new AbortController().signal })
    const batchBudget = seen.at(-1)?.maxTokens as number
    expect(batchBudget).toBeGreaterThan(outputTokenBudget(6_400))
    expect(batchBudget).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS_CAP)
  })

  it('asks for reasoning off, because the adapter default is high', async () => {
    // Translating a sentence is mechanical; the DeepSeek adapter would otherwise
    // spend reasoning tokens on every one of hundreds of descriptions.
    const seen: Array<Record<string, unknown>> = []
    const asked: Array<string | undefined> = []
    const host = hostWith({
      selection: { provider: 'local', model: 'deepseek-flash' },
      resolveCallConfig: async config => {
        asked.push(config.reasoningEffort)
        return config
      },
      stream: options => {
        seen.push(options as Record<string, unknown>)
        return streamOf([textDelta('中文'), finish()])()
      }
    })
    await createLlmTranslator(host).translate({ texts: ['t'], locale: 'zh', signal: new AbortController().signal })
    expect(asked).toEqual(['off'])
    expect(seen[0]?.reasoningEffort).toBe('off')
  })

  it('keeps the deployment effort when the user selected one', async () => {
    const seen: Array<Record<string, unknown>> = []
    const host = hostWith({
      selection: { provider: 'local', model: 'm', reasoningEffort: 'low' },
      resolveCallConfig: async () => {
        throw new Error('must not be consulted when the user chose an effort')
      },
      stream: options => {
        seen.push(options as Record<string, unknown>)
        return streamOf([textDelta('中文'), finish()])()
      }
    })
    await createLlmTranslator(host).translate({ texts: ['t'], locale: 'zh', signal: new AbortController().signal })
    expect(seen[0]?.reasoningEffort).toBe('low')
  })

  it('falls back to the adapter default when the route refuses off', async () => {
    const seen: Array<Record<string, unknown>> = []
    const host = hostWith({
      selection: { provider: 'local', model: 'reasoning-only' },
      resolveCallConfig: async () => {
        throw new Error('does not support reasoning effort "off"')
      },
      stream: options => {
        seen.push(options as Record<string, unknown>)
        return streamOf([textDelta('中文'), finish()])()
      }
    })
    // A rejected effort must still produce a working call, not a failure.
    await expect(createLlmTranslator(host).translate({ texts: ['t'], locale: 'zh', signal: new AbortController().signal })).resolves.toEqual(['中文'])
    expect(seen[0]?.reasoningEffort).toBeUndefined()
  })

  it('joins multiple text blocks and trims the result', async () => {
    const host = hostWith({
      selection: { provider: 'p', model: 'm' },
      stream: streamOf([textDelta(' 管理'), textDelta('套件来源 '), finish()])
    })
    const [text] = await createLlmTranslator(host).translate({ texts: ['t'], locale: 'zh', signal: new AbortController().signal })
    expect(text).toBe('管理套件来源')
  })

  it('rejects an empty answer so the caller keeps the original text', async () => {
    const host = hostWith({ selection: { provider: 'p', model: 'm' }, stream: streamOf([finish()]) })
    await expect(createLlmTranslator(host).translate({ texts: ['t'], locale: 'zh', signal: new AbortController().signal })).rejects.toThrow(/no text/)
  })

  it('rejects a terminal error finish reason', async () => {
    const failure = { code: 'LLM_HTTP_ERROR', message: 'provider exploded' } as unknown as FinishReason extends { kind: 'error'; failure: infer F } ? F : never
    const host = hostWith({ selection: { provider: 'p', model: 'm' }, stream: streamOf([{ type: 'finish', reason: { kind: 'error', failure } }]) })
    await expect(createLlmTranslator(host).translate({ texts: ['t'], locale: 'zh', signal: new AbortController().signal })).rejects.toThrow(/provider exploded/)
  })

  it('rejects an aborted finish reason', async () => {
    const failure = { code: 'ABORTED', message: 'cancelled upstream' } as unknown as FinishReason extends { kind: 'aborted'; failure: infer F } ? F : never
    const host = hostWith({ selection: { provider: 'p', model: 'm' }, stream: streamOf([{ type: 'finish', reason: { kind: 'aborted', failure } }]) })
    await expect(createLlmTranslator(host).translate({ texts: ['t'], locale: 'zh', signal: new AbortController().signal })).rejects.toThrow(/cancelled upstream/)
  })

  it('rejects when the model route disappears mid-flight', async () => {
    let live = true
    const host = {
      get(name: string) {
        if (name === 'agentDefaultModel') return live ? { currentSelection: () => ({ provider: 'p', model: 'm' }) } : undefined
        return { stream: streamOf([textDelta('x'), finish()]) }
      }
    }
    const translator = createLlmTranslator(host)
    live = false
    await expect(translator.translate({ texts: ['t'], locale: 'zh', signal: new AbortController().signal })).rejects.toThrow(/unavailable/)
  })

  it('translates a text past the old per-text ceiling instead of retiring the provider', async () => {
    // A model hop that behaves like the real one at its ceiling: it needs about
    // half the source length in output tokens, and reports the terminal reason
    // the route uses for a generation that was cut off. Under the old constant
    // (512 tokens for any single text) this call is cut off, which throws, which
    // trips the chain's breaker — and the provider then serves nothing for the
    // rest of the process.
    const host = hostWith({
      selection: { provider: 'local', model: 'm' },
      stream: options => {
        const request = options as { maxTokens?: number; messages?: Array<{ content?: Array<{ text?: string }> }> }
        const source = request.messages?.[0]?.content?.[0]?.text ?? ''
        const needed = Math.ceil(source.length * 0.5)
        return streamOf(needed > (request.maxTokens ?? 0) ? [{ type: 'finish', reason: { kind: 'max-tokens' } }] : [textDelta('译'.repeat(needed)), finish()])()
      }
    })
    const long = 'word '.repeat(240)
    // The premise, asserted rather than assumed: this text needs more than the
    // ceiling one text used to receive.
    expect(Math.ceil(long.length * 0.5)).toBeGreaterThan(512)
    const translator = createLlmTranslator(host)
    const result = await runChain([translator], [long], 'zh')
    expect(result.provider).toBe('llm')
    expect(isTripped('llm')).toBe(false)
    resetCircuitBreaker()
  })

  it('stops reading once the caller aborts', async () => {
    const controller = new AbortController()
    const host = hostWith({
      selection: { provider: 'p', model: 'm' },
      stream: () => ({
        async *[Symbol.asyncIterator]() {
          yield textDelta('first')
          controller.abort()
          yield textDelta('second')
          yield finish()
        }
      })
    })
    await expect(createLlmTranslator(host).translate({ texts: ['t'], locale: 'zh', signal: controller.signal })).rejects.toThrow()
  })
})
