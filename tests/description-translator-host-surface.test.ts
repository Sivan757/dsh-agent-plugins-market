/**
 * The translator reads two services structurally, so nothing in its own tests
 * would notice the host renaming or dropping a method. These cases check the
 * real @deepseek-ai/dsh-llm runtime for the exact surface it calls.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { createLlmTranslator } from '../packages/market-translation/src/runtime/host/llm-translator.js'

describe('the LLM surface the translator calls', () => {
  it('exists on the real runtime', () => {
    const llm = new LlmRuntime(new Context()) as unknown as Record<string, unknown>
    expect(typeof llm.resolveCallConfig).toBe('function')
    expect(typeof llm.stream).toBe('function')
  })

  it('makes resolveCallConfig reject rather than resolve an unusable route', async () => {
    const llm = new LlmRuntime(new Context())
    // chooseEffort treats a rejection as "this route will not take 'off'" and
    // falls back to the adapter default. That fallback is only safe while an
    // unusable route rejects here instead of resolving.
    await expect(llm.resolveCallConfig({ provider: 'nope', model: 'nope', reasoningEffort: ReasoningEffortId('off') })).rejects.toThrow()
  })

  it('reads the llm service through get() the way the translator does', async () => {
    const root = new Context()
    new LlmRuntime(root)
    // Cordis activates a service on a later tick, so the first read is undefined
    // and the translator must survive that rather than caching the answer.
    await new Promise(resolve => setTimeout(resolve, 0))
    const host = { get: (name: string) => (root as unknown as { get(n: string): unknown }).get(name) }
    expect(host.get('llm')).toBeDefined()
    // With an llm but no default model there is no route, so the translator
    // must report unavailable instead of attempting a call.
    expect(createLlmTranslator(host).available()).toBe(false)
  })
})
