/**
 * The workspace policy: one document per workspace, one live owner.
 *
 * The surface switches and the per-entry deny sets live in one file per
 * workspace, and ResourceFilterService is its single live snapshot owner.
 * SurfaceToggleService is the legacy surface facade over that owner and keeps
 * no state or persistence of its own.
 *
 * These cases hold the lasting contract of that arrangement: an update re-reads
 * the document under the published file lock and publishes only after the write
 * succeeded, so two writers never lose each other's half; a reload takes its
 * turn behind the writes already queued; a failed write publishes nothing and
 * skips the refresh; a failed refresh leaves the committed state alone and does
 * not wedge the queue; and every snapshot a caller receives is detached. No case
 * depends on timing: each drives the services to completion.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { surfaceTogglesPath } from '../packages/market-runtime/src/application/state/workspace-policy.js'
import { ResourceFilterService } from '../packages/market-runtime/src/runtime/host/resource-filter-service.js'
import { SurfaceToggleService } from '../packages/market-runtime/src/runtime/host/surface-toggle-service.js'

/** One persisted workspace document, as the owner leaves it. */
interface WorkspaceDocument {
  version: number
  workspace: string
  toggles: Record<string, boolean>
  entries?: Record<string, string[]>
}

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function newDataRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'workspace-policy-'))
  roots.push(root)
  return root
}

/** One owner over one data root and workspace, reloaded as production does once. */
async function ownerAt(root: string, workspace: string, onFiltersChanged: () => Promise<void> | void = () => {}): Promise<ResourceFilterService> {
  const owner = new ResourceFilterService(root, workspace, { onFiltersChanged })
  await owner.reload()
  return owner
}

async function persisted(root: string, workspace: string): Promise<WorkspaceDocument> {
  return JSON.parse(await readFile(surfaceTogglesPath(root, workspace), 'utf8')) as WorkspaceDocument
}

describe('one workspace document, one live owner', () => {
  it('keeps a switched-off surface when an entry is denied afterwards', async () => {
    const root = await newDataRoot()
    const workspace = '/ws/surface-then-entry'
    const owner = await ownerAt(root, workspace)
    const entryId = 'mcp:alpha__db'

    await owner.setSurface('mcp', false)
    await owner.setEntry('mcp', entryId, false)

    const document = await persisted(root, workspace)
    expect(document.toggles.mcp).toBe(false)
    expect(document.entries?.mcp).toEqual([entryId])
    expect(owner.allowsSurface('mcp')).toBe(false)
    expect(owner.allowsEntry('mcp', entryId)).toBe(false)
  })

  it('keeps an entry denial when a surface is switched afterwards', async () => {
    const root = await newDataRoot()
    const workspace = '/ws/entry-then-surface'
    const owner = await ownerAt(root, workspace)
    const entryId = 'mcp:alpha__db'

    await owner.setEntry('mcp', entryId, false)
    await owner.setSurface('lsp', false)

    const document = await persisted(root, workspace)
    expect(document.entries?.mcp).toEqual([entryId])
    expect(document.toggles.lsp).toBe(false)
  })

  it('keeps both updates when one write is queued behind another', async () => {
    const root = await newDataRoot()
    const workspace = '/ws/queued-writes'
    const owner = await ownerAt(root, workspace)

    const first = owner.setEntry('mcp', 'mcp:alpha__db', false)
    const second = owner.setEntry('lsp', 'lsp:direct/json', false)
    await Promise.all([first, second])

    const document = await persisted(root, workspace)
    expect(document.entries?.mcp).toEqual(['mcp:alpha__db'])
    expect(document.entries?.lsp).toEqual(['lsp:direct/json'])
  })

  it('keeps both updates when two services write the same workspace concurrently', async () => {
    const root = await newDataRoot()
    const workspace = '/ws/concurrent-services'
    const first = await ownerAt(root, workspace)
    const second = await ownerAt(root, workspace)
    const entryId = 'mcp:alpha__db'

    await Promise.all([first.setSurface('mcp', false), second.setEntry('mcp', entryId, false)])

    // Neither write is lost: each re-read the document under the file lock
    // before committing, so the committed state carries both halves.
    const document = await persisted(root, workspace)
    expect(document.toggles.mcp).toBe(false)
    expect(document.entries?.mcp).toEqual([entryId])
    expect(first.allowsSurface('mcp')).toBe(false)
    expect(second.allowsEntry('mcp', entryId)).toBe(false)

    // A second live instance converges by reloading; the design publishes only
    // what the instance itself committed.
    await Promise.all([first.reload(), second.reload()])
    expect(first.allowsEntry('mcp', entryId)).toBe(false)
    expect(second.allowsSurface('mcp')).toBe(false)
  })

  it('takes a reload after the writes already queued', async () => {
    const root = await newDataRoot()
    const workspace = '/ws/reload-behind-write'
    const owner = await ownerAt(root, workspace)
    const entryId = 'skills:dsh-doc'

    // Neither is awaited before the other starts: the queue owns the order.
    const write = owner.setEntry('skills', entryId, false)
    const reload = owner.reload()
    await Promise.all([write, reload])

    expect(owner.allowsEntry('skills', entryId)).toBe(false)
    expect((await persisted(root, workspace)).entries?.skills).toEqual([entryId])
  })

  it('exposes coherent views through the owner and the legacy surface facade', async () => {
    const root = await newDataRoot()
    const workspace = '/ws/facade-coherence'
    const owner = await ownerAt(root, workspace)
    const legacy = new SurfaceToggleService(owner)
    const entryId = 'mcp:alpha__db'

    await legacy.set('mcp', false)
    expect(owner.allowsSurface('mcp')).toBe(false)

    await owner.setEntry('mcp', entryId, false)
    expect(legacy.currentToggles().mcp).toBe(false)
    expect(legacy.currentToggles().mcp).toBe(false)

    await legacy.reload()
    expect(legacy.currentToggles().mcp).toBe(false)
    expect(owner.allowsEntry('mcp', entryId)).toBe(false)
  })

  it('returns detached snapshots a caller cannot use to mutate the owner', async () => {
    const root = await newDataRoot()
    const workspace = '/ws/detached-snapshots'
    const owner = await ownerAt(root, workspace)
    const entryId = 'mcp:alpha__db'
    await owner.setEntry('mcp', entryId, false)

    const snapshot = owner.currentFilters()
    snapshot.toggles.mcp = false
    snapshot.offEntries.mcp = ['mcp:foreign', ...(snapshot.offEntries.mcp ?? [])]
    const returned = await owner.setEntry('lsp', 'lsp:direct/json', false)
    returned.toggles.mcp = false

    expect(owner.allowsSurface('mcp')).toBe(true)
    expect(owner.allowsEntry('mcp', 'mcp:foreign')).toBe(true)
    expect(owner.offEntriesOf('mcp')).toEqual([entryId])
    const legacy = new SurfaceToggleService(owner)
    const legacyToggles = legacy.currentToggles()
    legacyToggles.mcp = false
    expect(legacy.currentToggles().mcp).toBe(true)
    expect((await persisted(root, workspace)).toggles.mcp).toBe(true)
  })
})

describe('a failed write and a failed refresh', () => {
  it('publishes nothing and skips the refresh when the document cannot be written', async () => {
    const root = await newDataRoot()
    const workspace = '/ws/write-failure'
    const refreshes = vi.fn()
    const owner = await ownerAt(root, workspace, () => {
      refreshes()
    })
    // A regular file where the owner needs the policy directory: every read and
    // write of this document fails deterministically, with no permission tricks.
    await writeFile(join(root, 'surface-toggles'), 'not a directory')

    await expect(owner.setEntry('mcp', 'mcp:alpha__db', false)).rejects.toThrow()

    expect(owner.allowsEntry('mcp', 'mcp:alpha__db')).toBe(true)
    expect(refreshes).not.toHaveBeenCalled()
    await expect(readFile(surfaceTogglesPath(root, workspace), 'utf8')).rejects.toThrow()
  })

  it('keeps the committed state when the refresh fails, and recovers on the next write', async () => {
    const root = await newDataRoot()
    const workspace = '/ws/refresh-failure'
    let refreshCalls = 0
    const owner = await ownerAt(root, workspace, () => {
      refreshCalls += 1
      if (refreshCalls === 1) throw new Error('refresh failed')
    })

    // The rejection reports the refresh; the commit it followed stands.
    await expect(owner.setEntry('mcp', 'mcp:alpha__db', false)).rejects.toThrow('refresh failed')
    expect(owner.allowsEntry('mcp', 'mcp:alpha__db')).toBe(false)
    expect((await persisted(root, workspace)).entries?.mcp).toEqual(['mcp:alpha__db'])

    // The queue is not wedged: the next write commits and refreshes.
    await owner.setEntry('lsp', 'lsp:direct/json', false)
    expect(refreshCalls).toBe(2)
    const document = await persisted(root, workspace)
    expect(document.entries?.mcp).toEqual(['mcp:alpha__db'])
    expect(document.entries?.lsp).toEqual(['lsp:direct/json'])
  })
})
