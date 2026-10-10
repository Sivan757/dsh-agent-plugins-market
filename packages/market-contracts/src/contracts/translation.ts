/**
 * The wire and domain vocabulary of the translation layer.
 *
 * A translation unit names one translatable field of one entity — a suite
 * description, an MCP tool description — and the translated field set carries
 * the results back to every surface that renders them. Kept free of imports so
 * both the server layers and the client bundle can depend on it.
 *
 * Descriptions and document prose are translated. A name is an identifier the user types,
 * greps, and matches against upstream documentation, and machine translation
 * turned them into text that was harder to recognize than the original — so
 * the layer never touches one.
 */

/** One translation backend: a public machine-translation endpoint or the user's own model. */
export type TranslationProviderId = 'google' | 'microsoft' | 'llm'

/** One translation backend: a public endpoint or the user's own model. */
export interface TranslationProvider {
  /** Which provider this is; also the identity folded into the cache key. */
  readonly id: TranslationProviderId
  /**
   * Whether this provider can serve a call right now.
   *
   * Read per call and never cached: a model route provisions after the plugin's
   * apply() returns, so an answer captured at composition time would report
   * "unavailable" for the life of the process.
   */
  available(): boolean
  /** Translate one batch, preserving order and length. Rejects on any failure. */
  translate(request: { texts: readonly string[]; locale: string; signal: AbortSignal }): Promise<string[]>
}

/** One surface whose entities are translated; matches the six switchable surfaces. */
export type TranslationSurfaceKind = 'market' | 'skills' | 'commands' | 'agents' | 'mcp' | 'lsp'

/**
 * Which text of one entity a cached translation belongs to.
 *
 * The role is a cache-key slot rather than a rendering concern: a description
 * and a document body retain distinct historical keys. The localizer can reuse
 * one translation when their source text and target are identical.
 */
export type TranslationRole = 'description' | 'document'

/**
 * The translated fields of one entity.
 *
 * The description is optional because it may be cached, still pending, or
 * absent upstream. An absent field means "render the upstream text".
 */
export interface TranslationFields {
  translatedDescription?: string
}

/**
 * One document body on its way to the target language.
 *
 * Each paragraph remains authored until every request for it succeeds.
 * `pending` counts paragraphs with unfinished work. `failed` counts paragraphs
 * that cannot currently produce a complete translation. Other paragraphs remain
 * readable while those requests settle.
 */
export interface DocumentTranslation {
  /** The body with complete translated paragraphs and authored fallbacks. */
  text: string
  /** Complete Markdown with each translated paragraph directly after its original. */
  bilingualText?: string
  /** Paragraphs with queued or running work; the client re-reads while this is non-zero. */
  pending: number
  /** Paragraphs left original because translation failed or a sentence exceeds its safe budget. */
  failed?: number
}

/**
 * Merge two optional field sets; the later one wins per field.
 *
 * A field left undefined in `next` leaves the `base` value in place, so a
 * caller can layer a partial result over an earlier one without erasing it.
 * @param base - the field set to start from.
 * @param next - the field set layered on top.
 * @returns a new field set holding the merged values.
 */
export function mergeTranslationFields(base: TranslationFields, next: TranslationFields): TranslationFields {
  const merged: TranslationFields = { ...base }
  if (next.translatedDescription !== undefined) merged.translatedDescription = next.translatedDescription
  return merged
}
