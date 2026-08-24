import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveProjectRoot } from '../src/catalog/paths.js'

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
})

describe('live-like native discovery through a real project tree', () => {
  it('finds .claude skills from a deeply nested session cwd via the provider', async () => {
    const { Catalog } = await import('../src/application/catalog.js')
    const { SuiteSkillProvider } = await import('../src/runtime/skills-provider.js')
    const repo = await mkdtemp(join(tmpdir(), 'dsh-live-'))
    await mkdir(join(repo, '.git'), { recursive: true })
    await mkdir(join(repo, '.claude', 'skills', 'deploy'), { recursive: true })
    await mkdir(join(repo, '.claude', 'agents'), { recursive: true })
    await writeFile(join(repo, '.claude', 'skills', 'deploy', 'SKILL.md'), `---\nname: deploy\ndescription: Deploy the app.\n---\n\nDeploy.\n`, 'utf8')
    await writeFile(join(repo, '.claude', 'agents', 'reviewer.md'), `---\nname: reviewer\ndescription: Code reviewer agent.\n---\n\nReview code.\n`, 'utf8')
    const userRoot = await mkdtemp(join(tmpdir(), 'dsh-live-user-'))
    const manager = new Catalog({ userRoot, dataRoot: join(userRoot, 'data'), onChanged: () => {} })
    await manager.load()
    const provider = new SuiteSkillProvider(manager)
    const candidates = await provider.list({ cwd: join(repo, 'packages', 'app') })
    const names = candidates.map(c => c.name).sort()
    expect(names).toContain('deploy')
    expect(names.find(n => n.startsWith('agent-'))).toBe('agent-reviewer')
    expect(candidates.every(c => c.rank === 250)).toBe(true)
  })
})
