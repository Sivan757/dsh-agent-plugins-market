/**
 * Locale-aware selection for text that carries both languages.
 *
 * Every surface that renders upstream text shares this module: a suite card, a
 * panel entry, an MCP row. Upstream manifests stay single-field, so bilingual
 * authors pack both languages into one string, and the viewer shows only the
 * active locale's segment.
 * @module client/ui/bilingual-text
 */
import type { Translate } from '../index.js'

/**
 * Pick the segment matching the active locale from a bilingual string.
 *
 * Upstream manifests stay single-field, so bilingual authors pack both
 * languages into one string separated by a middot or dash with spaces
 * (`中文 · English`). The viewer shows only the active locale's segment;
 * a monolingual string (either language) or an unknown separator passes
 * through untouched, so nothing today changes rendering.
 * @param description - the text to resolve, in one language or both.
 * @param t - the active translator, probed for the locale marker.
 * @returns the active locale's segment, or the input when it carries one language.
 */
export function pickBilingualDescription(description: string | undefined | null, t: Translate): string | undefined {
  if (description === undefined || description === null) return undefined
  const split = splitBilingual(description)
  if (split === undefined) return description
  const zhFirst = hasHan(split[0])
  if (!zhFirst && !hasHan(split[1])) return description
  return localeIsChinese(t) ? (zhFirst ? split[0] : split[1]) : (zhFirst ? split[1] : split[0])
}

/**
 * Whether the active locale reads Chinese.
 *
 * The locale keys resolve per active language, so a key whose zh and en values
 * differ answers it directly. Every surface asks the same question the same way:
 * picking a segment out of a bilingual string, and deciding whether a translation
 * into the interface language would say anything the reader cannot already read.
 * @param t - the active translator.
 * @returns whether the interface language is Chinese.
 */
export function localeIsChinese(t: Translate): boolean {
  return t('localeProbeLang') === '中文'
}

/**
 * Split on the first ` · ` or ` - ` separator when both sides are non-empty.
 * @param text - the candidate bilingual string.
 * @returns the two trimmed segments, or `undefined` when no usable separator splits it.
 */
export function splitBilingual(text: string): [string, string] | undefined {
  for (const sep of [' · ', ' - ']) {
    const at = text.indexOf(sep)
    if (at > 0 && at + sep.length < text.length) {
      return [text.slice(0, at).trim(), text.slice(at + sep.length).trim()]
    }
  }
  return undefined
}

/**
 * True when the string contains at least one CJK ideograph.
 * @param text - the segment to test.
 * @returns whether the segment is written with Han characters.
 */
export function hasHan(text: string): boolean {
  return /\p{Script=Han}/u.test(text)
}
