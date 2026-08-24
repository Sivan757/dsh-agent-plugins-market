import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { discoverSourceList } from '../src/catalog/source-catalog.js'
import { Catalog } from '../src/application/catalog.js'
import { SuiteSkillProvider, SUITE_PROJECT_SOURCE } from '../src/runtime/skills-provider.js'

/** Body for a `greet` skill with one description. */
const skillMd = (description: string): string => `---
name: greet
description: ${description}
---

Greet the user.
`

/** Body for a `second` skill (used to mutate a project mid-test). */
const secondSkillMd = `---
name: second
description: A second skill.
---

Second body.
`

/** Create a project root with a Claude Code native layout carrying one skill. */
async function createNativeProject(projectRoot: string, description = 'Native project greet skill.'): Promise<void> {
  await mkdir(join(projectRoot, '.git'), { recursive: true })
  await mkdir(join(projectRoot, '.claude', 'skills', 'greet'), { recursive: true })
  await writeFile(join(projectRoot, '.claude', 'skills', 'greet', 'SKILL.md'), skillMd(description), 'utf8')
}

/** Create a user dimension with one enabled suite shipping a skill of the same name. */
async function createUserDimensionWithGreet(userRoot: string): Promise<void> {
  const suiteRoot = join(userRoot, '.sources', 'demo', 'greet-suite')
  await mkdir(join(suiteRoot, 'skills', 'greet'), { recursive: true })
  await writeFile(
    join(suiteRoot, 'skills', 'greet', 'SKILL.md'),
    `---
name: greet
description: Suite greet skill.
---

Greet from the suite.
`,
    'utf8'
  )
  await writeFile(join(suiteRoot, 'plugin.json'), JSON.stringify({ name: 'greet-suite', version: '1.0.0', description: 'Suite shipping greet.' }), 'utf8')
  await writeFile(
    join(userRoot, 'state.json'),
    JSON.stringify({
      version: 1,
      sources: [{ id: 'demo', url: 'https://example.test/demo.git' }],
      installed: { 'demo/greet-suite': { enabled: true, installedAt: new Date(0).toISOString() } }
    }),
    'utf8'
  )
}

describe('native project-layout discovery', () => {
  it('discovers .claude/skills as a project-native suite read in place', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-native-proj-'))
    await createNativeProject(projectRoot)
    const dimensionRoot = join(projectRoot, '.dsh', 'agent-plugins')

    const suites = await discoverSourceList([], 'project', dimensionRoot)
    expect(suites).toHaveLength(1)
    const suite = suites[0]!
    expect(suite.manifest.layout).toBe('project-native')
    expect(suite.dimension).toBe('project')
    expect(suite.enabled).toBe(true)
    expect(suite.root).toBe(join(projectRoot, '.claude'))
    expect(suite.skills.map(skill => skill.name)).toEqual(['greet'])
    expect(suite.skills[0]!.file).toBe(join(projectRoot, '.claude', 'skills', 'greet', 'SKILL.md'))
  })

  it('lists native project skills through the provider at project rank', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-native-list-'))
    await createNativeProject(projectRoot)
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-native-user-'))
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await manager.load()

    const provider = new SuiteSkillProvider(manager)
    const candidates = await provider.list({ cwd: projectRoot })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.name).toBe('greet')
    expect(candidates[0]!.source).toBe(SUITE_PROJECT_SOURCE)
    expect(candidates[0]!.rank).toBe(250)
  })

  it('a project skill shadows an enabled user suite skill of the same name', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-native-dup-'))
    await createNativeProject(projectRoot, 'Native project greet skill.')
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-native-dup-user-'))
    await createUserDimensionWithGreet(userRoot)
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await manager.load()

    const provider = new SuiteSkillProvider(manager)
    const candidates = await provider.list({ cwd: projectRoot })
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.description).toBe('[Claude Code project files] Native project greet skill.')
    expect(candidates[0]!.source).toBe(SUITE_PROJECT_SOURCE)
    expect(candidates[0]!.rank).toBe(250)
  })

  it('projects without native directories discover nothing extra', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-native-empty-'))
    await mkdir(join(projectRoot, '.git'), { recursive: true })
    const dimensionRoot = join(projectRoot, '.dsh', 'agent-plugins')

    const suites = await discoverSourceList([], 'project', dimensionRoot)
    expect(suites).toEqual([])
  })

  it('an empty .claude directory with no content subdirectories is skipped', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-native-bare-'))
    await mkdir(join(projectRoot, '.git'), { recursive: true })
    await mkdir(join(projectRoot, '.claude', 'settings'), { recursive: true })
    const dimensionRoot = join(projectRoot, '.dsh', 'agent-plugins')

    const suites = await discoverSourceList([], 'project', dimensionRoot)
    expect(suites).toEqual([])
  })
})

describe('project snapshot caching', () => {
  it('serves repeated reads from the cache and re-scans after the TTL', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-native-cache-'))
    await createNativeProject(projectRoot)
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-native-cache-user-'))
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {}, projectSnapshotTtlMs: 60_000 })
    await manager.load()

    const first = await manager.readProjectCatalog(projectRoot)
    expect(first.suites).toHaveLength(1)

    // Mutate the project's native skill set; the cached snapshot must not see it.
    await mkdir(join(projectRoot, '.claude', 'skills', 'second'), { recursive: true })
    await writeFile(join(projectRoot, '.claude', 'skills', 'second', 'SKILL.md'), secondSkillMd, 'utf8')
    const cached = await manager.readProjectCatalog(projectRoot)
    expect(cached).toBe(first)

    // After expiry, discovery sees the new skill.
    await new Promise(resolve => setTimeout(resolve, 5))
    const managerShortTtl = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {}, projectSnapshotTtlMs: 1 })
    await managerShortTtl.load()
    const fresh = await managerShortTtl.readProjectCatalog(projectRoot)
    expect(fresh.suites[0]!.skills.map(skill => skill.name).sort()).toEqual(['greet', 'second'])
  })

  it('mutations invalidate cached project snapshots immediately', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-native-inval-'))
    await createNativeProject(projectRoot)
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-native-inval-user-'))
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {}, projectSnapshotTtlMs: 60_000 })
    await manager.load()

    const first = await manager.readProjectCatalog(projectRoot)
    await mkdir(join(userRoot, '.sources', 'demo', 'greet-suite'), { recursive: true })
    await manager.mergeSources([{ id: 'demo', url: 'https://example.test/demo.git' }])
    const after = await manager.readProjectCatalog(projectRoot)
    expect(after).not.toBe(first)
  })

  it('caching disabled with ttl 0 re-scans on every read', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'dsh-native-nocache-'))
    await createNativeProject(projectRoot)
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-native-nocache-user-'))
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {}, projectSnapshotTtlMs: 0 })
    await manager.load()

    const first = await manager.readProjectCatalog(projectRoot)
    await mkdir(join(projectRoot, '.claude', 'skills', 'second'), { recursive: true })
    await writeFile(join(projectRoot, '.claude', 'skills', 'second', 'SKILL.md'), secondSkillMd, 'utf8')
    const second = await manager.readProjectCatalog(projectRoot)
    expect(second).not.toBe(first)
    expect(second.suites[0]!.skills.map(skill => skill.name).sort()).toEqual(['greet', 'second'])
  })
})
