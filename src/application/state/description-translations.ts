/**
 * The persisted zh translation of every suite description the market has shown.
 *
 * Upstream catalogs are authored in English, so a Chinese deployment renders
 * English prose in every suite card. The translation is produced by the host
 * LLM seam (see {@link DescriptionTranslator}) and kept here so the panel pays
 * for each description once, across restarts.
 *
 * The key deliberately carries a content hash rather than a version counter:
 * a suite that rewrites its description misses the cache and is translated
 * again, while a suite that merely bumps its version keeps its translation.
 */
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { readJsonFile, writeJsonDocument } from '../json-file.js'

/** One cached translation, stored under its own key. */
export interface DescriptionTranslationRecord {
  /** The translated text exactly as the model returned it. */
  text: string
  /** Epoch milliseconds of the successful call, for operator inspection. */
  at: number
}

/** The persisted document shape; unknown keys are dropped on read. */
interface DescriptionTranslationDocument {
  version: 1
  entries: Record<string, DescriptionTranslationRecord>
}

/**
 * The cache file inside the plugin data root.
 * @param dataRoot - the plugin's own storage root, never the project directory.
 * @returns the absolute path of the translation cache.
 */
export function descriptionTranslationsPath(dataRoot: string): string {
  return join(dataRoot, 'description-translations.json')
}

/**
 * One cache key: source, suite, description content, and target locale.
 *
 * The three identity parts are joined with a NUL so no id containing the
 * separator can alias another suite's entry. The digest keeps the key bounded
 * regardless of how long an upstream description is.
 * @param sourceId - the owning source id.
 * @param suiteId - the suite id inside that source.
 * @param description - the exact English text that was translated.
 * @param locale - the target locale id.
 * @returns a stable key for the persisted entry.
 */
export function descriptionTranslationKey(sourceId: string, suiteId: string, description: string, locale: string): string {
  const identity = [sourceId, suiteId, locale, description].join('\u0000')
  return createHash('sha256').update(identity, 'utf8').digest('hex')
}

/** The empty document a missing or unreadable cache degrades to. */
function emptyDocument(): DescriptionTranslationDocument {
  return { version: 1, entries: {} }
}

/** Keep only well-formed entries, so a hand-edited file cannot inject junk. */
function normalize(value: unknown): DescriptionTranslationDocument {
  const entries = (value as DescriptionTranslationDocument | undefined)?.entries
  if (entries === null || typeof entries !== 'object') return emptyDocument()
  const kept: Record<string, DescriptionTranslationRecord> = {}
  for (const [key, entry] of Object.entries(entries)) {
    const record = entry as DescriptionTranslationRecord | null
    if (record === null || typeof record !== 'object') continue
    if (typeof record.text !== 'string' || record.text.length === 0) continue
    kept[key] = { text: record.text, at: typeof record.at === 'number' ? record.at : 0 }
  }
  return { version: 1, entries: kept }
}

/**
 * Read the whole cache. A missing, unreadable, or malformed file yields an
 * empty cache: the panel always renders, it just has nothing translated yet.
 * @param dataRoot - the plugin's own storage root.
 * @returns the cached translations keyed by {@link descriptionTranslationKey}.
 */
export async function loadDescriptionTranslations(dataRoot: string): Promise<Record<string, DescriptionTranslationRecord>> {
  try {
    return normalize(await readJsonFile(descriptionTranslationsPath(dataRoot))).entries
  } catch {
    return {}
  }
}

/**
 * Replace the whole cache document.
 *
 * Writes go through the shared atomic writer, so a crash mid-write leaves the
 * previous cache readable rather than a truncated file.
 * @param dataRoot - the plugin's own storage root.
 * @param entries - the complete entry set to persist.
 */
export async function saveDescriptionTranslations(dataRoot: string, entries: Record<string, DescriptionTranslationRecord>): Promise<void> {
  const document: DescriptionTranslationDocument = { version: 1, entries }
  await writeJsonDocument(descriptionTranslationsPath(dataRoot), document)
}
