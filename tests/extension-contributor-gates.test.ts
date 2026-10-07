import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SkillProvider } from '@deepseek-ai/dsh-skill'
import type { Catalog } from '../packages/market-bundle/src/application/catalog.js'
import { effectiveSurfaces, type Suite } from '../packages/market-contracts/src/model/types.js'
import { EntryFilteredSkillProvider, SuiteSkillProvider } from '../packages/market-runtime/src/runtime/surfaces/skills-provider.js'
import { CommandMountRegistry } from '../packages/market-runtime/src/runtime/surfaces/commands-mounts.js'
import { UserCommandMountRegistry } from '../packages/market-runtime/src/runtime/panels/user-commands.js'
import { createUserPanelStores } from '../packages/market-runtime/src/runtime/panels/user-panels.js'
import { bindHostLocale } from '../packages/market-runtime/src/runtime/host/host-locale.js'
import type { ShellSeam } from '../packages/market-runtime/src/runtime/surfaces/dynamic-context.js'
import { required } from './helpers/fixture.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'extension-contributor-gates-'))
  roots.push(path)
  return path
}

async function suite(id: string, dimension: Suite['dimension'] = 'user'): Promise<Suite> {
  const directory = await root()
  const file = join(directory, 'SKILL.md')
  await writeFile(file, '---\nname: shared\ndescription: Shared skill\n---\n!`sentinel`')
  return {
    sourceId: 'source',
    id,
    root: directory,
    manifest: { layout: 'agent-plugin-v1', path: join(directory, 'plugin.json'), id, name: id },
    skills: [{ name: 'shared', directory, file, description: 'Shared skill', invocation: { modelInvocable: true, userInvocable: true } }],
    resources: { commands: [{ name: 'git/commit', file: join(directory, 'command.md'), content: '---\ndescription: Commit\n---\n!`sentinel` $ARGUMENTS' }], agents: [] },
    surfaces: { skills: 1, commands: 1, mcp: 0, lsp: 0, agents: 0, hooks: 0 },
    dimension,
    enabled: true,
    activeSurfaces: effectiveSurfaces(undefined),
    errors: []
  }
}

function catalog(user: Suite[], project: Suite[] = []): Catalog {
  return { enabledUserSuites: async () => user, readProjectCatalog: async () => ({ enabledSuites: project }) } as unknown as Catalog
}

function shellSentinel() {
  return {
    resolve: vi.fn((request: unknown) => request),
    run: vi.fn(async () => ({
      exitCode: 0,
      timedOut: false,
      aborted: false,
      stdout: { text: 'expanded', truncated: false },
      stderr: { text: '', truncated: false }
    }))
  } satisfies ShellSeam
}

interface Registration {
  name: string
  handler(invocation: { agent: unknown; rawInput: string }): unknown
}

function commandHost(shell?: ShellSeam) {
  const registered = new Map<string, Registration>()
  const ctx = {
    get: () => shell,
    commands: {
      register: (definition: Registration) => {
        if (registered.has(definition.name)) throw new Error(`command "${definition.name}" is already registered`)
        registered.set(definition.name, definition)
        return () => {
          registered.delete(definition.name)
        }
      }
    }
  } as unknown as Context
  return { ctx, registered }
}

describe('suite skill contribution policies', () => {
  it('applies suiteAllowed to project suites before name deduplication', async () => {
    const user = await suite('user')
    const project = await suite('project', 'project')
    const provider = new SuiteSkillProvider(catalog([user], [project]), { suiteAllowed: candidate => candidate.dimension !== 'project' })
    expect((await provider.list({ cwd: project.root })).map(candidate => candidate.path)).toEqual([user.skills[0]?.file])
  })

  it('falls back to an allowed same-name entry within a dimension', async () => {
    const first = await suite('alpha')
    const second = await suite('beta')
    const provider = new SuiteSkillProvider(catalog([first, second]), { entryAllowed: owner => owner.id === 'beta' })
    expect((await provider.list({})).map(candidate => candidate.path)).toEqual([second.skills[0]?.file])
  })

  it('falls back to a user skill when the project entry is denied', async () => {
    const user = await suite('user')
    const project = await suite('project', 'project')
    const provider = new SuiteSkillProvider(catalog([user], [project]), { entryAllowed: owner => owner.dimension === 'user' })
    expect((await provider.list({ cwd: project.root })).map(candidate => candidate.path)).toEqual([user.skills[0]?.file])
  })

  it.each(['suite', 'entry'] as const)('denies a stale candidate before reading its file or invoking shell via the %s policy', async kind => {
    const owner = await suite('alpha')
    let allowed = true
    const shell = shellSentinel()
    const provider = new SuiteSkillProvider(catalog([owner]), {
      shell: () => shell,
      ...(kind === 'suite' ? { suiteAllowed: () => allowed } : { entryAllowed: () => allowed })
    })
    const candidate = required((await provider.list({}))[0], 'one skill candidate')
    const fileRead = vi.fn(() => {
      throw new Error('denied candidate must not read its file')
    })
    Object.defineProperty(candidate.locator, 'content', { get: fileRead })
    allowed = false
    await expect(provider.get(candidate, {})).resolves.toBeUndefined()
    expect(fileRead).not.toHaveBeenCalled()
    expect(shell.resolve).not.toHaveBeenCalled()
    expect(shell.run).not.toHaveBeenCalled()
  })

  it('uses the owning suite and skill rather than a duplicate public name at get time', async () => {
    const first = await suite('alpha')
    const second = await suite('beta')
    let selected = 'alpha'
    const shell = shellSentinel()
    const policy = vi.fn((owner: Suite, skill: Suite['skills'][number]) => owner.id === selected && skill.file === owner.skills[0]?.file)
    const provider = new SuiteSkillProvider(catalog([first, second]), { entryAllowed: policy, shell: () => shell })
    const stale = required((await provider.list({}))[0], 'first selected candidate')
    selected = 'beta'
    const current = required((await provider.list({}))[0], 'fallback candidate')
    expect(await provider.get(stale, {})).toBeUndefined()
    expect(shell.run).not.toHaveBeenCalled()
    expect((await provider.get(current, {}))?.content).toBe('expanded')
    expect(policy).toHaveBeenCalledWith(second, second.skills[0])
  })

  it('rechecks policy after asynchronous file loading and before dynamic context', async () => {
    const owner = await suite('alpha')
    let allowed = true
    const shell = shellSentinel()
    const provider = new SuiteSkillProvider(catalog([owner]), { entryAllowed: () => allowed, shell: () => shell })
    const candidate = required((await provider.list({}))[0], 'one candidate')
    Object.defineProperty(candidate.locator, 'content', {
      get: () => {
        allowed = false
        return undefined
      }
    })
    expect(await provider.get(candidate, {})).toBeUndefined()
    expect(shell.run).not.toHaveBeenCalled()
  })

  it('fails closed on candidates without ownership when a policy is active', async () => {
    const owner = await suite('alpha')
    const candidate = required((await new SuiteSkillProvider(catalog([owner])).list({}))[0], 'ownerless candidate')
    const shell = shellSentinel()
    const provider = new SuiteSkillProvider(catalog([owner]), { entryAllowed: () => true, shell: () => shell })
    expect(await provider.get(candidate, {})).toBeUndefined()
    expect(shell.run).not.toHaveBeenCalled()
  })

  it('preserves direct candidate loading without any policy', async () => {
    const owner = await suite('alpha')
    const shell = shellSentinel()
    const provider = new SuiteSkillProvider(catalog([owner]), { shell: () => shell })
    const candidate = required((await provider.list({}))[0], 'one candidate')
    expect((await provider.get(candidate, {}))?.content).toBe('expanded')
    expect(shell.run).toHaveBeenCalledOnce()
  })
})

describe('entry-filtered skill loading', () => {
  it('denies stale explicit gets by skills:candidate.name before delegating', async () => {
    const owner = await suite('alpha')
    const inner = new SuiteSkillProvider(catalog([owner]))
    const candidate = required((await inner.list({}))[0], 'one candidate')
    const get = vi.spyOn(inner, 'get')
    let allowed = true
    const policy = vi.fn((id: string) => allowed && id === 'skills:shared')
    const provider = new EntryFilteredSkillProvider(inner, policy)
    expect(await provider.get(candidate, {})).toBeDefined()
    get.mockClear()
    allowed = false
    expect(await provider.get(candidate, {})).toBeUndefined()
    expect(get).not.toHaveBeenCalled()
    expect(policy).toHaveBeenLastCalledWith('skills:shared')
  })

  it('preserves observation completeness when filtering listed candidates', async () => {
    const owner = await suite('alpha')
    const candidates = await new SuiteSkillProvider(catalog([owner])).list({})
    const inner: SkillProvider = { name: 'test', list: async () => ({ candidates, complete: true }), get: async () => undefined }
    const provider = new EntryFilteredSkillProvider(inner, () => false)
    expect(await provider.list({})).toEqual({ candidates: [], complete: true })
  })
})

describe('command contribution policies', () => {
  it('filters suite commands by authored identity and reconciles away denied registrations', async () => {
    const owner = await suite('alpha')
    const { ctx, registered } = commandHost()
    const registry = new CommandMountRegistry(ctx)
    let allowed = false
    const policy = vi.fn((candidate: Suite, name: string) => allowed && candidate === owner && name === 'git/commit')
    registry.setSelectionPolicy(policy)
    await registry.reconcile([owner])
    expect(registered.size).toBe(0)
    allowed = true
    await registry.reconcile([owner])
    expect([...registered.keys()]).toEqual(['git-commit'])
    const rows = registry.registrations()
    await registry.reconcile([owner])
    expect(registry.registrations()).toEqual(rows)
    allowed = false
    await registry.reconcile([owner])
    expect(registered.size).toBe(0)
    expect(registry.registrations()).toEqual([])
    expect(policy).toHaveBeenCalledWith(owner, 'git/commit')
  })

  it('keeps an allowed colliding command allocation when its sibling is denied', async () => {
    const owner = await suite('alpha')
    const commands = required(owner.resources, 'suite command resources').commands
    commands.unshift({ name: 'git-commit', file: join(owner.root, 'flat.md'), content: '---\ndescription: Flat\n---\nFlat' })
    const { ctx, registered } = commandHost()
    const registry = new CommandMountRegistry(ctx)
    await registry.reconcile([owner])
    expect([...registered.keys()]).toEqual(['git-commit', 'git-commit-1'])
    const nested = required(registered.get('git-commit-1'), 'nested command allocation')
    const rows = registry.registrations().filter(row => row.name === 'git-commit-1')
    registry.setSelectionPolicy((_owner, name) => name === 'git/commit')
    await registry.reconcile([owner])
    expect([...registered.keys()]).toEqual(['git-commit-1'])
    expect(registered.get('git-commit-1')).toBe(nested)
    expect(registry.registrations()).toEqual(rows)
    registry.disposeAll()
  })

  it('blocks a stale renamed suite handler before sentinel shell execution', async () => {
    const first = await suite('alpha')
    const second = await suite('beta')
    const shell = shellSentinel()
    const { ctx, registered } = commandHost(shell)
    const registry = new CommandMountRegistry(ctx)
    await registry.reconcile([first, second])
    const renamed = required(registered.get('git-commit-1'), 'renamed second command')
    const policy = vi.fn((owner: Suite, name: string) => owner.id === 'alpha' && name === 'git/commit')
    registry.setSelectionPolicy(policy)
    const followup = vi.fn()
    expect(await renamed.handler({ agent: { followup }, rawInput: '' })).toMatchObject({ kind: 'error' })
    expect(shell.resolve).not.toHaveBeenCalled()
    expect(shell.run).not.toHaveBeenCalled()
    expect(followup).not.toHaveBeenCalled()
    expect(policy).toHaveBeenCalledWith(second, 'git/commit')
    registry.disposeAll()
  })

  it('rechecks suite policy before forwarding a dynamically expanded result', async () => {
    const owner = await suite('alpha')
    let allowed = true
    const shell = shellSentinel()
    shell.run.mockImplementation(async () => {
      allowed = false
      return { exitCode: 0, timedOut: false, aborted: false, stdout: { text: 'expanded', truncated: false }, stderr: { text: '', truncated: false } }
    })
    const { ctx, registered } = commandHost(shell)
    const registry = new CommandMountRegistry(ctx)
    registry.setSelectionPolicy(() => allowed)
    await registry.reconcile([owner])
    const followup = vi.fn()
    const command = required(registered.get('git-commit'), 'suite command')
    expect(await command.handler({ agent: { followup }, rawInput: '' })).toMatchObject({ kind: 'error' })
    expect(shell.run).toHaveBeenCalledOnce()
    expect(followup).not.toHaveBeenCalled()
    registry.disposeAll()
  })

  it('filters user command paths and blocks stale execution without using allocated names', async () => {
    const directory = await root()
    await mkdir(join(directory, 'agents'))
    const store = createUserPanelStores(join(directory, 'agents')).commands
    await store.create('git-commit', '---\ndescription: Flat\n---\nFlat')
    await store.create('git/commit', '---\ndescription: Nested\n---\nNested')
    const { ctx, registered } = commandHost()
    const registry = new UserCommandMountRegistry(ctx, store, bindHostLocale('en'))
    await registry.reconcile()
    const stale = required(registered.get('git-commit-1'), 'renamed user command')
    const policy = vi.fn((name: string) => name === 'git-commit')
    registry.setSelectionPolicy(policy)
    const followup = vi.fn()
    expect(await stale.handler({ agent: { followup }, rawInput: '' })).toEqual({ kind: 'error', text: '/git-commit-1 is not enabled in this session' })
    expect(followup).not.toHaveBeenCalled()
    expect(policy).toHaveBeenCalledWith('git/commit')
    await registry.reconcile()
    expect([...registered.keys()]).toEqual(['git-commit'])
    expect(registry.registrations()).toEqual([{ name: 'git-commit', id: 'git-commit' }])
    registry.disposeAll()
  })
})
