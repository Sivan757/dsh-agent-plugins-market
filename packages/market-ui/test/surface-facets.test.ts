/**
 * The filters a surface offers: who provides the row, and the states worth separating.
 *
 * Every list used to cut on its own axis, so the same toolbar asked different questions
 * per tab. This test pins the shared table: the faces that can hold both providers declare
 * two cuts in one order, a face with a single provider declares no provider cut, and the
 * market declares the state cuts the owner asked for. Both surfaces read this one table,
 * so they cannot disagree about what a filter is.
 */
import { describe, expect, it } from 'vitest'

import type { LocaleKey } from '../src/locales.js'
import { SURFACE_PROVIDERS, surfaceCuts, surfaceProviderCuts, surfaceStateCuts } from '../src/ui/surface-facets.js'

const t = (name: LocaleKey): string => String(name)

const ALL_KEYS = ['market', 'skills', 'personas', 'commands', 'mcp', 'lsp', 'instructions', 'outputStyles', 'hooks'] as const

describe('shared surface facet', () => {
  it('declares two providers for every face that can hold both, in one order', () => {
    for (const key of ALL_KEYS) {
      const words = SURFACE_PROVIDERS[key]
      if (words === undefined) continue
      const cuts = surfaceProviderCuts(key, t, () => 'suite')
      expect(cuts.map(cut => cut.id)).toEqual(['suite', 'user'])
      expect(cuts.map(cut => cut.label)).toEqual([String(words.suite), String(words.user)])
    }
  })

  it('draws no provider facet for a face with a single provider', () => {
    // The market can only ever hold suite rows: a 套件 cut beside 全部 would be the same list
    // twice. The hook face is not in that group: a declaration can be a suite's or the
    // reader's own hoos.json entry, so it carries the same pair as every other list.
    expect(SURFACE_PROVIDERS.market).toBeUndefined()
    expect(SURFACE_PROVIDERS.hooks).toBeDefined()
    expect(surfaceProviderCuts('market', t, () => 'suite')).toEqual([])
    expect(surfaceProviderCuts('hooks', t, () => 'suite')).toHaveLength(2)
  })

  it('matches a row by the provider it reports', () => {
    const cuts = surfaceProviderCuts('skills', t, id => (id.startsWith('user:') ? 'user' : 'suite'))
    expect(cuts[0]!.match({ id: 'skills:src/a' })).toBe(true)
    expect(cuts[1]!.match({ id: 'user:mine' })).toBe(true)
    expect(cuts[1]!.match({ id: 'skills:src/a' })).toBe(false)
    // An unknown row belongs to neither half rather than to both.
    const empty = surfaceProviderCuts('skills', t, () => undefined)
    expect(empty[0]!.match({ id: 'x' })).toBe(false)
    expect(empty[1]!.match({ id: 'x' })).toBe(false)
  })
})

describe('the market state facet', () => {
  it('draws the enabled and the disabled cut, in one order, on the words the cards use', () => {
    const cuts = surfaceStateCuts('market', t)
    expect(cuts.map(cut => cut.id)).toEqual(['enabled', 'disabled'])
    expect(cuts.map(cut => cut.label)).toEqual(['enabledLabel', 'disabledLabel'])
  })

  it('matches a row by the state it reports', () => {
    const [enabled, disabled] = surfaceStateCuts('market', t)
    expect(enabled!.match({ id: 'market:src/a', state: 'active' })).toBe(true)
    expect(enabled!.match({ id: 'market:src/a', state: 'disabled' })).toBe(false)
    expect(disabled!.match({ id: 'market:src/a', state: 'disabled' })).toBe(true)
    expect(disabled!.match({ id: 'market:src/a', state: 'active' })).toBe(false)
    // A suite that is listed but not installed is neither on nor off: it belongs to
    // neither cut and stays visible under 全部.
    expect(enabled!.match({ id: 'market:src/a', state: 'absent' })).toBe(false)
    expect(disabled!.match({ id: 'market:src/a', state: 'absent' })).toBe(false)
  })

  it('agrees with the card on a row that carries no state of its own', () => {
    const [enabled, disabled] = surfaceStateCuts('market', t)
    expect(enabled!.match({ id: 'market:src/a' })).toBe(true)
    expect(disabled!.match({ id: 'market:src/a', disabled: true })).toBe(true)
    expect(disabled!.match({ id: 'market:src/a' })).toBe(false)
  })
})

describe('one table, two surfaces', () => {
  it('gives the market its state cuts and no provider cut', () => {
    const cuts = surfaceCuts('market', t, () => 'suite')
    expect(cuts.map(cut => cut.id)).toEqual(['enabled', 'disabled'])
  })

  it('leaves every other face on its provider cuts alone', () => {
    for (const key of ALL_KEYS) {
      if (key === 'market') continue
      const union = surfaceCuts(key, t, () => 'suite')
      const providers = surfaceProviderCuts(key, t, () => 'suite')
      expect(union.map(cut => cut.id)).toEqual(providers.map(cut => cut.id))
      expect(union.map(cut => cut.label)).toEqual(providers.map(cut => cut.label))
    }
  })
})
