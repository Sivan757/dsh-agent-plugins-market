/**
 * Cut a document body into the pieces one translation request can carry.
 *
 * A skill or command document is a whole file, and the provider chain cannot
 * take one in a single call: the model hop caps a call's output, and both public
 * endpoints cap how much text one request may hold. So the body is split at
 * blank lines and each piece travels as its own translation unit, which also
 * makes the work resumable — a chunk already in the cache is never paid for
 * again, and a document whose translation is interrupted keeps every chunk that
 * landed.
 *
 * Two rules shape the split beyond the size budget:
 *
 * - **Fenced code is never translated.** A provider asked to translate a code
 *   fence translates the code, and a translated `SKILL.md` whose examples no
 *   longer run is worse than an untranslated one. Fences pass through verbatim
 *   and cost nothing.
 * - **Chunks break at blank lines, so paragraphs stay whole.** Translation
 *   quality depends on seeing a sentence in its context, and a chunk boundary
 *   in the middle of a paragraph buys nothing: the budget below is far larger
 *   than a paragraph, so a full one fits.
 *
 * The split is lossless. Every chunk carries the authored text that follows it
 * ({@link DocumentChunk.separator}), so concatenating each chunk's text with its
 * own separator reproduces the body byte for byte. A body nothing was translated
 * for therefore reassembles exactly as authored — blank lines, indentation and
 * line endings included — which also means a chunk boundary can never introduce
 * or remove structure the author did not write.
 * @module application/translation/document
 */

/**
 * Characters one chunk may carry.
 *
 * Derived from the tightest hop in the chain rather than guessed. The model hop
 * sizes one call's output from the source it carries (see
 * `runtime/host/llm-translator.ts`), and a batch is bounded by
 * {@link MAX_BATCH_CHARS} on the way in, so the two budgets are two views of one
 * number: 6,400 source characters is what one call may carry, and this is the
 * slice of it one text may be.
 *
 * The expansion this covers is measured over this repository's own bilingual
 * documents: across the 90 English/Chinese pairs it ships, the Chinese side runs
 * at 0.461 of the English character count at the median and 0.617 in the worst
 * case. What that costs in *tokens* is an estimate rather than a measurement —
 * nothing in this tree tokenizes — and the estimate (roughly 0.7 tokens per
 * Chinese character) puts the worst case near 0.43 tokens per source character,
 * which is the headroom the translator's own budget constant is chosen for.
 */
export const MAX_DOCUMENT_CHUNK_CHARS = 800

/** One piece of a document: the text to send, and whether it is worth sending at all. */
export interface DocumentChunk {
  /** The slice exactly as authored, so a body nothing was translated for reassembles unchanged. */
  text: string
  /** False for verbatim regions — fenced code — which no provider should ever see. */
  translatable: boolean
  /**
   * The authored text between this chunk and the next, byte for byte: the line
   * ending that closed it, the blank lines that followed, and — on the last
   * chunk — whatever trails the body.
   *
   * It is never sent to a provider, which is what keeps a model from eating the
   * blank line between two blocks. Reassembly is
   * `chunks.map(chunk => chunk.text + chunk.separator).join('')`.
   */
  separator: string
}

/** One authored run of text — a paragraph or a fence — with the text that follows it. */
interface AuthoredPiece {
  text: string
  /** The line ending that closed the piece plus every blank line after it. */
  gap: string
  translatable: boolean
}

/** One chunk-sized slice of an authored piece, with the text that follows it. */
interface PiecePart {
  text: string
  gap: string
}

/** An opening fence: up to three leading spaces, then three or more backticks or tildes. */
const OPENING_FENCE = /^ {0,3}(`{3,}|~{3,})/

/** The marker an opening fence line carries, or undefined for ordinary prose. */
function openingFence(line: string): string | undefined {
  const match = OPENING_FENCE.exec(line)
  return match === null ? undefined : match[1]
}

/** Whether a line closes the fence it is read against: same character, no shorter, nothing else on it. */
function isClosingFence(line: string, fence: string): boolean {
  return new RegExp(`^ {0,3}${fence[0]}{${String(fence.length)},}[ \t]*$`).test(line)
}

/** One line's content, without its own line ending. */
function lineContent(line: string): string {
  return line.endsWith('\n') ? line.slice(0, -1).replace(/\r$/, '') : line
}

/** One line split into its content and its own line ending, exactly as authored. */
function cutTerminator(line: string): { body: string; terminator: string } {
  if (line.endsWith('\r\n')) return { body: line.slice(0, -2), terminator: '\r\n' }
  if (line.endsWith('\n')) return { body: line.slice(0, -1), terminator: '\n' }
  return { body: line, terminator: '' }
}

/** Every line with its own line ending still attached, so a join is the input. */
function linesOf(text: string): string[] {
  return text === '' ? [] : text.split(/(?<=\n)/)
}

/** Split one line that is longer than a whole chunk on its own. */
function splitLongLine(line: string): string[] {
  if (line.length <= MAX_DOCUMENT_CHUNK_CHARS) return [line]
  const parts: string[] = []
  for (let at = 0; at < line.length; at += MAX_DOCUMENT_CHUNK_CHARS) {
    parts.push(line.slice(at, at + MAX_DOCUMENT_CHUNK_CHARS))
  }
  return parts
}

/**
 * Split one authored piece so no part exceeds the chunk budget.
 *
 * A piece that already fits is returned untouched, which is the common case:
 * this only runs for a block the author wrote as one paragraph and made longer
 * than a whole chunk — a changelog entry, a long table. The cuts land on the
 * piece's own line breaks; a single line longer than the budget is cut on
 * character boundaries, the one place the split is not authored.
 * @param piece - the authored run to size.
 * @returns the parts, each with the exact text that separated it from the next.
 */
function splitPiece(piece: AuthoredPiece): PiecePart[] {
  if (piece.text.length <= MAX_DOCUMENT_CHUNK_CHARS) return [{ text: piece.text, gap: piece.gap }]
  const parts: PiecePart[] = []
  let text = ''
  let gap = ''
  for (const line of linesOf(piece.text)) {
    const { body, terminator } = cutTerminator(line)
    const slices = splitLongLine(body)
    slices.forEach((slice, index) => {
      const sliceGap = index === slices.length - 1 ? terminator : ''
      if (text === '') {
        text = slice
      } else if (text.length + gap.length + slice.length > MAX_DOCUMENT_CHUNK_CHARS) {
        parts.push({ text, gap })
        text = slice
      } else {
        text = text + gap + slice
      }
      gap = sliceGap
    })
  }
  if (text !== '') parts.push({ text, gap: gap + piece.gap })
  return parts
}

/**
 * Read the body as its authored pieces: paragraphs and fenced blocks, in order.
 *
 * A piece's own line ending moves into its gap, so a piece is content only and
 * the gap is exactly the text between it and the next piece. Whitespace before
 * the first piece opens that piece's text — it has nowhere else to live, and a
 * body that starts with a blank line still reassembles unchanged.
 * @param text - the document body.
 * @returns the pieces in document order, or none for a body with no text at all.
 */
function authoredPieces(text: string): AuthoredPiece[] {
  const pieces: AuthoredPiece[] = []
  let paragraph: string[] = []
  let fence: { marker: string; lines: string[] } | undefined
  /** Whitespace seen since the last content line, not yet attached to a piece. */
  let gap = ''
  /** Whitespace before the first piece. */
  let leading = ''

  const push = (raw: string, translatable: boolean): void => {
    const { body, terminator } = cutTerminator(raw)
    if (body === '') {
      gap += raw
      return
    }
    if (pieces.length === 0) leading += gap
    else pieces[pieces.length - 1]!.gap += gap
    gap = terminator
    pieces.push({ text: body, gap: '', translatable })
  }
  const closeParagraph = (): void => {
    if (paragraph.length === 0) return
    push(paragraph.join(''), true)
    paragraph = []
  }

  for (const line of linesOf(text)) {
    if (fence !== undefined) {
      fence.lines.push(line)
      if (isClosingFence(lineContent(line), fence.marker)) {
        push(fence.lines.join(''), false)
        fence = undefined
      }
      continue
    }
    const content = lineContent(line)
    if (content.trim() === '') {
      closeParagraph()
      gap += line
      continue
    }
    const marker = openingFence(content)
    if (marker !== undefined) {
      closeParagraph()
      fence = { marker, lines: [line] }
      continue
    }
    paragraph.push(line)
  }
  closeParagraph()
  // A fence the author never closed runs to the end of the document, exactly as
  // a Markdown reader treats it.
  if (fence !== undefined) push(fence.lines.join(''), false)
  if (pieces.length === 0) return []
  pieces[pieces.length - 1]!.gap += gap
  if (leading !== '') pieces[0]!.text = leading + pieces[0]!.text
  return pieces
}

/**
 * Pack authored pieces into chunks, in document order.
 *
 * Prose pieces share a chunk until the budget is reached, which keeps the number
 * of provider calls proportional to the document's length rather than to its
 * paragraph count. A fence always stands alone: it is never translated, so
 * packing it with prose would either send it anyway or strand its neighbours.
 * @param pieces - the authored pieces, in document order.
 * @returns the chunks, each carrying the authored text that follows it.
 */
function packPieces(pieces: readonly AuthoredPiece[]): DocumentChunk[] {
  const chunks: DocumentChunk[] = []
  let text = ''
  let chars = 0
  /** The text that follows the last part added to the open chunk. */
  let separator = ''
  const flush = (): void => {
    if (text === '') return
    chunks.push({ text, separator, translatable: true })
    text = ''
    chars = 0
    separator = ''
  }
  for (const piece of pieces) {
    if (!piece.translatable) {
      flush()
      chunks.push({ text: piece.text, separator: piece.gap, translatable: false })
      continue
    }
    for (const part of splitPiece(piece)) {
      if (text === '') {
        text = part.text
        chars = part.text.length
      } else if (chars + separator.length + part.text.length > MAX_DOCUMENT_CHUNK_CHARS) {
        flush()
        text = part.text
        chars = part.text.length
      } else {
        text += separator + part.text
        chars += separator.length + part.text.length
      }
      separator = part.gap
    }
  }
  flush()
  return chunks
}

/**
 * Split a document body into translation units, in document order.
 *
 * The returned chunks partition the body: each chunk's text followed by its own
 * {@link DocumentChunk.separator}, concatenated in order, is the input byte for
 * byte. Every prose chunk fits {@link MAX_DOCUMENT_CHUNK_CHARS}; code chunks are
 * as long as the fence they hold, however long that is, because they are never
 * sent anywhere.
 *
 * The fence rule reads a fence indented up to three spaces as a fence, which is
 * exactly a fence inside a list item, and passes it through verbatim like any
 * other. A four-space indented code block is read as prose — the Markdown rule
 * for it is contextual, and the indentation it shares with a list item's
 * continuation text made every non-contextual test for it wrong on real
 * documents — so its text does reach a provider.
 * @param text - the document body, frontmatter already removed by the caller.
 * @returns the chunks, in document order; none for a body with no text at all.
 */
export function chunkDocument(text: string): DocumentChunk[] {
  return packPieces(authoredPieces(text))
}
