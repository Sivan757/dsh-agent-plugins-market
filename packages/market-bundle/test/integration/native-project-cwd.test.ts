import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveProjectRoot } from '../../../../packages/market-catalog/src/scanning/paths.js'

describe('cwd resolution edges', () => {
  it('resolves a monorepo subdirectory cwd to the repo root dimension', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'dsh-monorepo-'))
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, '.claude', 'skills', 'greet'), { recursive: true })
    await writeFile(join(repo, '.claude', 'skills', 'greet', 'SKILL.md'), `---\nname: greet\ndescription: mono.\n---\n\nGreet.\n`, 'utf8')
    await mkdir(join(repo, 'packages', 'app', 'src'), { recursive: true })
    const deepCwd = join(repo, 'packages', 'app', 'src')
    expect(await resolveProjectRoot(deepCwd)).toBe(join(repo, '.dsh', 'agent-plugins'))
  })

  // A permission bit is the one probe failure a fixture can produce on purpose,
  // and it only exists where POSIX modes do: on Windows chmod toggles the
  // read-only attribute, and a root user ignores the bits entirely.
  const permissionBits = process.platform !== 'win32' && process.getuid?.() !== 0

  it.skipIf(!permissionBits)('refuses to place the project root above an ancestor it cannot read', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'dsh-unreadable-'))
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, '.dsh', 'agent-plugins'), { recursive: true })
    await mkdir(join(repo, 'mid', 'deep'), { recursive: true })
    await chmod(join(repo, 'mid'), 0o000)
    try {
      // A probe that swallowed the refusal would walk past `mid`, find the repo
      // marker, and hand this workspace that repository's project dimension:
      // every suite declared there would read as this session's own.
      await expect(resolveProjectRoot(join(repo, 'mid', 'deep'))).rejects.toMatchObject({ code: 'EACCES' })
    } finally {
      await chmod(join(repo, 'mid'), 0o755)
    }
    await rm(repo, { recursive: true, force: true })
  })

  it('reads a home cwd as no project rather than as a second view of the user dimension', async () => {
    const { Catalog } = await import('../../../../packages/market-bundle/src/application/catalog.js')
    // A session started in the harness home has no `.git` ancestor, so its cwd
    // resolves to itself as the project root and its dimension root lands on the
    // user dimension root. Reading that as a project would hand the session every
    // user-level suite as its own.
    const home = await mkdtemp(join(tmpdir(), 'dsh-home-'))
    const userRoot = join(home, '.dsh', 'agent-plugins')
    const source = join(home, 'source')
    await mkdir(join(source, 'skills', 'greet'), { recursive: true })
    await writeFile(join(source, 'plugin.json'), JSON.stringify({ name: 'home-suite' }))
    await writeFile(join(source, 'skills', 'greet', 'SKILL.md'), '---\nname: greet\ndescription: from home.\n---\n')
    await mkdir(userRoot, { recursive: true })
    await writeFile(
      join(userRoot, 'state.json'),
      JSON.stringify({
        version: 1,
        sources: [{ id: 'local', url: source, local: true }],
        installed: { 'local/home-suite': { enabled: true, installedAt: '2026-09-09T00:00:00Z' } }
      })
    )
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
    await catalog.load()
    expect((await catalog.readUserCatalog()).enabledSuites.map(suite => suite.id)).toEqual(['home-suite'])
    const project = await catalog.readProjectCatalog(home)
    expect(project.enabledSuites).toEqual([])
    expect(project.suites).toEqual([])
    expect(project.sources).toEqual([])
    await rm(home, { recursive: true, force: true })
  })
})

describe('live-like native discovery through a real project tree', () => {
  it('finds .claude skills from a deeply nested session cwd via the provider', async () => {
    const { Catalog } = await import('../../../../packages/market-bundle/src/application/catalog.js')
    const { SuiteSkillProvider } = await import('../../../../packages/market-runtime/src/runtime/surfaces/skills-provider.js')
    const repo = await mkdtemp(join(tmpdir(), 'dsh-live-'))
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, '.claude', 'skills', 'deploy'), { recursive: true })
    await mkdir(join(repo, '.claude', 'agents'), { recursive: true })
    await writeFile(join(repo, '.claude', 'skills', 'deploy', 'SKILL.md'), `---\nname: deploy\ndescription: Deploy the app.\n---\n\nDeploy.\n`, 'utf8')
    await writeFile(join(repo, '.claude', 'agents', 'reviewer.md'), `---\nname: reviewer\ndescription: Code reviewer agent.\n---\n\nReview code.\n`, 'utf8')
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-live-user-'))
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
    await manager.load()
    // Native project layouts are off by default; this test covers the on state.
    await manager.setScanProjectLayouts(true)
    const provider = new SuiteSkillProvider(manager)
    const candidates = await provider.list({ cwd: join(repo, 'packages', 'app') })
    const names = candidates.map(c => c.name).sort()
    expect(names).toEqual(['deploy'])
    expect(candidates.every(c => c.rank === 250)).toBe(true)
  })
})
