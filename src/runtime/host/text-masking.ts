/**
 * Mask the spans a machine engine corrupts, then restore them from its answer.
 *
 * Neither keyless endpoint leaves technical text alone: Google's HTML aligner
 * escapes a bare `<`, and Microsoft folds angle brackets into pseudo-tags. The
 * spans those engines damage — inline code, URLs, tag fragments and `${VAR}`
 * paths — are exactly what a catalog description is made of, and the fixed terms
 * are the ones an engine likes to paraphrase. Sending a bracketed token instead
 * keeps the payload plain, and the restore table puts the original text back.
 *
 * The same table is the integrity check. An answer is accepted only when every
 * placeholder it recorded comes back exactly once and nothing placeholder-shaped
 * was invented, so a truncated or rewritten answer is discarded rather than
 * rendered with a stray `⟦C1⟧` in it.
 * @module runtime/host/text-masking
 */

/** One masked payload: the text to send, and the restore table. */
export interface MaskedText {
  /** The text to hand to a translation engine. */
  text: string
  /** Placeholder to original span, for {@link unmaskText}. */
  placeholders: ReadonlyMap<string, string>
}

/** One masking pass: the letter its placeholders carry, and the span it claims. */
interface MaskRule {
  letter: string
  pattern: RegExp
}

/**
 * The masking passes, widest span first.
 *
 * Order is load-bearing, in two places. Inline code runs first because its body
 * may contain every other span, and angle-bracket fragments run before URLs
 * because a markdown autolink is one fragment: masking the URL first would
 * leave its bare `<` behind for the engine to escape, while masking the
 * fragment first keeps the whole span intact.
 */
const MASK_RULES: readonly MaskRule[] = [
  { letter: 'C', pattern: /`[^`]*`/g },
  { letter: 'T', pattern: /<[^>]{0,200}>/g },
  { letter: 'U', pattern: /https?:\/\/\S+/g },
  { letter: 'V', pattern: /\$\{[A-Z_][A-Z0-9_]*\}/g },
  { letter: 'K', pattern: /\b(?:MCP|LSP|DSH|CLI|API|JSON|HTTP|URL|SDK)\b/g }
]

/** The placeholder shape: a category letter and a 1-based index between U+27E6 and U+27E7. */
const PLACEHOLDER_PATTERN = '⟦[A-Z]\\d+⟧'

/** Every placeholder-shaped token in one string, in order of appearance. */
function placeholderTokens(text: string): string[] {
  return text.match(new RegExp(PLACEHOLDER_PATTERN, 'g')) ?? []
}

/**
 * Replace every span the engines damage with a numbered placeholder.
 * @param input - the upstream text, exactly as authored.
 * @returns the text to send, and the table that restores it.
 */
export function maskText(input: string): MaskedText {
  const placeholders = new Map<string, string>()
  let text = input
  for (const rule of MASK_RULES) {
    let index = 0
    text = text.replace(rule.pattern, match => {
      index += 1
      const placeholder = `⟦${rule.letter}${index}⟧`
      placeholders.set(placeholder, match)
      return placeholder
    })
  }
  return { text, placeholders }
}

/**
 * Put every masked span back, or reject the answer.
 *
 * An answer is rejected — `undefined`, so the caller discards the item instead
 * of caching it — when a placeholder is missing, arrives twice, or when the
 * engine invented one of its own. A short answer that dropped a placeholder
 * would otherwise restore a sentence with a hole in it, and an invented one
 * would render as literal brackets.
 * @param masked - the text the engine returned.
 * @param placeholders - the table {@link maskText} produced for that text.
 * @returns the restored text, or `undefined` when the answer cannot be trusted.
 */
export function unmaskText(masked: string, placeholders: ReadonlyMap<string, string>): string | undefined {
  const seen = new Map<string, number>()
  for (const token of placeholderTokens(masked)) seen.set(token, (seen.get(token) ?? 0) + 1)
  // Counting both directions rejects a dropped, duplicated and invented
  // placeholder with one comparison: the answer carries exactly the table's
  // keys, each of them once.
  if (seen.size !== placeholders.size) return undefined
  for (const [token, count] of seen) {
    if (count !== 1 || !placeholders.has(token)) return undefined
  }
  let restored = masked
  for (const [placeholder, original] of placeholders) restored = restored.split(placeholder).join(original)
  return restored
}
