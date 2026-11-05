/**
 * The name a source is known by.
 *
 * A source id is a stable key, not a label: it is derived from the URL's
 * basename, so two repositories called `skills` from different owners collide
 * and the second one is stored as `skills-2`. Neither id says where the
 * content came from, and a bare `skills` says nothing at all.
 *
 * The qualified name answers with the path the repository actually lives at
 * (`jeecgboot/skills`). It is a display name only: the id, the persisted state
 * and every `market:<sourceId>/<suiteId>` resource id stay exactly as they
 * are, because a name a reader recognizes is worth less than a key that does
 * not move.
 */
import type { Suite } from '../../../market-contracts/src/model/types.js'
import { parseRemoteRepository, sanitizeId } from './paths.js'

/**
 * Whether a source's suites are skill collections rather than a plugin
 * marketplace.
 *
 * The scanner marks a manifest-less collection with the `skill-collection`
 * layout, so a source whose every suite carries that layout ships skills and
 * nothing else. A source with no suite at all is not one of them: it has
 * nothing to name.
 */
export function isSkillsOnlySource(suites: readonly Suite[]): boolean {
  return suites.length > 0 && suites.every(suite => suite.manifest.layout === 'skill-collection')
}

/**
 * The name a reader recognizes a source by, or undefined when its id already
 * says which repository it is.
 *
 * @param source - the source as it is persisted; its id is read, never written.
 * @param suites - the suites the source contributed to the snapshot.
 * @returns `owner/repository`, or undefined when the id is already
 *   unambiguous or the source is not a remote skills collection.
 */
export function qualifiedSourceName(source: { id: string; url: string; local?: boolean }, suites: readonly Suite[]): string | undefined {
  // A local directory is named by the reader who chose it; there is no owner to add.
  if (source.local === true) return undefined
  if (!isSkillsOnlySource(suites)) return undefined
  const remote = parseRemoteRepository(source.url)
  if (remote === undefined) return undefined
  // Only plain names are shown: a path segment carrying punctuation is not
  // something to put in front of a slash.
  if (!/^[\w.-]+$/.test(remote.owner) || !/^[\w.-]+$/.test(remote.base)) return undefined
  // The id already names the owner (`jeecgboot-skills`): the row is recognizable as it stands.
  if (source.id === `${sanitizeId(remote.owner)}-${sanitizeId(remote.base)}`) return undefined
  return `${remote.owner}/${remote.base}`
}
