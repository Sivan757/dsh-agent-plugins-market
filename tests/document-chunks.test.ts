/**
 * The document chunker: the unit a translated document travels in.
 *
 * Three properties decide whether the rest of the feature is sound — a prose
 * chunk never exceeds what one provider call may carry, fenced code never
 * reaches a provider at all, and the chunks plus their separators reproduce the
 * authored body byte for byte — so all three are pinned here. The round trip is
 * the one that used to be false in a way no reader could see: a chunk boundary
 * that synthesized its own separator inserted a blank line the author never
 * wrote, which made a list item loose and moved its code block out of the
 * <li>.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { maskText, unmaskText } from '../packages/market-translation/src/runtime/host/text-masking.js'
import { createTranslationProviders } from '../packages/market-translation/src/runtime/host/translation-providers.js'
import {
  MAX_DOCUMENT_CHUNK_CHARS,
  MAX_PARAGRAPH_REQUEST_CHARS,
  paragraphParts,
  chunkDocument,
  translateMarkdownDocument,
  type DocumentChunk
} from '../packages/market-translation/src/application/translation/document.js'
import { MAX_OUTPUT_TOKENS_CAP, outputTokenBudget } from '../packages/market-translation/src/runtime/host/llm-translator.js'
import { MAX_BATCH_CHARS } from '../packages/market-translation/src/application/translation/localizer.js'

/** The text of every chunk a provider would be asked to translate, in order. */
function prose(text: string): string[] {
  return chunkDocument(text)
    .filter(chunk => chunk.translatable)
    .map(chunk => chunk.text)
}

/** The text of every chunk kept verbatim, in order. */
function verbatim(text: string): string[] {
  return chunkDocument(text)
    .filter(chunk => !chunk.translatable)
    .map(chunk => chunk.text)
}

/**
 * The body a chunk list reassembles into.
 *
 * This is the contract the reader depends on: taking each chunk's text and the
 * authored text that followed it, in order, is the input exactly.
 */
function reassemble(chunks: readonly DocumentChunk[]): string {
  return chunks.map(chunk => chunk.text + chunk.separator).join('')
}

/** A paragraph of roughly the given length, with no blank line inside it. */
function paragraph(chars: number): string {
  return 'word '
    .repeat(Math.ceil(chars / 5))
    .slice(0, chars)
    .trim()
}

/**
 * Authored bodies the round trip is pinned against, beyond the documents this
 * repository happens to ship.
 *
 * The repository's own Markdown covers the shapes its authors wrote; these add
 * the shapes an upstream catalog authors that this tree does not. The first
 * entry is the one that used to lose its leading newline: whitespace before a
 * first paragraph that alone overruns {@link MAX_DOCUMENT_CHUNK_CHARS}, so the
 * paragraph is re-cut by line and the accumulated whitespace had nowhere to go.
 */
const AUTHORED_SHAPES: readonly string[] = [
  '# Title\n\nOne paragraph.',
  '# Title\n\nOne paragraph.\n',
  '\n\nLed with a blank line.\n',
  'A\n\n\n\nThree blank lines between two paragraphs.\n',
  'No trailing newline.',
  'Two  \ntrailing spaces\n',
  'CRLF line\r\nand another\r\n',
  'Intro\n' + '```bash\nnpm run build\n```\nClosing words.\n',
  ['Before.', '', '```', 'code', '```', '', 'After.'].join('\n'),
  ['Text.', '', '```js', 'const a = 1'].join('\n'),
  ['1. Clone it:', '   ```bash', '   git clone x', '   ```', '2. Then build.'].join('\n'),
  // The regression shape: one leading newline, a first paragraph longer than a
  // whole chunk, then a second paragraph. Every source catalog can author it
  // (that is how the review found five upstream files losing the newline).
  '\n' + 'x'.repeat(900) + '\n\nsecond paragraph\n',
  // The same bug with two leading blank lines, with spaces rather than a bare
  // newline, and with CRLF endings, so the fix is pinned on more than one input.
  '\n\n' + 'x'.repeat(900) + '\n\ntail\n',
  '   \n' + 'y'.repeat(850) + '\nz\n',
  '\r\n' + 'q'.repeat(900) + '\r\n\r\ntail\r\n'
]

/** Every Markdown document this repository ships, as the panels would read them. */
async function repositoryDocuments(): Promise<string[]> {
  const files: string[] = []
  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.name.endsWith('.md')) files.push(path)
    }
  }
  for (const root of ['docs', '.agents/notes']) await walk(root)
  files.push('README.md', 'README.zh.md', 'AGENTS.md', 'CONTRIBUTING.md')
  return files
}

describe('bounded structural repair', () => {
  const source = 'Open ⟪d1⟫important⟪d2⟫ linked ⟪d3⟫text now.'
  it('retries a damaged D3 with the complete paragraph and retains the good batch slot', async () => {
    const signal = new AbortController().signal
    const calls: { texts: readonly string[]; signal: AbortSignal }[] = []
    const base: import('../packages/market-translation/src/application/translation/chain.js').TranslationProvider = {
      id: 'llm',
      available: () => true,
      translate: async request => {
        calls.push(request)
        return calls.length === 1 ? ['已完成', '打开 ⟦D1⟧重要⟦D2⟧ 链接 D3⟧正文。'] : ['打开⟦D1⟧重要⟦D2⟧链接⟦D3⟧正文。']
      }
    }
    const provider = createTranslationProviders({ host: {}, llm: base }).at(-1)!
    const result = await provider.translate({ texts: ['Already fine.', source], locale: 'zh', signal })
    expect(result).toEqual(['已完成', '打开⟪d1⟫重要⟪d2⟫链接⟪d3⟫正文。'])
    expect(calls).toHaveLength(2)
    expect(calls[1]!.texts).toEqual(['Open ⟦D1⟧important⟦D2⟧ linked ⟦D3⟧text now.'])
    expect(calls.every(call => call.signal === signal)).toBe(true)
  })
  it('keeps a valid slot when the single repair fails and never recursively repairs', async () => {
    let calls = 0
    const provider = createTranslationProviders({
      host: {},
      llm: {
        id: 'llm',
        available: () => true,
        translate: async () => {
          calls++
          if (calls > 1) throw new Error('repair failed')
          return ['好译文', 'D1⟧damaged prose']
        }
      }
    }).at(-1)!
    await expect(provider.translate({ texts: ['Good prose', source], locale: 'zh', signal: new AbortController().signal })).resolves.toEqual(['好译文', ''])
    expect(calls).toBe(2)
  })
  it('uses one complete-input retry regardless of formatting leaf count', async () => {
    const sizes: number[] = []
    const provider = createTranslationProviders({
      host: {},
      llm: {
        id: 'llm',
        available: () => true,
        translate: async ({ texts }) => {
          sizes.push(texts.length)
          return sizes.length === 1 ? texts.map((_text, i) => (i === 0 ? '保留' : 'D1⟧损坏正文')) : texts.map(text => '译' + text)
        }
      }
    }).at(-1)!
    const sixty = Array.from({ length: 60 }, (_, index) => (index ? '⟪d' + index + '⟫' : '') + 'word' + index).join('')
    const result = await provider.translate({ texts: ['Good', sixty, source], locale: 'zh', signal: new AbortController().signal })
    expect(sizes).toEqual([3, 2])
    expect(result[0]).toBe('保留')
    expect(result[1]).toBe('译' + sixty)
    expect(result[2]).toBe('译' + source)
  })
  it('stops before another repair request when cancelled', async () => {
    const controller = new AbortController()
    let calls = 0
    const provider = createTranslationProviders({
      host: {},
      llm: {
        id: 'llm',
        available: () => true,
        translate: async ({ texts }) => {
          calls++
          if (calls === 1) return ['D1⟧damaged prose']
          controller.abort()
          return texts.map(text => '译' + text)
        }
      }
    }).at(-1)!
    const long = Array.from({ length: 40 }, (_, index) => (index ? '⟪d' + index + '⟫' : '') + 'word').join('')
    await expect(provider.translate({ texts: [long], locale: 'zh', signal: controller.signal })).rejects.toThrow()
    expect(calls).toBe(2)
  })
  it('does not repair marker-only answers or unstructured descriptions', async () => {
    for (const [input, answer] of [
      [source, '⟦D1⟧⟦D2⟧⟦D3⟧'],
      [source, '   '],
      ['Read API docs', 'missing protected word']
    ]) {
      const translate = vi.fn(async () => [answer!])
      const provider = createTranslationProviders({ host: {}, llm: { id: 'llm', available: () => true, translate } }).at(-1)!
      await expect(provider.translate({ texts: [input!], locale: 'zh', signal: new AbortController().signal })).rejects.toThrow()
      expect(translate).toHaveBeenCalledTimes(1)
    }
  })
})

describe('AST document translation', () => {
  it('accepts a naturally omitted article while preserving strong formatting and all boundaries', async () => {
    const source = 'A **flow** is a path through the skill.'
    const payload = 'A ⟪d1⟫flow⟪d2⟫ is a path through the skill.'
    const returned = '⟪d1⟫flow⟪d2⟫是技能的路径。'
    const provider = createTranslationProviders({ host: {}, llm: { id: 'llm', available: () => true, translate: async () => ['⟦D1⟧flow⟦D2⟧是技能的路径。'] } }).at(-1)!
    await expect(provider.translate({ texts: [payload], locale: 'zh', signal: new AbortController().signal })).resolves.toEqual([returned])
    const translated = translateMarkdownDocument(source, () => ({ text: returned, pending: false }))
    expect(translated.text).toBe('**flow**是技能的路径。')
    expect(translated.bilingualText).toContain(source)
    expect(translated.bilingualText).toContain('**flow**是技能的路径。')
  })

  it('removes empty inline formatting when the translated paragraph still has prose', () => {
    const result = translateMarkdownDocument('Read **the** instructions.', () => ({ text: '读取⟪d1⟫⟪d2⟫说明。', pending: false }))
    expect(result.text).toBe('读取说明。')
    expect(result.bilingualText).toContain('Read **the** instructions.')
    expect(result.bilingualText).not.toContain('****')
  })

  it('round-trips adjacent URLs and paragraph markers through the production mask', () => {
    const input = 'Open ⟪d1⟫https://example.test⟪d2⟫ now < 3 & done > 1'
    const masked = maskText(input)
    expect(unmaskText(masked.text, masked.placeholders)).toBe(input)
  })
  it('rejects marker-only or reordered provider output before it can be cached', async () => {
    for (const output of ['⟦D1⟧⟦D2⟧', 'Read ⟦D2⟧important⟦D1⟧ instructions.']) {
      const provider = createTranslationProviders({ host: {}, llm: { id: 'llm', available: () => true, translate: async () => [output] } }).at(-1)!
      await expect(provider.translate({ texts: ['Read ⟪d1⟫important⟪d2⟫ instructions.'], locale: 'zh', signal: new AbortController().signal })).rejects.toThrow()
    }
    expect(translateMarkdownDocument('Read **important** instructions.', () => ({ text: '⟪d1⟫⟪d2⟫', pending: false })).text).toBe('Read **important** instructions.')
  })

  it('retains indented, quoted and inline code, links, math and HTML outside provider payloads', () => {
    const source = [
      'Read the following:',
      '',
      '    const PRIVATE_INDENT = 1',
      '',
      '> ~~~js',
      '> PRIVATE_QUOTED',
      '> ~~~',
      '',
      'Read ' + '\x60PRIVATE_INLINE\x60' + ' and [Read link](https://private.invalid/token).',
      '',
      '$PRIVATE_MATH$',
      '',
      '<private-html>'
    ].join('\n')
    const calls: string[] = []
    const result = translateMarkdownDocument(source, text => {
      calls.push(text)
      return { text: text.replaceAll('Read', '读取'), pending: false }
    })
    expect(calls.join('')).not.toMatch(/PRIVATE_|https:/)
    expect(result.text).toContain('PRIVATE_INDENT')
    expect(result.text).toContain('PRIVATE_QUOTED')
    expect(result.text).toContain('PRIVATE_INLINE')
    expect(result.text).toContain('https://private.invalid/token')
    expect(result.text).toContain('PRIVATE_MATH')
    expect(result.text).toContain('<private-html>')
  })
  it('submits an entire natural paragraph instead of splitting its words at 800 characters', () => {
    const source = 'A sentence with context. '.repeat(50).trimEnd()
    const calls: string[] = []
    translateMarkdownDocument(source, text => {
      calls.push(text)
      return { text, pending: false }
    })
    expect(calls).toEqual([source])
  })

  it('reports literal structure markers as a failed paragraph without sending or changing the source', () => {
    const source = 'Read the literal ⟪d1⟫ marker.'
    const localize = vi.fn((text: string) => ({ text, pending: false }))
    expect(translateMarkdownDocument(source, localize)).toEqual({ text: source, bilingualText: source, pending: 0, failed: 1 })
    expect(localize).not.toHaveBeenCalled()
  })

  it('keeps the whole paragraph original until all of its translation work finishes', () => {
    const source = 'First sentence. Second sentence.'
    const result = translateMarkdownDocument(source, () => ({ text: '已翻译一半。 Second sentence.', pending: true }))
    expect(result.text).toBe(source)
    expect(result.bilingualText).toBe(source)
    expect(result.pending).toBe(1)
  })

  it('keeps strong and link text in one ordered paragraph request', () => {
    const calls: string[] = []
    const result = translateMarkdownDocument('Read **important** and [linked](https://example.test) text.', text => {
      calls.push(text)
      return { text: text.replace('Read', '读取').replace('important', '重要').replace('linked', '链接'), pending: false }
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('Read')
    expect(calls[0]).toContain('important')
    expect(calls[0]).toContain('linked')
    expect(calls[0]).not.toContain('https://')
    expect(result.text).toContain('**重要**')
    expect(result.text).toContain('[链接](https://example.test)')
    expect(result.bilingualText).toContain('**important**')
    expect(result.bilingualText).toContain('**重要**')
  })
  it('rejects missing, duplicated and reordered inline boundaries without altering the paragraph', () => {
    const source = 'Read **important** and [linked](https://example.test) text.'
    for (const alter of [(text: string) => text.replace('⟪d1⟫', ''), (text: string) => text.replace('⟪d1⟫', '⟪d1⟫⟪d1⟫'), (text: string) => text.replace('⟪d1⟫', '⟪d9⟫')]) {
      expect(translateMarkdownDocument(source, text => ({ text: alter(text), pending: false })).text).toBe(source)
    }
  })
  it('retains references, footnotes and nested list/quote context in the complete output', () => {
    const source = ['1. Read [guide][ref].', '   - Read nested[^note].', '', '> Read quote.', '', '[ref]: https://example.test/docs', '', '[^note]: Read footnote.'].join('\n')
    const result = translateMarkdownDocument(source, text => ({ text: text.replaceAll('Read', '读取'), pending: false }))
    expect(result.text).toContain('[guide][ref]')
    expect(result.text).toContain('[ref]: https://example.test/docs')
    expect(result.text).toContain('[^note]: 读取 footnote.')
    expect(result.bilingualText).toContain('Read nested')
    expect(result.bilingualText).toContain('读取 nested')
    expect(result.bilingualText).toContain('> Read quote.')
    expect(result.bilingualText).toContain('> 读取 quote.')
  })
  it('round-trips echo output byte for byte and advances over malformed marker-like input', () => {
    for (const source of ['    code();\n', '> ~~~\n> code\n> ~~~', '⟪' + 'x'.repeat(1600) + '⟫', '⟪' + 'x'.repeat(1600), 'a'.repeat(797) + '\x60SECRET\x60 tail']) {
      const calls: string[] = []
      const result = translateMarkdownDocument(source, text => {
        calls.push(text)
        return { text, pending: false }
      })
      expect(result.text).toBe(source)
      expect(calls.every(text => text.length > 0)).toBe(true)
      expect(calls.join('')).not.toContain('SECRET')
    }
  })
  it('pairs tables as whole tables without changing cell structure', () => {
    const source = '| Read header | Value |\n| --- | --- |\n| Read cell | 1 |'
    const result = translateMarkdownDocument(source, text => ({ text: text.replace('Read', '读取'), pending: false }))
    expect(result.bilingualText).toContain('Read header')
    expect(result.bilingualText).toContain('读取 header')
    expect(result.text).not.toContain('Read cell')
  })
})

describe('chunkDocument', () => {
  it('sizes a chunk so the call budget covers the worst measured expansion', () => {
    // The derivation, not a change detector. 0.617 output characters per source
    // character is the worst of the 90 English/Chinese pairs this repository
    // ships (median 0.461); ~0.7 tokens per Chinese character is an estimate,
    // because nothing in this tree tokenizes, so the worst case is ~0.43 tokens
    // per source character.
    const WORST_MEASURED_OUTPUT_RATIO = 0.617
    const ESTIMATED_TOKENS_PER_OUTPUT_CHAR = 0.7
    const worstCase = (sourceChars: number): number => sourceChars * WORST_MEASURED_OUTPUT_RATIO * ESTIMATED_TOKENS_PER_OUTPUT_CHAR
    // One chunk's share, and — the assertion that actually pins the constant —
    // a whole call's, because the floor of 512 tokens would cover a single chunk
    // whatever the multiplier said.
    expect(outputTokenBudget(MAX_DOCUMENT_CHUNK_CHARS)).toBeGreaterThan(worstCase(MAX_DOCUMENT_CHUNK_CHARS))
    expect(outputTokenBudget(MAX_BATCH_CHARS)).toBeGreaterThan(worstCase(MAX_BATCH_CHARS))
    // A whole call's worth of source still fits the call's own ceiling: the two
    // budgets are two views of one number.
    expect(outputTokenBudget(MAX_BATCH_CHARS)).toBeLessThanOrEqual(MAX_OUTPUT_TOKENS_CAP)
    expect(MAX_DOCUMENT_CHUNK_CHARS).toBeLessThan(MAX_BATCH_CHARS)
  })

  it('returns nothing for a document with no text', () => {
    expect(chunkDocument('')).toEqual([])
    expect(chunkDocument('\n\n')).toEqual([])
  })

  it('keeps a short legacy description as one chunk', () => {
    expect(prose('# Title\n\nOne paragraph.')).toEqual(['# Title\n\nOne paragraph.'])
  })

  it('reassembles its own chunks into the input, byte for byte', () => {
    for (const body of AUTHORED_SHAPES) {
      expect(reassemble(chunkDocument(body))).toBe(body)
    }
  })

  it('reassembles every document this repository ships, byte for byte', async () => {
    const files = await repositoryDocuments()
    // A corpus test that quietly checked four files would prove nothing, so the
    // size is pinned: these are the real documents the panels translate.
    expect(files.length).toBeGreaterThan(100)
    for (const file of files) {
      const raw = await readFile(file, 'utf8')
      expect(reassemble(chunkDocument(raw)), file).toBe(raw)
    }
    // The repository's own documents do not author every shape a source catalog
    // can: none of them leads with whitespace before a first paragraph longer
    // than a whole chunk, which is the shape that used to lose that whitespace.
    // The authored shapes close that gap, so this corpus can catch the defect.
    for (const [index, body] of AUTHORED_SHAPES.entries()) {
      expect(reassemble(chunkDocument(body)), `authored shape ${String(index)}`).toBe(body)
    }
  })

  it('reassembles a body led by whitespace before a paragraph longer than the budget', () => {
    // The defect this pins: the leading newline is folded into the first piece's
    // text, the piece is re-cut by line because that first paragraph overruns the
    // budget, and the accumulated whitespace was dropped on the floor — so the
    // authored 920 characters came back as 919. It is byte-exact now, and the
    // whitespace that cannot ride with the first slice still travels as its own.
    const body = '\n' + 'x'.repeat(900) + '\n\nsecond paragraph\n'
    expect(body).toHaveLength(920)
    const chunks = chunkDocument(body)
    expect(reassemble(chunks)).toBe(body)
    expect(chunks.map(chunk => chunk.text + chunk.separator).join('')).toHaveLength(920)
    for (const chunk of chunks) {
      if (chunk.translatable) expect(chunk.text.length).toBeLessThanOrEqual(MAX_DOCUMENT_CHUNK_CHARS)
    }
    // The newline is content, not a separator swallowed by the boundary: the
    // reader sees the same leading blank line the author wrote.
    expect(reassemble(chunks).startsWith('\n')).toBe(true)
  })

  it('keeps the authored single newline before a fence inside a list item', () => {
    // The shape that used to break: a fence indented inside a numbered list, so
    // the chunk boundary falls between the list text and the fence with one
    // authored newline between them. Rejoining with a blank line made the item
    // loose and moved the code out of the list.
    const body = ['1. Clone the repository:', '   ```bash', '   git clone x', '   ```'].join('\n')
    const chunks = chunkDocument(body)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.separator).toBe('\n')
    expect(reassemble(chunks)).toBe(body)
  })

  it('never lets a prose chunk exceed the budget', () => {
    const paragraphs = Array.from({ length: 20 }, () => paragraph(150))
    const chunks = prose(paragraphs.join('\n\n'))
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_DOCUMENT_CHUNK_CHARS)
  })

  it('keeps a paragraph that fits inside one chunk', () => {
    const paragraphs = Array.from({ length: 12 }, () => paragraph(200))
    const chunks = prose(paragraphs.join('\n\n'))
    // Packing must not cut through a paragraph: every authored paragraph is
    // whole inside some chunk, which is what the provider needs to see.
    for (const one of paragraphs) expect(chunks.some(chunk => chunk.includes(one))).toBe(true)
  })

  it('splits a paragraph longer than the budget, and loses nothing', () => {
    const long = Array.from({ length: 40 }, (_, index) => `line number ${String(index)} of one very long paragraph`).join('\n')
    expect(long.length).toBeGreaterThan(MAX_DOCUMENT_CHUNK_CHARS)
    const chunks = prose(long)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_DOCUMENT_CHUNK_CHARS)
    expect(reassemble(chunkDocument(long))).toBe(long)
  })

  it('splits a single line longer than the budget', () => {
    const long = paragraph(2_000)
    const chunks = prose(long)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MAX_DOCUMENT_CHUNK_CHARS)
    expect(reassemble(chunkDocument(long))).toBe(long)
  })

  it('never sends a fenced code block to a provider', () => {
    const body = ['Intro.', '', '```bash', 'npm run build -- --flag', '', 'echo done', '```', '', 'Closing words.'].join('\n')
    // The fence keeps its blank line: a code block is one unit however it is
    // written, and a split inside it would hand a provider half an example.
    expect(verbatim(body)).toEqual(['```bash\nnpm run build -- --flag\n\necho done\n```'])
    expect(prose(body)).toEqual(['Intro.', 'Closing words.'])
  })

  it('reads a tilde fence the same way, and only a fence of the same kind closes it', () => {
    const body = ['~~~md', '```', 'still code', '~~~'].join('\n')
    expect(verbatim(body)).toEqual(['~~~md\n```\nstill code\n~~~'])
    expect(prose(body)).toEqual([])
  })

  it('treats an unclosed fence as code to the end of the document', () => {
    const body = ['Text.', '', '```js', 'const a = 1'].join('\n')
    expect(prose(body)).toEqual(['Text.'])
    expect(verbatim(body)).toEqual(['```js\nconst a = 1'])
    expect(reassemble(chunkDocument(body))).toBe(body)
  })

  it('starts a new prose chunk after a fence, so nothing is reordered', () => {
    const body = ['Before.', '', '```', 'code', '```', '', 'After.'].join('\n')
    expect(chunkDocument(body).map(chunk => chunk.translatable)).toEqual([true, false, true])
  })
})

describe('paragraphParts', () => {
  it('keeps a paragraph that fits as one transport unit', () => {
    const source = 'A sentence. Another sentence. '.repeat(40)
    expect(paragraphParts(source)).toEqual([source])
  })

  it('groups complete sentences while preserving whitespace markers and emoji', () => {
    const sentence = 'Read ⟪d1⟫important⟪d2⟫ instructions with 👩🏽‍💻. '
    const source = sentence.repeat(80)
    const parts = paragraphParts(source)!
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.join('')).toBe(source)
    expect(parts.every(part => part.length <= MAX_PARAGRAPH_REQUEST_CHARS && part.endsWith('. '))).toBe(true)
    expect(parts.every(part => (part.match(/⟪d1⟫/g) ?? []).length === (part.match(/⟪d2⟫/g) ?? []).length)).toBe(true)
  })

  it('returns an explicit unsupported result for an oversized single sentence', () => {
    expect(paragraphParts('word '.repeat(400))).toBeUndefined()
  })
})
