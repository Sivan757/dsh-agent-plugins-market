import { describe, expect, it } from 'vitest'
import { collectUnits } from '../src/application/translation/unit.js'

describe('collectUnits', () => {
  it('collects the description and nothing else', () => {
    expect(collectUnits('market', 'source/suite', { name: 'Suite name', description: 'Suite description' })).toEqual([
      { surface: 'market', id: 'source/suite', text: 'Suite description' }
    ])
  })

  it('never collects a name, however much text it carries', () => {
    // A name is the identity the user types and matches against upstream
    // documentation; translating one made it harder to recognize.
    expect(collectUnits('lsp', 'typescript', { name: 'TypeScript' })).toEqual([])
    expect(collectUnits('skills', 'review', { name: 'Review implementation' })).toEqual([])
  })

  it('skips missing, empty, and whitespace-only text', () => {
    expect(collectUnits('skills', 'review', {})).toEqual([])
    expect(collectUnits('skills', 'review', { name: '', description: '' })).toEqual([])
    expect(collectUnits('skills', 'review', { name: '   ', description: '\t\n' })).toEqual([])
  })

  it('collects only the field that carries text', () => {
    expect(collectUnits('commands', 'deploy', { description: 'Deploy the app' })).toEqual([{ surface: 'commands', id: 'deploy', text: 'Deploy the app' }])
  })

  it('keeps the upstream text verbatim, padding included', () => {
    // The emptiness check trims; the cached text must stay byte-identical to
    // what upstream authored, or the key would drift from the source.
    expect(collectUnits('mcp', 'server', { description: '  Padded description  ' })[0]?.text).toBe('  Padded description  ')
  })

  it('carries the surface and id through unchanged', () => {
    expect(collectUnits('lsp', 'typescript', { description: 'Language server' })).toEqual([{ surface: 'lsp', id: 'typescript', text: 'Language server' }])
  })
})
