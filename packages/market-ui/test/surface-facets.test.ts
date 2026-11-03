/**
 * The one filter: who provides a row.
 *
 * Every list used to cut on its own axis, so the same toolbar asked different questions
 * per tab. This test pins the shared table: the faces that can hold both providers declare
 * two cuts in one order, and a face with a single provider declares none, so a reader never
 * meets two chips that lead to the same list.
 */
import { describe, expect, it } from 'vitest'

import type { LocaleKey } from '../src/locales.js'
import { SURFACE_PROVIDERS, surfaceProviderCuts } from '../src/ui/surface-facets.js'

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

  it('draws no facet for a face with a single provider', () => {
    // The market and the hook list can only ever hold suite rows: a 套件 cut beside 全部
    // would be the same list twice.
    expect(SURFACE_PROVIDERS.market).toBeUndefined()
    expect(SURFACE_PROVIDERS.hooks).toBeUndefined()
    expect(surfaceProviderCuts('market', t, () => 'suite')).toEqual([])
    expect(surfaceProviderCuts('hooks', t, () => 'suite')).toEqual([])
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
