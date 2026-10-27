import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { loadTabLayout, mutateTabLayout, saveTabLayout, tabLayoutPath } from '../../../../packages/market-runtime/src/application/state/tab-layout.js'
import { TabLayoutService } from '../../../../packages/market-runtime/src/runtime/host/tab-layout-service.js'
import { DEFAULT_STOWED_TABS, WORKSPACE_TAB_KEYS } from '../../../../packages/market-contracts/src/contracts/tab-layout.js'

/** The starting row: three rarely needed surfaces stay stowed until someone edits it. */
const DEFAULT_HIDDEN = WORKSPACE_TAB_KEYS.filter(key => (DEFAULT_STOWED_TABS as readonly string[]).includes(key))

async function dataRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'tab-layout-'))
}

const workspace = '/work/project-alpha'

/** Write one document straight to the store's path, as a hand-edited file would be. */
async function writeRaw(root: string, document: unknown, space = workspace): Promise<void> {
  const path = tabLayoutPath(root, space)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(document), 'utf8')
}

describe('tab layout store', () => {
  it('round trips one workspace layout', async () => {
    const root = await dataRoot()
    expect(await loadTabLayout(root, workspace)).toEqual({ hidden: DEFAULT_HIDDEN })

    await saveTabLayout(root, workspace, ['lsp', 'hooks'])
    expect(await loadTabLayout(root, workspace)).toEqual({ hidden: ['lsp', 'hooks'] })

    // The document is versioned and names its workspace, so a moved file is
    // recognisable rather than silently applied to another project.
    const document = JSON.parse(await readFile(tabLayoutPath(root, workspace), 'utf8')) as Record<string, unknown>
    expect(document).toEqual({ version: 1, workspace, hidden: ['lsp', 'hooks'] })
  })

  it('keeps one file per workspace, keyed by a hash of the path', async () => {
    const root = await dataRoot()
    await saveTabLayout(root, '/work/alpha', ['mcp'])
    await saveTabLayout(root, '/work/beta', ['lsp'])

    expect(tabLayoutPath(root, '/work/alpha')).not.toBe(tabLayoutPath(root, '/work/beta'))
    expect(tabLayoutPath(root, '/work/alpha')).toContain(join('tab-layout', ''))
    expect(tabLayoutPath(root, '/work/alpha')).not.toContain('alpha')
    expect(await loadTabLayout(root, '/work/alpha')).toEqual({ hidden: ['mcp'] })
    expect(await loadTabLayout(root, '/work/beta')).toEqual({ hidden: ['lsp'] })
  })

  it.each([
    ['an absent file', undefined],
    ['an empty file', ''],
    ['unparsable text', '{ not json'],
    ['a bare array', []],
    ['a document with no hidden field', { version: 1, workspace }],
    ['a hidden field of the wrong type', { version: 1, hidden: 'skills' }]
  ])('reads %s as the default stow list', async (_label, contents) => {
    const root = await dataRoot()
    const path = tabLayoutPath(root, workspace)
    await mkdir(dirname(path), { recursive: true })
    if (typeof contents === 'string') await writeFile(path, contents, 'utf8')
    else if (contents !== undefined) await writeFile(path, JSON.stringify(contents), 'utf8')

    // No usable document means no recorded opinion, so the workspace opens the
    // way a fresh one does. This is deliberately not "nothing stowed": the
    // all-visible row is a choice, and it arrives as a written empty array.
    expect(await loadTabLayout(root, workspace)).toEqual({ hidden: DEFAULT_HIDDEN })
  })

  it('reads an explicitly empty stow list as every tab visible', async () => {
    const root = await dataRoot()
    await writeRaw(root, { version: 1, workspace, hidden: [] })

    expect(await loadTabLayout(root, workspace)).toEqual({ hidden: [] })
  })

  it('drops unknown keys and the pinned tab, and orders by display position', async () => {
    const root = await dataRoot()
    await writeRaw(root, { version: 1, workspace, hidden: ['hooks', 'not-a-tab', 'mcp', 'market', 7, 'hooks'], extra: true })

    // Kept in display order, not the file's order, so one layout writes the
    // same bytes however it was authored.
    expect(await loadTabLayout(root, workspace)).toEqual({ hidden: ['mcp', 'hooks'] })
  })

  it('never stores the pinned tab even when a caller asks for it', async () => {
    const root = await dataRoot()
    await saveTabLayout(root, workspace, ['market', 'skills'])

    expect(await loadTabLayout(root, workspace)).toEqual({ hidden: ['skills'] })
    const document = JSON.parse(await readFile(tabLayoutPath(root, workspace), 'utf8')) as { hidden: string[] }
    expect(document.hidden).toEqual(['skills'])
  })

  it('keeps the row non-empty when a hand-written file names every tab', async () => {
    const root = await dataRoot()
    await writeRaw(root, { version: 1, workspace, hidden: [...WORKSPACE_TAB_KEYS] })

    // Every stowable tab is stowed; the pinned one is dropped, so the row keeps it.
    expect(await loadTabLayout(root, workspace)).toEqual({ hidden: WORKSPACE_TAB_KEYS.filter(key => key !== 'market') })
  })

  it('serializes two concurrent writes so neither is lost', async () => {
    const root = await dataRoot()
    // Each mutation re-reads inside the file lock and adds one tab, which is the
    // shape two rapid clicks have.
    await Promise.all([
      mutateTabLayout(root, workspace, current => ({ hidden: [...current.hidden, 'mcp'] })),
      mutateTabLayout(root, workspace, current => ({ hidden: [...current.hidden, 'lsp'] })),
      mutateTabLayout(root, workspace, current => ({ hidden: [...current.hidden, 'hooks'] }))
    ])

    // Each mutation read the default, added one tab, and wrote the result; the
    // lock is what makes the third see the first two.
    expect(await loadTabLayout(root, workspace)).toEqual({ hidden: ['instructions', 'mcp', 'lsp', 'hooks'] })
  })
})

describe('TabLayoutService', () => {
  it('publishes what it persists, and hands out a detached snapshot', async () => {
    const root = await dataRoot()
    const service = new TabLayoutService(root, workspace)
    await service.reload()
    expect(service.currentLayout()).toEqual({ hidden: DEFAULT_HIDDEN })

    expect(await service.setHidden(['mcp'])).toEqual({ hidden: ['mcp'] })
    expect(await loadTabLayout(root, workspace)).toEqual({ hidden: ['mcp'] })

    const snapshot = service.currentLayout()
    snapshot.hidden.push('lsp')
    expect(service.currentLayout()).toEqual({ hidden: ['mcp'] })
  })

  it('reads the stored layout on reload', async () => {
    const root = await dataRoot()
    await saveTabLayout(root, workspace, ['personas'])
    const service = new TabLayoutService(root, workspace)
    await service.reload()
    expect(service.currentLayout()).toEqual({ hidden: ['personas'] })
  })

  it('shows every tab again', async () => {
    const root = await dataRoot()
    const service = new TabLayoutService(root, workspace)
    await service.setHidden(['mcp', 'lsp'])

    expect(await service.showAll()).toEqual({ hidden: [] })
    expect(await loadTabLayout(root, workspace)).toEqual({ hidden: [] })
  })

  it('refuses to stow the pinned tab and every unknown key', async () => {
    const root = await dataRoot()
    const service = new TabLayoutService(root, workspace)
    expect(await service.setHidden(['market', 'nope', 'lsp'])).toEqual({ hidden: ['lsp'] })
  })

  it('keeps the published layout when a write fails', async () => {
    // A directory where the document belongs makes the atomic write fail, which
    // is the shape a full disk or a permissions problem has.
    const root = await dataRoot()
    const service = new TabLayoutService(root, workspace)
    await service.setHidden(['mcp'])
    const path = tabLayoutPath(root, workspace)
    await writeFile(path + '.blocked', '', 'utf8')
    await mkdir(path + '.tmp', { recursive: true }).catch(() => undefined)

    // Point the store at a path whose parent is a file: the write cannot land.
    const brokenRoot = join(root, 'not-a-directory')
    await writeFile(brokenRoot, 'x', 'utf8')
    const broken = new TabLayoutService(brokenRoot, workspace)
    await expect(broken.setHidden(['lsp'])).rejects.toThrow()
    // A failed write leaves the published layout at the starting default, not at
    // the rejected value: the row must never show what was not stored.
    expect(broken.currentLayout()).toEqual({ hidden: DEFAULT_HIDDEN })
    // The healthy service is untouched by the failed one.
    expect(service.currentLayout()).toEqual({ hidden: ['mcp'] })
  })

  it('applies writes in order when two land at once', async () => {
    const root = await dataRoot()
    const service = new TabLayoutService(root, workspace)
    // Two clicks: the last one the user made is the one that must be stored.
    await Promise.all([service.setHidden(['mcp']), service.showAll(), service.setHidden(['lsp'])])
    expect(await loadTabLayout(root, workspace)).toEqual({ hidden: ['lsp'] })
  })

  it('holds the layout in memory without a workspace path', async () => {
    const root = await dataRoot()
    const service = new TabLayoutService(root, undefined)
    expect(await service.setHidden(['mcp'])).toEqual({ hidden: ['mcp'] })
    expect(service.currentLayout()).toEqual({ hidden: ['mcp'] })
    // Nothing was written for a composition that has no workspace, so a read of
    // the empty path still answers the default.
    expect(await loadTabLayout(root, '')).toEqual({ hidden: DEFAULT_HIDDEN })
  })
})
