import { describe, expect, it } from 'vitest'
import type { FinishReason, StreamChunk } from '@deepseek-ai/dsh-llm'
import { createDescriptionTranslator } from '../src/runtime/host/description-translator.js'

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

describe('createDescriptionTranslator availability', () => {
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
    const translator = createDescriptionTranslator(host)
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
      expect(createDescriptionTranslator(hostWith({ selection, stream: streamOf([]) })).available()).toBe(false)
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
    expect(createDescriptionTranslator(host).available()).toBe(false)
  })
})

describe('createDescriptionTranslator translate', () => {
  it('sends the selected route, the locale instruction, and the description', async () => {
    const seen: Array<Record<string, unknown>> = []
    const host = hostWith({
      selection: { provider: 'local', model: 'deepseek-flash' },
      stream: options => {
        seen.push(options as Record<string, unknown>)
        return streamOf([textDelta('管理套件来源'), finish()])()
      }
    })
    const text = await createDescriptionTranslator(host).translate({ text: 'Manage suite sources', locale: 'zh', signal: new AbortController().signal })
    expect(text).toBe('管理套件来源')
    expect(seen[0]).toMatchObject({ provider: 'local', model: 'deepseek-flash', temperature: 0, maxTokens: 512 })
    // The published purpose field accepts only compaction and session-title,
    // neither of which describes a translation, so the call leaves it unset.
    expect(seen[0]?.purpose).toBeUndefined()
    expect(String(seen[0]?.system)).toContain('Simplified Chinese')
    expect(JSON.stringify(seen[0]?.messages)).toContain('Manage suite sources')
  })

  it('names the target language for a non-zh locale', async () => {
    const seen: Array<Record<string, unknown>> = []
    const host = hostWith({
      selection: { provider: 'local', model: 'm' },
      stream: options => {
        seen.push(options as Record<string, unknown>)
        return streamOf([textDelta('x'), finish()])()
      }
    })
    await createDescriptionTranslator(host).translate({ text: 't', locale: 'ja', signal: new AbortController().signal })
    expect(String(seen[0]?.system)).toContain('into ja')
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
    await createDescriptionTranslator(host).translate({ text: 't', locale: 'zh', signal: new AbortController().signal })
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
    await createDescriptionTranslator(host).translate({ text: 't', locale: 'zh', signal: new AbortController().signal })
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
    await expect(createDescriptionTranslator(host).translate({ text: 't', locale: 'zh', signal: new AbortController().signal })).resolves.toBe('中文')
    expect(seen[0]?.reasoningEffort).toBeUndefined()
  })

  it('joins multiple text blocks and trims the result', async () => {
    const host = hostWith({
      selection: { provider: 'p', model: 'm' },
      stream: streamOf([textDelta(' 管理'), textDelta('套件来源 '), finish()])
    })
    const text = await createDescriptionTranslator(host).translate({ text: 't', locale: 'zh', signal: new AbortController().signal })
    expect(text).toBe('管理套件来源')
  })

  it('rejects an empty answer so the caller keeps the original text', async () => {
    const host = hostWith({ selection: { provider: 'p', model: 'm' }, stream: streamOf([finish()]) })
    await expect(createDescriptionTranslator(host).translate({ text: 't', locale: 'zh', signal: new AbortController().signal })).rejects.toThrow(/no text/)
  })

  it('rejects a terminal error finish reason', async () => {
    const failure = { code: 'LLM_HTTP_ERROR', message: 'provider exploded' } as unknown as FinishReason extends { kind: 'error'; failure: infer F } ? F : never
    const host = hostWith({ selection: { provider: 'p', model: 'm' }, stream: streamOf([{ type: 'finish', reason: { kind: 'error', failure } }]) })
    await expect(createDescriptionTranslator(host).translate({ text: 't', locale: 'zh', signal: new AbortController().signal })).rejects.toThrow(/provider exploded/)
  })

  it('rejects an aborted finish reason', async () => {
    const failure = { code: 'ABORTED', message: 'cancelled upstream' } as unknown as FinishReason extends { kind: 'aborted'; failure: infer F } ? F : never
    const host = hostWith({ selection: { provider: 'p', model: 'm' }, stream: streamOf([{ type: 'finish', reason: { kind: 'aborted', failure } }]) })
    await expect(createDescriptionTranslator(host).translate({ text: 't', locale: 'zh', signal: new AbortController().signal })).rejects.toThrow(/cancelled upstream/)
  })

  it('rejects when the model route disappears mid-flight', async () => {
    let live = true
    const host = {
      get(name: string) {
        if (name === 'agentDefaultModel') return live ? { currentSelection: () => ({ provider: 'p', model: 'm' }) } : undefined
        return { stream: streamOf([textDelta('x'), finish()]) }
      }
    }
    const translator = createDescriptionTranslator(host)
    live = false
    await expect(translator.translate({ text: 't', locale: 'zh', signal: new AbortController().signal })).rejects.toThrow(/unavailable/)
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
    await expect(createDescriptionTranslator(host).translate({ text: 't', locale: 'zh', signal: controller.signal })).rejects.toThrow()
  })
})
