/**
 * One persisted workspace tab layout and its atomic read-modify-write.
 *
 * A sibling of the surface-toggle policy, not a section of it: that document
 * already has one owner, and a second writer sharing it would clobber whichever
 * mutation lost the race. This file owns `tab-layout/<workspace hash>.json` and
 * nothing else.
 *
 * The read is tolerant the way every plugin state file is: an absent, empty, or
 * hand-edited document resolves to the default stow list, never to a throw that
 * would block the workspace.
 * @module application/state/tab-layout
 */
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { readJsonFile, writeJsonDocument } from '../../../../market-catalog/src/index.js'
import { defaultTabLayout, resolveHiddenTabs, resolveTabOrder, TAB_LAYOUT_VERSION, type TabLayoutWire } from '../../../../market-contracts/src/contracts/tab-layout.js'

/** One workspace's stowed tabs as this store keeps them. */
export type TabLayout = TabLayoutWire

/**
 * Where one workspace's tab layout is stored.
 *
 * The workspace string is hashed rather than escaped: a workspace path is
 * arbitrary text, and the hash keeps the file name short and the directory
 * listing free of path fragments. The 24-hex prefix is the same budget the
 * surface-toggle policy uses beside it.
 * @param dataRoot - the plugin data root.
 * @param workspace - the workspace the layout belongs to.
 * @returns the layout document's absolute path.
 */
export function tabLayoutPath(dataRoot: string, workspace: string): string {
  const key = createHash('sha256').update(workspace).digest('hex').slice(0, 24)
  return join(dataRoot, 'tab-layout', key + '.json')
}

/**
 * Read one workspace's layout.
 *
 * A workspace with no document, or one that cannot be parsed, gets
 * {@link defaultTabLayout}: the same starting row a fresh workspace gets, which
 * keeps three rarely used surfaces out of the way. That is not a silent loss of
 * a person's choice, because a choice is written on the first edit and an
 * unparsable document carries none. The clamp that keeps one tab visible lives
 * in `resolveHiddenTabs`, so a hand-written file cannot empty the row either.
 * @param dataRoot - the plugin data root.
 * @param workspace - the workspace the layout belongs to.
 * @returns the resolved layout.
 */
export async function loadTabLayout(dataRoot: string, workspace: string): Promise<TabLayout> {
  let value: unknown
  try {
    value = await readJsonFile(tabLayoutPath(dataRoot, workspace))
  } catch (error) {
    // Unparsable text is a malformed document rather than an I/O failure: it
    // reads as nothing stowed so the workspace opens, and the next write
    // replaces the file. Every other failure stays fatal, because a permission
    // problem must surface instead of quietly showing every tab.
    if (error instanceof SyntaxError) return defaultTabLayout()
    throw error
  }
  // A document counts only when it carries a stow list. Anything else — a bare
  // array, a record with no `hidden`, a `hidden` of the wrong type — is a
  // document this release cannot read, which is the same fact as having none:
  // nobody expressed an opinion about the row.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return defaultTabLayout()
  const hidden = (value as Record<string, unknown>)['hidden']
  if (!Array.isArray(hidden)) return defaultTabLayout()
  // A document written before ordering carries no `order`; it renders in display
  // order, which is exactly what that document meant when it was written.
  return { hidden: resolveHiddenTabs(hidden), order: resolveTabOrder((value as Record<string, unknown>)['order']) }
}

/**
 * Re-read under the published host file lock, persist once, and return the
 * committed layout.
 *
 * Re-reading inside the lock is what makes two concurrent writers serialize:
 * the second sees the first's bytes, applies its own change, and writes the
 * result. The mutation stays synchronous, so no caller callback runs under the
 * lock.
 * @param dataRoot - the plugin data root.
 * @param workspace - the workspace the layout belongs to.
 * @param mutate - the change to apply to the document just read.
 * @returns the committed layout.
 */
export async function mutateTabLayout(dataRoot: string, workspace: string, mutate: (current: TabLayout) => TabLayout): Promise<TabLayout> {
  const path = tabLayoutPath(dataRoot, workspace)
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  return withFileLock(path, async () => {
    const changed = mutate(await loadTabLayout(dataRoot, workspace))
    // Both halves go through their resolver, so a hand-written file or a caller
    // cannot store a partial row or displace the pinned tab.
    const next: TabLayoutWire = { hidden: resolveHiddenTabs(changed.hidden), order: resolveTabOrder(changed.order) }
    await writeJsonDocument(path, { version: TAB_LAYOUT_VERSION, workspace, hidden: next.hidden, order: next.order })
    return next
  })
}

/**
 * Replace one workspace's stow list as one write.
 * @param dataRoot - the plugin data root.
 * @param workspace - the workspace the layout belongs to.
 * @param hidden - the requested stow list; it is resolved before it is stored.
 * @returns the committed layout.
 */
export async function saveTabLayout(dataRoot: string, workspace: string, hidden: readonly string[]): Promise<TabLayout> {
  const requested = [...hidden]
  return mutateTabLayout(dataRoot, workspace, current => ({ hidden: requested, order: current.order }))
}

/**
 * Replace one workspace's row order as one write, keeping its stow list.
 * @param dataRoot - the plugin data root.
 * @param workspace - the workspace the layout belongs to.
 * @param order - the requested order; it is completed and clamped before it is stored.
 * @returns the committed layout.
 */
export async function saveTabOrder(dataRoot: string, workspace: string, order: readonly string[]): Promise<TabLayout> {
  const requested = [...order]
  return mutateTabLayout(dataRoot, workspace, current => ({ hidden: current.hidden, order: resolveTabOrder(requested) }))
}
