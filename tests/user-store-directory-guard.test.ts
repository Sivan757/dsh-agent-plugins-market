// The panel reader must not decide "empty" from an operating system's error
// vocabulary: a path that exists but cannot be a directory can never be an
// empty panel, on any platform.
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** A listing that misreports one directory, as some platforms do for a file path. */
const misreport = vi.hoisted(() => ({ path: '' }))

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const readdir = actual.readdir as (path: string, options?: unknown) => Promise<unknown>
  return {
    ...actual,
    async readdir(path: string, options?: unknown) {
      if (misreport.path !== '' && path === misreport.path) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, scandir '${path}'`), { code: 'ENOENT' })
      }
      return readdir(path, options)
    }
  }
})

import { listEntryDocuments, listEntryFiles } from '../packages/market-runtime/src/application/panels/user-store.js'

const FRONTMATTER_REVIEW = ['---', 'description: Review', '---', 'Instructions'].join('\n')

const roots: string[] = []

afterEach(async () => {
  misreport.path = ''
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'user-store-guard-'))
  roots.push(root)
  return root
}

describe('panel directory reads', () => {
  it('treats a missing panel directory as an empty panel, not a failure', async () => {
    const root = await scratch()
    expect(await listEntryDocuments(join(root, 'agents'), true)).toEqual([])
  })

  it('rejects a strict read whose panel path exists as a file, whatever a listing would report', async () => {
    const root = await scratch()
    const panel = join(root, 'agents')
    await writeFile(panel, 'temporarily not a directory')
    await expect(listEntryFiles(panel, true)).rejects.toMatchObject({ code: 'ENOTDIR' })
    // The same shape reported as a missing path is still a broken panel.
    misreport.path = panel
    await expect(listEntryFiles(panel, true)).rejects.toMatchObject({ code: 'ENOTDIR' })
    // Non-strict reads keep the documented skip-what-cannot-be-read behavior.
    expect(await listEntryFiles(panel, false)).toEqual([])
  })

  it('does not accept a listing failure as absence while the directory still exists', async () => {
    const root = await scratch()
    const panel = join(root, 'agents')
    await mkdir(panel)
    await writeFile(join(panel, 'reviewer.md'), FRONTMATTER_REVIEW)
    expect(await listEntryDocuments(panel, true)).toHaveLength(1)
    // A platform that reports ENOENT for a readable directory must not silently
    // shrink the snapshot: only a structurally confirmed absence is tolerated.
    misreport.path = panel
    await expect(listEntryDocuments(panel, true)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await listEntryDocuments(panel, false)).toEqual([])
  })
})
