/**
 * The wire and domain vocabulary of the translation layer.
 *
 * A translation unit names one translatable field of one entity — a suite
 * name, an MCP tool description — and the translated field set carries the
 * results back to every surface that renders them. Kept free of imports so
 * both the server layers and the client bundle can depend on it.
 */

/** Which field of an entity a translation unit carries. */
export type TranslationRole = 'name' | 'description'

/** One translation backend: a public machine-translation endpoint or the user's own model. */
export type TranslationProviderId = 'google' | 'microsoft' | 'llm'

/** One surface whose entities are translated; matches the six switchable surfaces. */
export type TranslationSurfaceKind = 'market' | 'skills' | 'commands' | 'agents' | 'mcp' | 'lsp'

/**
 * The translated fields of one entity.
 *
 * Both fields are optional because name and description are translated
 * independently: one may be cached or already Chinese while the other is
 * still pending. An absent field means "render the upstream text".
 */
export interface TranslationFields {
  translatedName?: string
  translatedDescription?: string
}

/**
 * Merge two optional field sets; the later one wins per field.
 *
 * A field left undefined in `next` leaves the `base` value in place, so a
 * caller can layer a name-only result over a description-only one without
 * erasing either.
 * @param base - the field set to start from.
 * @param next - the field set layered on top.
 * @returns a new field set holding the merged values.
 */
export function mergeTranslationFields(base: TranslationFields, next: TranslationFields): TranslationFields {
  const merged: TranslationFields = { ...base }
  if (next.translatedName !== undefined) merged.translatedName = next.translatedName
  if (next.translatedDescription !== undefined) merged.translatedDescription = next.translatedDescription
  return merged
}
