/**
 * The one render-time rule for translated text.
 *
 * A translated field is a presentation-layer override: the server resolves it
 * through the translation chain and leaves it absent when nothing was
 * translated. Every surface resolves the description it renders through this
 * module, so the translation, the authored fallback and the locale split happen
 * the same way wherever a description appears.
 * @module client/ui/translated-text
 */
import type { Translate } from '../index.js'
import { pickBilingualDescription } from './bilingual-text.js'

/** How a surface wants the text resolved. */
export interface DisplayTextOptions {
  /**
   * Render the authored upstream text rather than the translation, for the
   * panel-wide view switch. A field nothing was translated for reads the same
   * either way.
   */
  original?: boolean
}

/**
 * Resolve the text one surface renders: the translation when it exists, the
 * upstream text otherwise, then the active locale's segment of whichever won.
 *
 * The locale split runs after the choice rather than before it. A translated
 * field is already written in the viewer's language and passes through, while
 * an untranslated `中文 · English` field still resolves to the matching half.
 * @param translated - the server-resolved translation, absent when none was produced.
 * @param original - the upstream text, which is what an absent translation renders.
 * @param t - the active translator, used for the locale probe.
 * @param options - set `original` to read the authored text instead of the translation.
 * @returns the text to render, or `undefined` when both inputs are missing.
 */
export function displayText(
  translated: string | undefined,
  original: string | undefined,
  t: Translate,
  options: DisplayTextOptions = {}
): string | undefined {
  const chosen = options.original === true ? original : (translated ?? original)
  return pickBilingualDescription(chosen, t)
}
