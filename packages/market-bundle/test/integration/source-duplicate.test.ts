import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { Catalog } from '../../../../packages/market-bundle/src/application/catalog.js'

const run = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const fixtures = join(here, 'fixtures')

/** One fresh catalog over a temp user root. */
async function emptyCatalog(prefix = 'dsh-agent-plugins-duplicate-'): Promise<Catalog> {
  const userRoot = await mkdtemp(join(tmpdir(), prefix))
  const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
  await catalog.load()
  return catalog
}

/** A real git repository the catalog can clone from a `file://` URL, offline. */
async function makeGitRepo(repoPath: string, name: string): Promise<string> {
  await mkdir(join(repoPath, 'skills', 'demo'), { recursive: true })
  await writeFile(join(repoPath, 'README.md'), '# fixture\n')
  await writeFile(join(repoPath, 'plugin.json'), JSON.stringify({ name, description: 'fixture suite' }))
  await writeFile(join(repoPath, 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: demo skill\n---\n')
  await run('git', ['-C', repoPath, 'init', '-b', 'main'])
  await run('git', ['-C', repoPath, 'add', '-A'])
  await run('git', ['-C', repoPath, '-c', 'user.email=fixture@test', '-c', 'user.name=fixture', 'commit', '--no-gpg-sign', '-m', 'init'])
  // A second branch at the same commit: the same repository, asked for twice
  // with two different acquisition settings.
  await run('git', ['-C', repoPath, 'branch', 'dev'])
  return `file://${repoPath}`
}

describe('source duplicates', () => {
  it('refuses a second registration of the same local directory', async () => {
    const catalog = await emptyCatalog()
    const url = join(fixtures, 'v1-suite')
    await catalog.addSource({ url, local: true })
    // Regression: a second add cloned nothing and still appended a row, so the
    // source strip listed one directory twice under two ids.
    await expect(catalog.addSource({ url, local: true })).rejects.toMatchObject({ code: 'source-duplicate' })
    const overview = await catalog.readUserCatalog()
    expect(overview.sources).toHaveLength(1)
    await rm(catalog.userRoot, { recursive: true, force: true })
  })

  it('refuses a second registration of the same git repository, in any URL dialect', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-duplicate-git-'))
    const url = await makeGitRepo(join(root, 'repos', 'owner', 'skills'), 'fixture-skills')
    const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), agentsRoot: join(root, 'agents'), onChanged: () => {} })
    await catalog.load()
    await catalog.addSource({ url })
    // The trailing slash and the `.git` suffix name the same repository, so the
    // canonical comparison catches them before a second clone is attempted.
    await expect(catalog.addSource({ url: url + '/' })).rejects.toMatchObject({ code: 'source-duplicate' })
    await expect(catalog.addSource({ url: url + '.git' })).rejects.toMatchObject({ code: 'source-duplicate' })
    expect((await catalog.readUserCatalog()).sources).toHaveLength(1)
    await rm(root, { recursive: true, force: true })
  })

  it('registers the same repository on another branch as its own source', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-duplicate-branch-'))
    const url = await makeGitRepo(join(root, 'repos', 'owner', 'skills'), 'fixture-skills')
    const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), agentsRoot: join(root, 'agents'), onChanged: () => {} })
    await catalog.load()
    const first = await catalog.addSource({ url })
    const second = await catalog.addSource({ url, branch: 'dev' })
    // One repository at two branches is two sources: the branch field exists for
    // exactly that, so the duplicate rule must not swallow it.
    expect(second.id).not.toBe(first.id)
    expect((await catalog.readUserCatalog()).sources).toHaveLength(2)
    await rm(root, { recursive: true, force: true })
  })

  it('refuses an update that points a source at an acquisition another row holds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-duplicate-update-'))
    const first = await makeGitRepo(join(root, 'repos', 'owner', 'first'), 'first')
    const second = await makeGitRepo(join(root, 'repos', 'owner', 'second'), 'second')
    const catalog = new Catalog({ userRoot: root, dataRoot: join(root, 'data'), agentsRoot: join(root, 'agents'), onChanged: () => {} })
    await catalog.load()
    const a = await catalog.addSource({ url: first })
    await catalog.addSource({ url: second })
    await expect(catalog.updateSource(a.id, { url: second })).rejects.toMatchObject({ code: 'source-duplicate' })
    const ids = (await catalog.readUserCatalog()).sources.map(source => source.url)
    expect(ids).toContain(first)
    expect(ids).toContain(second)
    await rm(root, { recursive: true, force: true })
  })
})
