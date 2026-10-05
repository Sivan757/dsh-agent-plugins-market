import type { TranslationRole, TranslationSurfaceKind } from '../../contracts/translation.js'

/** One translatable field: the entity it belongs to and the source text. */
export interface TranslationUnit {
  surface: TranslationSurfaceKind
  /** Stable identity of the entity inside its surface (e.g. "sourceId/suiteId"). */
  id: string
  /** The upstream text, exactly as authored. */
  text: string
  /**
   * Which text of the entity this is; the cache key's role slot.
   *
   * Absent means {@link TranslationRole}'s description — the only role the
   * layer had before document bodies joined it — so every entry already on disk
   * keeps the key it was written under.
   */
  role?: TranslationRole | undefined
}

/**
 * Collect units for one entity, skipping empty or undefined text.
 *
 * Descriptions only: a name is an identifier the user types and matches against
 * upstream documentation, and translating one made it harder to recognize than
 * the original. The text is carried verbatim — the emptiness check trims, but
 * the unit does not, so the cache key stays tied to what upstream authored.
 * @param surface - the surface the entity belongs to.
 * @param id - the entity's stable identity inside that surface.
 * @param fields - the entity's upstream name and description.
 * @returns the units to translate.
 */
export function collectUnits(surface: TranslationSurfaceKind, id: string, fields: { name?: string | undefined; description?: string | undefined }): TranslationUnit[] {
  return isTranslatable(fields.description) ? [{ surface, id, text: fields.description }] : []
}

/** Whether a field holds text worth sending to a translation backend. */
function isTranslatable(text: string | undefined): text is string {
  return typeof text === 'string' && text.trim() !== ''
}
