import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { Catalog } from '../src/application/catalog.js'
import { deriveSourceIdCandidates } from '../src/catalog/paths.js'

const run = promisify(execFile)

/** Create a real git repo (offline clone source), optionally naming itself via a marketplace manifest. */
async function makeGitRepo(repoPath: string, marketplaceName?: string): Promise<string> {
  await mkdir(join(repoPath, '.claude-plugin'), { recursive: true })
  if (marketplaceName !== undefined) {
    const manifest = {
      name: marketplaceName,
      owner: { name: 'Fixture' },
      plugins: [{ name: marketplaceName, source: './', description: 'fixture suite' }]
    }
    await writeFile(join(repoPath, '.claude-plugin', 'marketplace.json'), JSON.stringify(manifest))
  }
  await writeFile(join(repoPath, 'README.md'), '# fixture\n')
  await run('git', ['-C', repoPath, 'init'])
  await run('git', ['-C', repoPath, 'add', '-A'])
  await run('git', ['-C', repoPath, '-c', 'user.email=fixture@test', '-c', 'user.name=fixture', 'commit', '--no-gpg-sign', '-m', 'init'])
  return `file://${repoPath}`
}

describe('deriveSourceIdCandidates', () => {
  it('prefers the basename and offers owner-prefix for hosted URLs', () => {
    expect(deriveSourceIdCandidates('https://github.com/cloudflare/skills')).toEqual(['skills', 'cloudflare-skills'])
    expect(deriveSourceIdCandidates('https://github.com/mattpocock/skills.git')).toEqual(['skills', 'mattpocock-skills'])
    expect(deriveSourceIdCandidates('git@github.com:anthropics/claude-plugins-official.git')).toEqual(['claude-plugins-official', 'anthropics-claude-plugins-official'])
    expect(deriveSourceIdCandidates('https://example.test/demo.git')).toEqual(['demo', 'example-test-demo'])
  })

  it('yields only the basename for local paths', () => {
    expect(deriveSourceIdCandidates('/Users/me/workspace/agent-plugins')).toEqual(['agent-plugins'])
    expect(deriveSourceIdCandidates('~/repos/my-plugin/')).toEqual(['my-plugin'])
  })
})

describe('source id collision handling', () => {
  it('never clones over a stale occupied directory and falls back to readable ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-collision-'))
    // A leftover checkout occupying the basename directory, not owned by any registered source.
    await mkdir(join(root, '.sources', 'skills'), { recursive: true })
    await writeFile(join(root, '.sources', 'skills', 'junk.txt'), 'foreign data')
    const url = await makeGitRepo(join(root, 'repos', 'cloudflare', 'skills'), 'cloudflare')

    const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), onChanged: () => {} })
    await catalog.load()
    const source = await catalog.addSource({ url })

    // The occupied basename was skipped; the owner-prefixed candidate carried the clone,
    // then the manifest name took over once its directory proved free.
    expect(source.id).toBe('cloudflare')
    expect((await stat(join(root, '.sources', 'cloudflare'))).isDirectory()).toBe(true)
    expect(await readFile(join(root, '.sources', 'skills', 'junk.txt'), 'utf8')).toBe('foreign data')
    await expect(stat(join(root, '.sources', 'cloudflare-skills'))).rejects.toThrow()

    const overview = await catalog.readUserCatalog()
    expect(overview.sources.map(entry => entry.id)).toContain('cloudflare')
  })

  it('moves the checkout when the repo manifest names the source differently', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-rename-'))
    const url = await makeGitRepo(join(root, 'repos', 'owner', 'repo-name'), 'renamed-source')

    const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), onChanged: () => {} })
    await catalog.load()
    const source = await catalog.addSource({ url })

    expect(source.id).toBe('renamed-source')
    expect((await stat(join(root, '.sources', 'renamed-source'))).isDirectory()).toBe(true)
    await expect(stat(join(root, '.sources', 'repo-name'))).rejects.toThrow()

    // The registered id stays coherent with the filesystem across refreshes.
    await catalog.refreshSource('renamed-source')
  })

  it('keeps same-basename repositories from different owners distinct', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-samename-'))
    const aliceUrl = await makeGitRepo(join(root, 'repos', 'alice', 'skills'))
    const bobUrl = await makeGitRepo(join(root, 'repos', 'bob', 'skills'))

    const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), onChanged: () => {} })
    await catalog.load()
    const first = await catalog.addSource({ url: aliceUrl })
    const second = await catalog.addSource({ url: bobUrl })

    expect(first.id).toBe('skills')
    expect(second.id).toBe('bob-skills')
    expect((await stat(join(root, '.sources', 'skills'))).isDirectory()).toBe(true)
    expect((await stat(join(root, '.sources', 'bob-skills'))).isDirectory()).toBe(true)

    const overview = await catalog.readUserCatalog()
    expect(overview.sources.filter(entry => entry.id === 'skills')).toHaveLength(1)
    expect(basename(second.url)).toBe('skills')
  })
})
