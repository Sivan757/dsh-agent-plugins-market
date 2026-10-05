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
import { describe, expect, it } from 'vitest'
import { MAX_DOCUMENT_CHUNK_CHARS, chunkDocument, type DocumentChunk } from '../src/application/translation/document.js'
import { MAX_OUTPUT_TOKENS_CAP, outputTokenBudget } from '../src/runtime/host/llm-translator.js'
import { MAX_BATCH_CHARS } from '../src/application/translation/localizer.js'

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

  it('keeps a short document as one chunk', () => {
    expect(prose('# Title\n\nOne paragraph.')).toEqual(['# Title\n\nOne paragraph.'])
  })

  it('reassembles its own chunks into the input, byte for byte', () => {
    const bodies = [
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
      ['1. Clone it:', '   ```bash', '   git clone x', '   ```', '2. Then build.'].join('\n')
    ]
    for (const body of bodies) {
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
