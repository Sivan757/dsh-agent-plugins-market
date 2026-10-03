/** Locale-aware selection for suite descriptions that carry both languages. */
import type { Translate } from '../../index.js'

/**
 * Pick the segment matching the active locale from a bilingual description.
 *
 * Upstream manifests stay single-field, so bilingual authors pack both
 * languages into one string separated by a middot or dash with spaces
 * (`中文 · English`). The viewer shows only the active locale's segment;
 * a monolingual string (either language) or an unknown separator passes
 * through untouched, so nothing today changes rendering.
 */
export function pickBilingualDescription(description: string | undefined | null, t: Translate): string | undefined {
  if (description === undefined || description === null) return undefined
  const split = splitBilingual(description)
  if (split === undefined) return description
  const zhFirst = hasHan(split[0])
  if (!zhFirst && !hasHan(split[1])) return description
  // The viewer's locale keys resolve per active language: probe a key whose
  // zh and en values differ, then match the rendered text against a segment.
  const probe = t('localeProbeLang')
  return probe === '中文' ? (zhFirst ? split[0] : split[1]) : (zhFirst ? split[1] : split[0])
}

/** Split on the first ` · ` or ` - ` separator when both sides are non-empty. */
function splitBilingual(text: string): [string, string] | undefined {
  for (const sep of [' · ', ' - ']) {
    const at = text.indexOf(sep)
    if (at > 0 && at + sep.length < text.length) {
      return [text.slice(0, at).trim(), text.slice(at + sep.length).trim()]
    }
  }
  return undefined
}

/** True when the string contains at least one CJK ideograph. */
function hasHan(text: string): boolean {
  return /\p{Script=Han}/u.test(text)
}
