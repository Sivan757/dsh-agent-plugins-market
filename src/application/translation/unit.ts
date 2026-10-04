import type { TranslationRole, TranslationSurfaceKind } from '../../contracts/translation.js'

/** One translatable field: the entity it belongs to, which field, and the source text. */
export interface TranslationUnit {
  surface: TranslationSurfaceKind
  /** Stable identity of the entity inside its surface (e.g. "sourceId/suiteId"). */
  id: string
  role: TranslationRole
  /** The upstream text, exactly as authored. */
  text: string
}

/**
 * Collect units for one entity, skipping empty or undefined text.
 *
 * Name comes before description so a batch keeps the reading order of the card
 * the results render into. The text is carried verbatim — the emptiness check
 * trims, but the unit does not, so the cache key stays tied to what upstream
 * actually authored.
 * @param surface - the surface the entity belongs to.
 * @param id - the entity's stable identity inside that surface.
 * @param fields - the entity's upstream name and description.
 * @returns the units to translate, in render order.
 */
export function collectUnits(surface: TranslationSurfaceKind, id: string, fields: { name?: string | undefined; description?: string | undefined }): TranslationUnit[] {
  const units: TranslationUnit[] = []
  if (isTranslatable(fields.name)) units.push({ surface, id, role: 'name', text: fields.name })
  if (isTranslatable(fields.description)) units.push({ surface, id, role: 'description', text: fields.description })
  return units
}

/**
 * Deduplicate units by identity across a whole scan; first occurrence wins.
 *
 * Two entities may carry the same text, and one entity may be reached twice by
 * a scan; either way the identity — surface, entity id, role — is what decides,
 * so a repeated read collapses onto the unit already queued.
 * @param units - the units collected from every surface.
 * @returns one unit per identity, in first-seen order.
 */
export function dedupeUnits(units: readonly TranslationUnit[]): TranslationUnit[] {
  const seen = new Set<string>()
  const kept: TranslationUnit[] = []
  for (const unit of units) {
    const identity = unitIdentity(unit)
    if (seen.has(identity)) continue
    seen.add(identity)
    kept.push(unit)
  }
  return kept
}

/** The identity parts joined with a NUL, so no id can alias another unit. */
function unitIdentity(unit: TranslationUnit): string {
  return [unit.surface, unit.id, unit.role].join('\u0000')
}

/** Whether a field holds text worth sending to a translation backend. */
function isTranslatable(text: string | undefined): text is string {
  return typeof text === 'string' && text.trim() !== ''
}
