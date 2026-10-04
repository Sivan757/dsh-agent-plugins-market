import { describe, expect, it } from 'vitest'
import { maskText, unmaskText } from '../src/runtime/host/text-masking.js'

/** Mask, then restore, asserting the restore succeeded. */
function roundTrip(input: string): string {
  const masked = maskText(input)
  const restored = unmaskText(masked.text, masked.placeholders)
  expect(restored).toBeDefined()
  return restored as string
}

describe('maskText', () => {
  it('round-trips a description that mixes every masked span', () => {
    const input = 'Run `dsh mcp list` to inspect the MCP servers, then read https://example.com/docs for the CLI flags and ${DSH_HOME}/skills.'
    expect(roundTrip(input)).toBe(input)
  })

  it('replaces each span with a bracketed placeholder and keeps the table', () => {
    const masked = maskText('Use the MCP server at https://example.com and `--flag`')
    expect(masked.text).toBe('Use the ⟦K1⟧ server at ⟦U1⟧ and ⟦C1⟧')
    expect([...masked.placeholders.entries()]).toEqual([
      ['⟦C1⟧', '`--flag`'],
      ['⟦U1⟧', 'https://example.com'],
      ['⟦K1⟧', 'MCP']
    ])
  })

  it('numbers each category independently', () => {
    const masked = maskText('MCP and LSP and `a` and `b`')
    expect(masked.text).toBe('⟦K1⟧ and ⟦K2⟧ and ⟦C1⟧ and ⟦C2⟧')
  })

  it('masks a URL before the terms inside it are touched', () => {
    // The URL pass runs before the glossary pass, so a path segment that
    // happens to spell a term must not be carved out of the URL.
    const masked = maskText('see https://example.com/API/docs')
    expect(masked.text).toBe('see ⟦U1⟧')
    expect(masked.placeholders.get('⟦U1⟧')).toBe('https://example.com/API/docs')
  })

  it('masks a whole angle-bracket fragment rather than the URL inside it', () => {
    // Masking the URL first would leave its bare `<` for Google's aligner to
    // escape; the fragment pass claims the whole span first.
    const masked = maskText('<https://example.com>')
    expect(masked.text).toBe('⟦T1⟧')
    expect(masked.placeholders.get('⟦T1⟧')).toBe('<https://example.com>')
  })

  it('takes inline code whole, including spans that would otherwise match', () => {
    const masked = maskText('`run MCP now`')
    expect(masked.text).toBe('⟦C1⟧')
    expect(masked.placeholders.get('⟦C1⟧')).toBe('`run MCP now`')
  })

  it('masks a path variable and leaves the lowercase form alone', () => {
    const masked = maskText('${DSH_HOME}/skills and ${lower} stay')
    expect(masked.text).toBe('⟦V1⟧/skills and ${lower} stay')
    expect(masked.placeholders.get('⟦V1⟧')).toBe('${DSH_HOME}')
  })

  it('leaves a term inside a longer word alone', () => {
    // Whole-word matching: `JSONs` is prose, not the acronym.
    expect(maskText('JSONs and API').text).toBe('JSONs and ⟦K1⟧')
  })

  it('is case-sensitive for glossary terms', () => {
    expect(maskText('mcp and Mcp and MCP').text).toBe('mcp and Mcp and ⟦K1⟧')
  })

  it('returns the input unchanged when nothing is masked', () => {
    const masked = maskText('A plain sentence with nothing technical in it.')
    expect(masked.text).toBe('A plain sentence with nothing technical in it.')
    expect(masked.placeholders.size).toBe(0)
  })

  it('handles the empty string', () => {
    const masked = maskText('')
    expect(masked.text).toBe('')
    expect(unmaskText('', masked.placeholders)).toBe('')
  })
})

describe('unmaskText', () => {
  it('restores every placeholder in one pass', () => {
    const masked = maskText('MCP and `x`')
    expect(unmaskText(masked.text, masked.placeholders)).toBe('MCP and `x`')
  })

  it('returns undefined when a placeholder went missing', () => {
    const masked = maskText('Use MCP and `x`')
    const dropped = masked.text.replace('⟦C1⟧', '')
    expect(unmaskText(dropped, masked.placeholders)).toBeUndefined()
  })

  it('returns undefined when a placeholder was duplicated', () => {
    const masked = maskText('Use MCP and `x`')
    const doubled = masked.text.replace('⟦C1⟧', '⟦C1⟧⟦C1⟧')
    expect(unmaskText(doubled, masked.placeholders)).toBeUndefined()
  })

  it('returns undefined when the engine invented a placeholder', () => {
    const masked = maskText('Use MCP')
    const invented = masked.text.replace('⟦K1⟧', '⟦K1⟧⟦K9⟧')
    expect(unmaskText(invented, masked.placeholders)).toBeUndefined()
  })

  it('returns undefined when the answer is empty but placeholders were sent', () => {
    const masked = maskText('Use MCP')
    expect(unmaskText('', masked.placeholders)).toBeUndefined()
  })

  it('restores a repeated original span through distinct placeholders', () => {
    const masked = maskText('MCP then MCP')
    expect(masked.text).toBe('⟦K1⟧ then ⟦K2⟧')
    expect(unmaskText(masked.text, masked.placeholders)).toBe('MCP then MCP')
  })

  it('accepts an empty table for text with nothing masked', () => {
    const masked = maskText('plain text')
    expect(unmaskText(masked.text, masked.placeholders)).toBe('plain text')
  })
})
