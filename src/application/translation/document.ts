/** Server-only Markdown translation; descriptions retain their legacy byte-preserving splitter. */
import { fromMarkdown } from 'mdast-util-from-markdown'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfm } from 'micromark-extension-gfm'
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm'
import { math } from 'micromark-extension-math'
import { mathFromMarkdown, mathToMarkdown } from 'mdast-util-math'
import type { Nodes, Root, Text, PhrasingContent } from 'mdast'
import type { DocumentTranslation } from '../../contracts/translation.js'

/** Per-request source bound; transport batches may contain several stable units. */
export const MAX_DOCUMENT_CHUNK_CHARS = 800

const markdownOptions = { extensions: [gfmToMarkdown(), mathToMarkdown()], fences: true }
const MARKER = /⟪d\d+⟫/g

/** A paragraph is one cache identity; bounded pieces only split that paragraph. */
function boundedText(text: string): string[] {
  const parts: string[] = []
  let start = 0
  for (let end = Math.min(MAX_DOCUMENT_CHUNK_CHARS, text.length); start < text.length; end = Math.min(start + MAX_DOCUMENT_CHUNK_CHARS, text.length)) {
    if (end < text.length) {
      const opening = text.lastIndexOf('⟪', end - 1)
      const marker = /^⟪d\d+⟫/.exec(text.slice(opening))?.[0]
      if (opening > start && marker !== undefined && opening + marker.length > end) end = opening
      const code = text.charCodeAt(end - 1)
      if (code >= 0xd800 && code <= 0xdbff) end--
    }
    parts.push(text.slice(start, end))
    start = end
  }
  return parts
}

/**
 * Transform prose in a single GFM/math tree. All non-text inline nodes and block
 * structures stay local; providers see paragraph text with ordered boundaries.
 * A malformed boundary sequence leaves that paragraph authored, never rewrites
 * link destinations, code, or the surrounding list/reference structure.
 */
export function translateMarkdownDocument(source: string, localize: (text: string) => { text: string; pending: boolean }): DocumentTranslation {
  const root = fromMarkdown(source, { extensions: [gfm(), math()], mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()] })
  let pending = 0
  let changed = false
  const pairs = new Map<Nodes, Nodes>()
  const translateInline = (node: Nodes): void => {
    if (!('children' in node)) return
    const leaves: Text[] = []
    const collect = (child: Nodes): void => {
      if (child.type === 'text') leaves.push(child)
      else if (child.type === 'link' && child.children.length === 1 && child.children[0]?.type === 'text' && child.children[0].value === child.url) return
      else if ('children' in child) child.children.forEach(collect)
    }
    node.children.forEach(collect)
    if (leaves.length === 0) return
    // Literal marker text is not accepted as structure supplied by a provider.
    if (leaves.some(leaf => /⟪d\d+⟫/.test(leaf.value))) return
    const original = structuredClone(node)
    const payload = leaves.map((leaf, index) => (index === 0 ? '' : '⟪d' + index + '⟫') + leaf.value).join('')
    const values = boundedText(payload).map(part => {
      const value = localize(part)
      if (value.pending) pending++
      return value.text
    })
    const result = values.join('')
    if (result === payload) return
    const expected = payload.match(MARKER) ?? []
    const received = result.match(MARKER) ?? []
    if (expected.length !== received.length || expected.some((token, i) => token !== received[i])) return
    const translatedLeaves = result.split(MARKER)
    if (translatedLeaves.length !== leaves.length || translatedLeaves.join('').trim() === '') return
    leaves.forEach((leaf, i) => {
      leaf.value = translatedLeaves[i]!
    })
    // An omitted formatted fragment must not serialize into orphan delimiters.
    const prune = (entry: Nodes): boolean => {
      if (entry.type === 'text') return entry.value !== ''
      if ('children' in entry) entry.children = entry.children.filter(prune)
      return !(['strong', 'emphasis', 'delete', 'link', 'linkReference'].includes(entry.type) && 'children' in entry && entry.children.length === 0)
    }
    prune(node)
    pairs.set(node, original)
    changed = true
  }
  const visit = (node: Nodes): void => {
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell') {
      translateInline(node)
      return
    }
    if ('children' in node) node.children.forEach(visit)
  }
  visit(root)
  if (!changed) return { text: source, bilingualText: source, pending }
  const serialize = (tree: Root): string => {
    const rendered = toMarkdown(tree, markdownOptions)
    return source.endsWith('\n') ? rendered : rendered.replace(/\n$/, '')
  }
  const translated = serialize(root)
  const bilingual = (node: Nodes): Nodes => {
    const original = pairs.get(node)
    if (original?.type === 'paragraph' && node.type === 'paragraph') {
      return { ...node, children: [...original.children, { type: 'break' }, ...node.children] as PhrasingContent[] }
    }
    if ('children' in node) {
      const children: Nodes[] = []
      for (const child of node.children) {
        if (child.type === 'table') {
          const originalTable = structuredClone(child)
          const restore = (current: Nodes, old: Nodes): void => {
            const prior = pairs.get(current)
            if (prior && 'children' in old && 'children' in prior) old.children = structuredClone(prior.children)
            else if ('children' in current && 'children' in old) current.children.forEach((entry, i) => restore(entry, old.children[i]!))
          }
          restore(child, originalTable)
          children.push(originalTable, child)
        } else if (child.type === 'heading' && pairs.has(child)) {
          children.push(pairs.get(child)!, child)
        } else children.push(bilingual(child))
      }
      return { ...node, children } as Nodes
    }
    return node
  }
  return { text: translated, bilingualText: serialize(bilingual(root) as Root), pending }
}

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
        // The accumulated gap is the text between the previous slice and this
        // one — or, before the first slice, the whitespace the author led the
        // piece with, which {@link authoredPieces} folded into the piece's text
        // because it has nowhere else to live. Either way it travels with this
        // slice. When the two together would break the budget the whitespace
        // becomes a part of its own rather than being dropped, which is what
        // silently lost a document's leading newline.
        if (gap.length + slice.length > MAX_DOCUMENT_CHUNK_CHARS) {
          for (const whitespace of splitLongLine(gap)) parts.push({ text: whitespace, gap: '' })
          text = slice
        } else {
          text = gap + slice
        }
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
