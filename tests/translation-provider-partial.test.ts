/**
 * Batch isolation inside the masking hop.
 *
 * One slot the provider damaged must not decide the fate of its valid siblings:
 * the damaged slot stays empty (the localizer's own per-text retry policy owns
 * it) while every validated answer is delivered, and only a batch whose every
 * slot is invalid fails, which is what retires the provider for the process.
 * @module tests/translation-provider-partial
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createTranslationProviders } from '../packages/market-translation/src/runtime/host/translation-providers.js'
import { isTripped, resetCircuitBreaker, runChain, type TranslationProvider } from '../packages/market-translation/src/application/translation/chain.js'

/** The model hop, wrapped by the production masking hop. */
function modelHop(translate: TranslationProvider['translate']): TranslationProvider {
  return createTranslationProviders({ host: {}, llm: { id: 'llm', available: () => true, translate } }).at(-1)!
}

/** The masked text the endpoint actually received, per call. */
function answeredBy(answers: readonly string[], seen: string[][] = []): TranslationProvider['translate'] {
  return async ({ texts }) => {
    seen.push([...texts])
    return [...answers]
  }
}

afterEach(() => resetCircuitBreaker())

describe('one invalid answer keeps its valid siblings', () => {
  it('delivers the valid marker-free sibling and blanks only the damaged slot', async () => {
    const seen: string[][] = []
    const provider = modelHop(answeredBy(['有效描述', '链接被遗漏'], seen))
    const result = await provider.translate({
      texts: ['A normal description', 'Read https://example.test/guide'],
      locale: 'zh',
      signal: new AbortController().signal
    })
    // Fail-closed on the damaged slot, and the sibling is not discarded with it.
    expect(result).toEqual(['有效描述', ''])
    expect(seen).toEqual([['A normal description', 'Read ⟦U1⟧']])
    expect(isTripped('llm')).toBe(false)
  })

  it('keeps the valid sibling when the damaged slot comes first', async () => {
    const provider = modelHop(async ({ texts }) => texts.map((_text, index) => (index === 0 ? '链接被遗漏' : '有效描述')))
    const result = await provider.translate({
      texts: ['Read https://example.test/guide', 'A normal description'],
      locale: 'zh',
      signal: new AbortController().signal
    })
    expect(result).toEqual(['', '有效描述'])
  })

  it('keeps the valid sibling when a structural answer carries markers and no prose', async () => {
    const provider = modelHop(async ({ texts }) => texts.map((_text, index) => (index === 0 ? '好译文' : '⟦D1⟧⟦D2⟧')))
    const result = await provider.translate({
      texts: ['Good prose', 'Read ⟪d1⟫important⟪d2⟫ instructions.'],
      locale: 'zh',
      signal: new AbortController().signal
    })
    expect(result).toEqual(['好译文', ''])
  })
})

describe('an all-invalid batch still fails closed and retires the provider', () => {
  it('rejects when no slot carries a usable answer', async () => {
    const provider = modelHop(async () => ['链接被遗漏', '另一个遗漏'])
    await expect(provider.translate({ texts: ['Read https://a.test/guide', 'See https://b.test/guide'], locale: 'zh', signal: new AbortController().signal })).rejects.toThrow(
      /lost or duplicated a placeholder/
    )
  })

  it('is the chain that retires the provider, and it does so only then', async () => {
    const provider = modelHop(async () => ['链接被遗漏', '另一个遗漏'])
    await expect(runChain([provider], ['Read https://a.test/guide', 'See https://b.test/guide'], 'zh')).rejects.toThrow(/lost or duplicated a placeholder/)
    expect(isTripped('llm')).toBe(true)
  })
})

describe('a partially invalid batch leaves the hop healthy', () => {
  it('serves the next healthy batch through the same provider', async () => {
    let call = 0
    const provider = modelHop(async ({ texts }) => {
      call += 1
      return call === 1 ? texts.map((_text, index) => (index === 0 ? '有效' : '遗漏')) : texts.map(() => '健康翻译')
    })
    const first = await runChain([provider], ['A normal description', 'Read https://example.test/guide'], 'zh')
    expect(first.texts).toEqual(['有效', ''])
    expect(isTripped('llm')).toBe(false)
    const second = await runChain([provider], ['Another description'], 'zh')
    expect(second.texts).toEqual(['健康翻译'])
    expect(call).toBe(2)
  })
})
