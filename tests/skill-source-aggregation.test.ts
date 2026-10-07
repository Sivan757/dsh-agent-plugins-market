import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { scanSource } from '../packages/market-catalog/src/scanning/suite-scanner.js'
import { Catalog } from '../packages/market-bundle/src/application/catalog.js'
import { SuiteSkillProvider } from '../packages/market-runtime/src/runtime/surfaces/skills-provider.js'

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-source-'))
  roots.push(root)
  return root
}

async function put(root: string, path: string, content: string): Promise<void> {
  const file = join(root, path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content)
}

function skill(name: string): string {
  return `---
name: ${name}
description: Use ${name}
---
Read references/guide.md in \${CLAUDE_SKILL_DIR}.`
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('manifest-free skill source aggregation', () => {
  it.each(['user', 'project'] as const)('groups flat skills into one checkout-root suite in the %s dimension', async dimension => {
    const root = await fixture()
    await put(root, 'alpha/SKILL.md', skill('alpha'))
    await put(root, 'beta/SKILL.md', skill('beta'))
    await put(root, 'README.md', '# Source readme')
    await put(root, 'alpha/references/guide.md', skill('not-a-skill'))
    await put(root, 'alpha/nested/SKILL.md', skill('also-not-a-skill'))
    const result = await scanSource(root, 'example', dimension)
    expect(result.suites).toHaveLength(1)
    const suite = result.suites[0]!
    expect(suite).toMatchObject({ root, dimension, sourceId: 'example', manifest: { layout: 'skill-collection' }, surfaces: { skills: 2 } })
    expect(suite.id).toBe('@skills')
    expect(suite.skills.map(entry => entry.name).sort()).toEqual(['alpha', 'beta'])
    expect(suite.skills.find(entry => entry.name === 'alpha')).toMatchObject({ directory: join(root, 'alpha'), file: join(root, 'alpha/SKILL.md') })
    expect(suite.errors).toEqual([])
  })

  it('keeps root and bundled skills when aggregating nested collections', async () => {
    const root = await fixture()
    await put(root, 'group/alpha/SKILL.md', skill('alpha'))
    await put(root, 'group/alpha/skills/extra/SKILL.md', skill('extra'))
    await put(root, 'other/beta/SKILL.md', skill('beta'))
    const result = await scanSource(root, 'example', 'user')
    expect(result.suites).toHaveLength(1)
    expect(result.suites[0]?.skills.map(entry => entry.name).sort()).toEqual(['alpha', 'beta', 'extra'])
  })

  it('does not inherit an individual skill install when its name matches the checkout', async () => {
    const base = await fixture()
    const root = join(base, 'alpha')
    const userRoot = await fixture()
    await put(root, 'alpha/SKILL.md', skill('alpha'))
    await put(root, 'beta/SKILL.md', skill('beta'))
    await put(
      userRoot,
      'state.json',
      JSON.stringify({
        version: 1,
        sources: [{ id: 'example', url: root, local: true }],
        installed: { 'example/alpha': { enabled: true, installedAt: '2026-10-01T00:00:00.000Z' } }
      })
    )
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
    await catalog.load()
    expect((await catalog.overview()).suites).toMatchObject([{ installed: false, enabled: false }])
    expect(await catalog.enabledUserSuites()).toEqual([])
  })

  it('deduplicates skill names while retaining the first resource path', async () => {
    const root = await fixture()
    await put(root, 'alpha/SKILL.md', skill('same'))
    await put(root, 'beta/SKILL.md', skill('same'))
    const result = await scanSource(root, 'example', 'user')
    expect(result.suites).toHaveLength(1)
    expect(result.suites[0]?.skills).toMatchObject([{ name: 'same', directory: join(root, 'alpha') }])
    expect(result.suites[0]?.surfaces.skills).toBe(1)
  })

  it('retains roots that own non-skill surfaces and does not mount source-root effects', async () => {
    const root = await fixture()
    await put(root, 'alpha/SKILL.md', skill('alpha'))
    await put(root, 'beta/SKILL.md', skill('beta'))
    await put(root, 'alpha/commands/run.md', 'Run the command')
    await put(root, 'commands/unrelated.md', 'Not part of a skill')
    let result = await scanSource(root, 'example', 'user')
    expect(result.suites.map(suite => suite.id)).toEqual(['alpha', 'beta'])
    expect(result.suites[0]?.resources?.commands[0]?.file).toBe(join(root, 'alpha/commands/run.md'))
    await rm(join(root, 'alpha/commands/run.md'))
    result = await scanSource(root, 'example', 'user')
    expect(result.suites).toHaveLength(1)
    expect(result.suites[0]?.surfaces.commands).toBe(0)
  })

  it('keeps marketplace-declared skill entries separate', async () => {
    const root = await fixture()
    await put(
      root,
      '.claude-plugin/marketplace.json',
      JSON.stringify({
        name: 'example',
        plugins: [
          { name: 'alpha', source: './alpha' },
          { name: 'beta', source: './beta' }
        ]
      })
    )
    await put(root, 'alpha/SKILL.md', skill('alpha'))
    await put(root, 'beta/SKILL.md', skill('beta'))
    expect((await scanSource(root, 'example', 'user')).suites.map(suite => suite.id)).toEqual(['alpha', 'beta'])
  })

  it('keeps nested declared plugins separate and rejects malformed declarations', async () => {
    const root = await fixture()
    await put(root, 'alpha/.claude-plugin/plugin.json', JSON.stringify({ name: 'alpha-plugin' }))
    await put(root, 'alpha/SKILL.md', skill('alpha'))
    await put(root, 'beta/.claude-plugin/plugin.json', '{invalid')
    await put(root, 'beta/SKILL.md', skill('beta'))
    const result = await scanSource(root, 'example', 'user')
    expect(result.suites.map(suite => suite.id)).toEqual(['alpha-plugin'])
    expect(result.notes.join('\n')).toContain('rejected declared manifest')
  })

  it('drops invalid skills with diagnostics and emits no empty collection', async () => {
    const root = await fixture()
    await put(root, 'alpha/SKILL.md', skill('alpha'))
    await put(root, 'beta/SKILL.md', '# Missing frontmatter')
    const result = await scanSource(root, 'example', 'user')
    expect(result.suites).toHaveLength(1)
    expect(result.suites[0]?.root).toBe(root)
    expect(result.suites[0]?.skills.map(entry => entry.name)).toEqual(['alpha'])
    expect([...result.notes, ...(result.suites[0]?.errors ?? [])].join('\n')).toContain('missing YAML frontmatter')
    await put(root, 'alpha/SKILL.md', '# Also invalid')
    const invalid = await scanSource(root, 'example', 'user')
    expect(invalid.suites).toEqual([])
    expect(invalid.notes.join('\n')).toContain('missing YAML frontmatter')
  })

  it('exposes one installable card and reads each skill through suite detail', async () => {
    const root = await fixture()
    const userRoot = await fixture()
    await put(root, 'alpha/SKILL.md', skill('alpha'))
    await put(root, 'beta/SKILL.md', skill('beta'))
    const catalog = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
    await catalog.load()
    await catalog.mergeSources([{ id: 'example', url: root, local: true }])
    const overview = await catalog.overview()
    expect(overview.suites).toHaveLength(1)
    const card = overview.suites[0]!
    await catalog.install('example', card.suiteId)
    const detail = await catalog.suiteDetail('example', card.suiteId)
    expect(detail).toMatchObject({ installed: true, enabled: true })
    expect(detail.skills.map(entry => entry.name).sort()).toEqual(['alpha', 'beta'])
    expect((await catalog.suiteDocument('example', card.suiteId, 'skills', 'beta')).content).toContain('Use beta')
    const reloaded = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), agentsRoot: join(userRoot, 'agents'), onChanged: () => {} })
    await reloaded.load()
    expect((await reloaded.overview()).suites).toMatchObject([{ suiteId: '@skills', installed: true, enabled: true }])
    expect((await reloaded.enabledUserSuites())[0]?.skills).toHaveLength(2)
    const provider = new SuiteSkillProvider(reloaded)
    const candidate = (await provider.list({})).find(entry => entry.name === 'beta')!
    const definition = await provider.get(candidate, {})
    expect(definition?.resourceBase).toEqual({ kind: 'directory', path: join(root, 'beta') })
    expect(definition?.content).toContain(join(root, 'beta'))
  })
})
