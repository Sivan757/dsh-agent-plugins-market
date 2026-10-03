/**
 * The description translator must resolve its host services from a context that
 * can actually see them.
 *
 * This plugin's root context injects only `skills` and `commands`, and the
 * translator is built from it. Cordis resolves a service from the reading
 * fiber's ancestors, so the question this file answers is whether `get()`
 * reaches services this fiber never injected.
 *
 * It does: `ctx.get(name)` walks the ancestor store without an `inject`
 * requirement. The trap `tests/host-service-seam.test.ts` documents is the
 * *property* accessor (`ctx.llm`), which throws `cannot get property "<service>"
 * without inject`. That distinction is what makes the wiring safe, and it is
 * pinned here against a real Cordis tree rather than a hand-built stub --
 * `readModelCatalog` has relied on the same behavior since it shipped.
 */
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { createDescriptionTranslator } from '../src/runtime/host/description-translator.js'

/** A minimal stand-in for the host LLM service. */
class FakeLlm extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm')
  }

  stream() {
    return {
      async *[Symbol.asyncIterator]() {
        yield { type: 'text-delta', index: 0, text: '中文描述' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
  }
}

/** A minimal stand-in for the host default-model service. */
class FakeDefaultModel extends Service {
  constructor(ctx: Context) {
    super(ctx, 'agentDefaultModel')
  }

  currentSelection() {
    return { provider: 'local', model: 'deepseek-flash' }
  }
}

describe('description translator over a real Cordis tree', () => {
  it('resolves llm and agentDefaultModel from a sibling fiber when injected', async () => {
    const root = new Context()
    // The host provides these from sibling fibers, exactly as the profile does.
    new FakeLlm(root)
    new FakeDefaultModel(root)
    let injected: Context | undefined
    // The plugin entry's own context injects only skills and commands; the
    // translator is built from a child that additionally injects these two.
    const plugin = root.extend({})
    plugin.inject(['llm', 'agentDefaultModel'], child => {
      injected = child
    })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(injected).toBeDefined()

    const translator = createDescriptionTranslator(injected as Context)
    expect(translator.available()).toBe(true)
    await expect(translator.translate({ text: 'Manage suite sources', locale: 'zh', signal: new AbortController().signal })).resolves.toBe('中文描述')
  })

  it('reaches sibling services from a context that injected neither', async () => {
    const root = new Context()
    new FakeLlm(root)
    new FakeDefaultModel(root)
    // The plugin entry injects only skills and commands, yet the translator
    // built from that same context still resolves both services. get() walks
    // the ancestor store; only the property accessor demands inject.
    const entry = root.extend({})
    entry.inject(['skills'], () => {})
    await new Promise(resolve => setTimeout(resolve, 0))
    const translator = createDescriptionTranslator(entry)
    expect(translator.available()).toBe(true)
    await expect(translator.translate({ text: 't', locale: 'zh', signal: new AbortController().signal })).resolves.toBe('中文描述')
  })

  it('reports unavailable when the deployment mounts no LLM service', async () => {
    const root = new Context()
    // A default-model service with no LLM beside it: nothing to stream through.
    new FakeDefaultModel(root)
    const entry = root.extend({})
    entry.inject(['skills'], () => {})
    await new Promise(resolve => setTimeout(resolve, 0))
    const translator = createDescriptionTranslator(entry)
    expect(translator.available()).toBe(false)
  })
})
