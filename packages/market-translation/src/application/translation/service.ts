/**
 * The market's translation service: the reads a catalog surface asks for, over
 * one localizer this service owns.
 *
 * The three reads are the whole translation vocabulary a surface needs — one
 * entity's fields, one authored text, one Markdown document — and every one of
 * them resolves through the same localizer, so the cache, the queue and the
 * provider chain stay a single instance per activation. The localizer's own
 * lifecycle (load, dispose, clear, enabled edge, settle) is forwarded rather
 * than re-exposed, so a caller cannot reach past it.
 * @module application/translation/service
 */
import type { DocumentTranslation, TranslationFields, TranslationRole, TranslationSurfaceKind } from '../../../../market-contracts/src/contracts/translation.js'
import { chunkDocument, translateMarkdownDocument } from './document.js'
import { TranslationLocalizer, type LocalizerOptions } from './localizer.js'
import { collectUnits } from './unit.js'

/** Composition options of the service; the localizer's own options, unchanged. */
export type TranslationServiceOptions = LocalizerOptions

export class TranslationService {
  private readonly localizer: TranslationLocalizer

  constructor(options: LocalizerOptions) {
    this.localizer = new TranslationLocalizer(options)
  }

  /** Read the persisted cache once, before the first {@link translateFields} read. */
  load(): Promise<void> {
    return this.localizer.load()
  }

  /** Cancel timers and drop queued work; in-flight calls finish and are persisted. */
  dispose(): void {
    this.localizer.dispose()
  }

  /** Drop every cached translation, in memory and on disk. */
  clear(): Promise<void> {
    return this.localizer.clear()
  }

  /** Apply a live display-preference change: off cancels unfinished work, on forgets failures. */
  onEnabledChanged(): void {
    this.localizer.onEnabledChanged()
  }

  /** Wait until the queue drains or the deadline passes. */
  settle(deadlineMs?: number): Promise<boolean> {
    return this.localizer.settle(deadlineMs)
  }

  /**
   * Translate one entity's description for a surface.
   *
   * Only the description is a translatable field: a name is an identity the user
   * types, greps, and matches against upstream documentation, so the collector
   * hands back no unit for one. Nothing here waits on a provider: an uncached
   * field answers with the upstream text and reports itself pending.
   *
   * A description longer than one chunk travels in chunks, exactly as a
   * document body does ({@link localizeText}), so the size of an upstream field
   * is never a reason for a provider call to be cut off.
   *
   * Exposed for the panel and status surfaces that build their own rows; it is
   * not part of the HTTP route surface.
   * @param surface - the surface the entity belongs to.
   * @param id - the entity's stable identity inside that surface.
   * @param fields - the entity's upstream name and description.
   * @param locale - the host locale this read resolved once; there is no
   * default, because a default would re-read the host preference per entity and
   * make a read's cost scale with its row count.
   * @returns the translated fields and how many of them are still pending.
   */
  translateFields(
    surface: TranslationSurfaceKind,
    id: string,
    fields: { name?: string | undefined; description?: string | undefined },
    locale: string
  ): { fields: TranslationFields; pending: number } {
    const translated: TranslationFields = {}
    let pending = 0
    for (const unit of collectUnits(surface, id, fields)) {
      const result = this.localizeText(unit.surface, unit.id, unit.role ?? 'description', unit.text, locale)
      pending += result.pending
      if (result.text !== unit.text) translated.translatedDescription = result.text
    }
    return { fields: translated, pending }
  }

  /**
   * Translate one authored text, chunk by chunk, and reassemble it exactly.
   *
   * Every text the layer sends travels the way a document does: split on blank
   * lines into chunks one request may carry, fenced code passed through
   * verbatim, and the authored text between chunks re-emitted rather than
   * synthesized — so a text nothing was translated for comes back byte for
   * byte, and a translated one keeps the author's own blank lines. A
   * description is chunked for the same reason a document is: the model hop
   * sizes one call's output from the source it carries, and a text that exceeds
   * that budget is cut off mid-generation, which fails the batch and retires the
   * provider for the rest of the session.
   * @param surface - the surface the entity belongs to.
   * @param id - the entity's stable identity inside that surface.
   * @param role - which text of the entity this is; the cache key's role slot.
   * @param text - the authored text.
   * @param locale - the interface language this read resolved once.
   * @returns the reassembled text and how many of its chunks are still in flight.
   */
  private localizeText(surface: TranslationSurfaceKind, id: string, role: TranslationRole, text: string, locale: string): { text: string; pending: number } {
    const chunks = chunkDocument(text)
    if (chunks.length === 0) return { text, pending: 0 }
    let pending = 0
    const parts: string[] = []
    for (const chunk of chunks) {
      if (!chunk.translatable) {
        parts.push(chunk.text, chunk.separator)
        continue
      }
      const result = this.localizer.localize({ surface, id, role, text: chunk.text }, locale)
      if (result.pending) pending += 1
      parts.push(result.text, chunk.separator)
    }
    return { text: parts.join(''), pending }
  }

  /**
   * Translate paragraphs in one complete Markdown tree. The provider receives
   * prose only. Links, code, math, references and nested containers remain local.
   * The result includes a translated document and paragraph-paired Markdown.
   * Unchanged output preserves the source bytes. Changed output preserves the
   * parsed structure and uses canonical Markdown formatting.
   */
  translateDocument(surface: TranslationSurfaceKind, id: string, text: string, locale: string): DocumentTranslation {
    return translateMarkdownDocument(text, part => this.localizer.localize({ surface, id, role: 'document', text: part }, locale))
  }
}
