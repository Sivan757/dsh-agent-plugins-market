/**
 * One persisted workspace tab layout and its atomic read-modify-write.
 *
 * A sibling of the surface-toggle policy, not a section of it: that document
 * already has one owner, and a second writer sharing it would clobber whichever
 * mutation lost the race. This file owns `tab-layout/<workspace hash>.json` and
 * nothing else.
 *
 * The read is tolerant the way every plugin state file is: an absent, empty,
 * unparsable, or hand-edited document resolves to "nothing stowed", never to a
 * throw that would block the workspace.
 * @module application/state/tab-layout
 */
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { withFileLock } from '@deepseek-ai/dsh-atomic-write'
import { readJsonFile, writeJsonDocument } from '../../../../market-catalog/src/index.js'
import { emptyTabLayout, resolveHiddenTabs, TAB_LAYOUT_VERSION, type TabLayoutWire } from '../../../../market-contracts/src/contracts/tab-layout.js'

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
 * An unusable document reads as nothing stowed: the tab row is then complete,
 * which is the safe direction for a layout nobody can see. The clamp that keeps
 * one tab visible lives in `resolveHiddenTabs`, so a hand-written file cannot
 * empty the row either.
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
    if (error instanceof SyntaxError) return emptyTabLayout()
    throw error
  }
  if (typeof value !== 'object' || value === null) return emptyTabLayout()
  return { hidden: resolveHiddenTabs((value as Record<string, unknown>)['hidden']) }
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
    const next = { hidden: resolveHiddenTabs(mutate(await loadTabLayout(dataRoot, workspace)).hidden) }
    await writeJsonDocument(path, { version: TAB_LAYOUT_VERSION, workspace, hidden: next.hidden })
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
  return mutateTabLayout(dataRoot, workspace, () => ({ hidden: requested }))
}
