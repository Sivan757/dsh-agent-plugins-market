/**
 * The persisted translation of every field the market has shown.
 *
 * Upstream catalogs are authored in English, so a Chinese deployment renders
 * English prose in every card. Translations come from the ordered provider
 * chain and are kept here so each field is paid for once, across restarts.
 *
 * The key carries the provider identity alongside the content and the locale:
 * switching engines misses the cache and re-translates instead of serving text
 * one engine produced under another engine's name. Entries are kept until the
 * user clears them, and a missing, unreadable, or hand-edited file degrades to
 * "nothing translated yet" rather than failing the panel.
 */
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { TranslationProviderId } from '../../contracts/translation.js'
import type { TranslationUnit } from '../translation/unit.js'
import { readJsonFile, writeJsonDocument } from '../json-file.js'

/** One cached translation, stored under its own key. */
export interface TranslationRecord {
  /** The translated text exactly as the provider returned it. */
  text: string
  /** The provider that produced this text, for operator inspection. */
  provider: TranslationProviderId
  /** Epoch milliseconds of the successful call, for operator inspection. */
  at: number
}

/** The persisted document shape; unknown keys are dropped on read. */
interface TranslationCacheDocument {
  version: 1
  entries: Record<string, TranslationRecord>
}

/** The provider ids a normalized record may carry. */
const PROVIDER_IDS: readonly TranslationProviderId[] = ['google', 'microsoft', 'llm']

/**
 * The cache file inside the plugin data root.
 * @param dataRoot - the plugin's own storage root, never the project directory.
 * @returns the absolute path of the translation cache.
 */
export function translationCachePath(dataRoot: string): string {
  return join(dataRoot, 'translation-cache.json')
}

/**
 * One cache key: target locale, the unit's identity and text, and the provider
 * chain's identity.
 *
 * Every part is joined with a NUL so no id containing the separator can alias
 * another unit's entry, and the digest keeps the key bounded regardless of how
 * long an upstream description is. The provider identity is part of the key on
 * purpose: a deployment that changes engines must not serve the old engine's
 * text as if the new one had produced it.
 * @param unit - the field being translated.
 * @param locale - the target locale id.
 * @param providerIdentity - stable identity of the provider chain in use.
 * @returns a stable key for the persisted entry.
 */
export function translationKey(unit: TranslationUnit, locale: string, providerIdentity: string): string {
  const identity = [locale, unit.surface, unit.id, unit.role, unit.text, providerIdentity].join('\u0000')
  return createHash('sha256').update(identity, 'utf8').digest('hex')
}

/** The empty document a missing or unreadable cache degrades to. */
function emptyDocument(): TranslationCacheDocument {
  return { version: 1, entries: {} }
}

/**
 * Keep only well-formed entries, so a hand-edited file cannot inject junk.
 */
function normalize(value: unknown): TranslationCacheDocument {
  const entries = (value as TranslationCacheDocument | undefined)?.entries
  if (entries === null || typeof entries !== 'object') return emptyDocument()
  const kept: Record<string, TranslationRecord> = {}
  for (const [key, entry] of Object.entries(entries)) {
    const record = entry as TranslationRecord | null
    if (record === null || typeof record !== 'object') continue
    if (typeof record.text !== 'string' || record.text.length === 0) continue
    if (!PROVIDER_IDS.includes(record.provider)) continue
    kept[key] = {
      text: record.text,
      provider: record.provider,
      at: typeof record.at === 'number' ? record.at : 0
    }
  }
  return { version: 1, entries: kept }
}

/**
 * Read the live cache. A missing, unreadable, or malformed file yields an empty
 * cache: the panel always renders, it just has nothing translated yet.
 * @param dataRoot - the plugin's own storage root.
 * @returns the cached translations keyed by {@link translationKey}.
 */
export async function loadTranslationCache(dataRoot: string): Promise<Record<string, TranslationRecord>> {
  try {
    return normalize(await readJsonFile(translationCachePath(dataRoot))).entries
  } catch {
    return {}
  }
}

/**
 * Delete the whole cache file.
 *
 * A missing file is the desired end state, not a failure, so the removal is
 * tolerant. The caller re-reads through {@link loadTranslationCache} to confirm.
 * @param dataRoot - the plugin's own storage root.
 */
export async function clearTranslationCache(dataRoot: string): Promise<void> {
  try {
    await rm(translationCachePath(dataRoot), { force: true })
  } catch {
    // Nothing to clear, or the file was already gone.
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
export async function saveTranslationCache(dataRoot: string, entries: Record<string, TranslationRecord>): Promise<void> {
  const document: TranslationCacheDocument = { version: 1, entries }
  await writeJsonDocument(translationCachePath(dataRoot), document)
}
