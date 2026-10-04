import { describe, expect, it } from 'vitest'
import { collectUnits, dedupeUnits, type TranslationUnit } from '../src/application/translation/unit.js'

/** A unit with every identity part spelled out, so a case can vary one of them. */
function unit(overrides: Partial<TranslationUnit> = {}): TranslationUnit {
  return { surface: 'market', id: 'source/suite', role: 'name', text: 'Suite name', ...overrides }
}

describe('collectUnits', () => {
  it('collects the name before the description', () => {
    expect(collectUnits('market', 'source/suite', { name: 'Suite name', description: 'Suite description' })).toEqual([
      { surface: 'market', id: 'source/suite', role: 'name', text: 'Suite name' },
      { surface: 'market', id: 'source/suite', role: 'description', text: 'Suite description' }
    ])
  })

  it('skips missing, empty, and whitespace-only text', () => {
    expect(collectUnits('skills', 'review', {})).toEqual([])
    expect(collectUnits('skills', 'review', { name: '', description: '' })).toEqual([])
    expect(collectUnits('skills', 'review', { name: '   ', description: '\t\n' })).toEqual([])
  })

  it('collects only the field that carries text', () => {
    expect(collectUnits('commands', 'deploy', { description: 'Deploy the app' })).toEqual([{ surface: 'commands', id: 'deploy', role: 'description', text: 'Deploy the app' }])
  })

  it('keeps the upstream text verbatim, padding included', () => {
    // The emptiness check trims; the cached text must stay byte-identical to
    // what upstream authored, or the key would drift from the source.
    expect(collectUnits('mcp', 'server', { name: '  Padded name  ' })[0]?.text).toBe('  Padded name  ')
  })

  it('carries the surface and id through unchanged', () => {
    expect(collectUnits('lsp', 'typescript', { name: 'TypeScript' })).toEqual([{ surface: 'lsp', id: 'typescript', role: 'name', text: 'TypeScript' }])
  })
})

describe('dedupeUnits', () => {
  it('collapses a repeated identity onto its first occurrence', () => {
    const first = unit({ text: 'First text' })
    const second = unit({ text: 'Second text' })
    expect(dedupeUnits([first, second])).toEqual([first])
  })

  it('keeps units that differ in any identity part', () => {
    const base = unit()
    const units = [base, unit({ surface: 'skills' }), unit({ id: 'other/suite' }), unit({ role: 'description' }), unit({ text: 'Different text' })]
    // Same identity, different text: still one unit, because the text is what
    // upstream authored for that identity.
    expect(dedupeUnits(units)).toEqual([base, unit({ surface: 'skills' }), unit({ id: 'other/suite' }), unit({ role: 'description' })])
  })

  it('preserves first-seen order across the whole scan', () => {
    const a = unit({ id: 'a' })
    const b = unit({ id: 'b' })
    const c = unit({ surface: 'lsp', id: 'c' })
    expect(dedupeUnits([a, b, a, c, b]).map(entry => entry.id)).toEqual(['a', 'b', 'c'])
  })

  it('keeps identities that contain the join separator distinct', () => {
    const separated = unit({ id: 'a\u0000b' })
    const plain = unit({ id: 'a' })
    expect(dedupeUnits([separated, plain])).toHaveLength(2)
  })

  it('accepts a readonly input and returns an empty list for no units', () => {
    const units: readonly TranslationUnit[] = []
    expect(dedupeUnits(units)).toEqual([])
  })
})
