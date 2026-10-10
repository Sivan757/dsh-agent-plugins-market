import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Catalog } from '../packages/market-bundle/src/application/catalog.js'
import { readExtensionSuiteDeclarations } from '../packages/market-runtime/src/application/extension-suite-declarations.js'
import { projectExtensionSuites } from '../packages/market-runtime/src/application/extension-suite-selection.js'
import { projectAgentRoles } from '../packages/market-runtime/src/application/project-agent-roles.js'
import type { AgentRoleEntry } from '../packages/market-runtime/src/application/agent-roles.js'
import { captureExtensionSelection } from '../packages/market-contracts/src/contracts/extension-presets.js'
import { scanSource } from '../packages/market-catalog/src/scanning/suite-scanner.js'
import { SuiteSkillProvider } from '../packages/market-runtime/src/runtime/surfaces/skills-provider.js'
import { CommandMountRegistry } from '../packages/market-runtime/src/runtime/surfaces/commands-mounts.js'
import { UserCommandMountRegistry } from '../packages/market-runtime/src/runtime/panels/user-commands.js'
import { createUserPanelStores } from '../packages/market-runtime/src/runtime/panels/user-panels.js'
import { bindHostLocale } from '../packages/market-runtime/src/runtime/host/host-locale.js'
import { agentRoleCatalog, executeAgentRole, resolveRolePolicy, type AgentRoleHost } from '../packages/market-runtime/src/runtime/agents/agent-role-router.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function put(root: string, path: string, content: string) {
  const file = join(root, path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content)
  return file
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'disabled-consumers-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  await put(root, '.claude-plugin/plugin.json', JSON.stringify({ name: 'demo' }))
  const skillFile = await put(
    root,
    'skills/off/SKILL.md',
    '---\nname: off\ndescription: Off skill\ndisabled: true\ndisable-model-invocation: true\nuser-invocable: false\n---\nSkill body'
  )
  const commandFile = await put(root, 'commands/off.md', '---\ndescription: Off command\ndisabled: true\n---\nCommand $ARGUMENTS')
  const roleFile = await put(root, 'agents/off.md', '---\nname: off\ndescription: Off role\ndisabled: true\nprovider: mock\nmodel: child\n---\nRole body')
  const [scanned] = (await scanSource(root, 'source', 'project')).suites
  if (!scanned) throw new Error('missing fixture')
  const suite = withDefaultSurfaces(scanned)
  const all = captureExtensionSelection(null, ['market:source/demo', ...['skills', 'commands', 'agents'].map(kind => kind + ':' + JSON.stringify(['source', 'demo', kind, 'off']))])
  const projected = async () => projectExtensionSuites(await readExtensionSuiteDeclarations([suite]), all).map(row => row.suite)
  const enabledUserSuites = vi.fn(async () => [])
  const readProjectCatalog = vi.fn(async () => ({ suites: [suite], enabledSuites: [suite] }))
  const catalog = { enabledUserSuites, readProjectCatalog, dataRoot: root } as unknown as Catalog
  return { root, suite, projected, catalog, enabledUserSuites, readProjectCatalog, skillFile, commandFile, roleFile }
}
interface Definition {
  name: string
  handler(input: { agent: unknown; rawInput: string }): unknown
}
function hostCommands() {
  const definitions = new Map<string, Definition>()
  const messages: unknown[] = []
  const ctx = {
    get: () => undefined,
    commands: {
      register: (definition: Definition) => {
        definitions.set(definition.name, definition)
        return () => {
          definitions.delete(definition.name)
        }
      }
    }
  } as unknown as Context
  const invoke = (name: string) => definitions.get(name)!.handler({ agent: { followup: (message: unknown) => messages.push(message) }, rawInput: 'now' })
  return { ctx, definitions, messages, invoke }
}

describe('explicit session overrides for ordinary disabled consumers', () => {
  it('loads a selected disabled skill, retains one-sided invocation, and rejects stale or invalid bodies', async () => {
    const { catalog, projected, skillFile, enabledUserSuites, readProjectCatalog } = await fixture()
    let selected = true
    const options = { suites: projected, overrideDisabled: () => selected, suiteAllowed: () => selected, entryAllowed: () => selected }
    const provider = new SuiteSkillProvider(catalog, options)
    const [candidate] = await provider.list({})
    expect(candidate?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    expect((await provider.get(candidate!, {}))?.content).toBe('Skill body')
    expect(enabledUserSuites).not.toHaveBeenCalled()
    expect(readProjectCatalog).not.toHaveBeenCalled()
    const noOverride = new SuiteSkillProvider(catalog, { suites: projected, suiteAllowed: () => true, entryAllowed: () => true })
    expect(await noOverride.list({})).toEqual([])
    selected = false
    expect(await provider.get(candidate!, {})).toBeUndefined()
    expect(await provider.list({})).toEqual([])
    selected = true
    await writeFile(skillFile, '---\nname: off\ndescription: User only\ndisabled: true\ndisable-model-invocation: true\n---\nFresh body')
    expect((await provider.get(candidate!, {}))?.invocation).toEqual({ modelInvocable: false, userInvocable: true })
    await writeFile(skillFile, '---\nname: off\n---\nInvalid body')
    expect(await provider.get(candidate!, {})).toBeUndefined()
    expect(await provider.list({})).toEqual([])
  })

  it('mounts a selected disabled suite command only in the opt-in path and revalidates before effects', async () => {
    const { projected, commandFile } = await fixture()
    const host = hostCommands()
    const registry = new CommandMountRegistry(host.ctx)
    cleanups.push(() => registry.disposeAll())
    let selected = true
    registry.setSelectionPolicy(
      () => selected,
      () => selected,
      { allowDisabled: true }
    )
    const suites = await projected()
    await registry.reconcile(suites)
    expect(host.definitions.has('off')).toBe(true)
    expect(await host.invoke('off')).toMatchObject({ kind: 'success' })
    expect(host.messages).toHaveLength(1)
    selected = false
    expect(await host.invoke('off')).toMatchObject({ kind: 'error' })
    expect(host.messages).toHaveLength(1)
    selected = true
    await writeFile(commandFile, '---\ndescription: [\n---\nInvalid replacement')
    expect(await host.invoke('off')).toMatchObject({ kind: 'error' })
    expect(host.messages).toHaveLength(1)
    const global = hostCommands()
    const globalRegistry = new CommandMountRegistry(global.ctx)
    await globalRegistry.reconcile(suites)
    expect(global.definitions.size).toBe(0)
  })

  it('handles disabled native commands without changing files and denies revoked or malformed entries', async () => {
    const { root } = await fixture()
    const store = createUserPanelStores(join(root, 'native')).commands
    const entry = await store.create('off', '---\ndescription: Native off\ndisabled: true\n---\nNative $ARGUMENTS')
    const before = await readFile(entry.path)
    const host = hostCommands()
    const registry = new UserCommandMountRegistry(host.ctx, store, bindHostLocale(undefined))
    cleanups.push(() => registry.disposeAll())
    let selected = true
    registry.setSelectionPolicy(
      () => selected,
      () => selected,
      { allowDisabled: true }
    )
    await registry.reconcile()
    expect(host.definitions.has('off')).toBe(true)
    expect(await host.invoke('off')).toMatchObject({ kind: 'success' })
    expect(await readFile(entry.path)).toEqual(before)
    selected = false
    expect(await host.invoke('off')).toMatchObject({ kind: 'error' })
    selected = true
    await writeFile(entry.path, '---\ndescription: [\n---\nBroken')
    expect(await host.invoke('off')).toMatchObject({ kind: 'error' })
    expect(host.messages).toHaveLength(1)
  })

  it('lists and resolves only explicitly selected disabled roles with strict current parsing', async () => {
    const { catalog, root, projected } = await fixture()
    const parent = { session: { header: { cwd: root } } }
    let selected = true
    const roles = () => projectAgentRoles(catalog, parent, { suites: projected, selected: () => selected })
    const entries = await roles()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ disabled: true, selectionEnabled: true })
    const summaries = await agentRoleCatalog(entries, new AbortController().signal, () => {}, root)
    expect(summaries).toHaveLength(1)
    expect((await resolveRolePolicy(roles, summaries[0]!.name, parent)).policy.disabled).toBe(true)
    selected = false
    expect(await roles()).toEqual([])
    await expect(resolveRolePolicy(roles, summaries[0]!.name, parent)).rejects.toThrow()
    await expect(resolveRolePolicy(async () => entries.map(({ selectionEnabled: _flag, ...entry }) => entry), summaries[0]!.name, parent)).rejects.toThrow('disabled')
  })

  it.each(['revoked', 'malformed'])('rejects a disabled role %s while the model route is pending', async mode => {
    const { roleFile, root } = await fixture()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const spawn = vi.fn(async () => ({ childId: 'child', messageId: 'message' }))
    const host: AgentRoleHost = {
      tools: { register: () => () => {} },
      llm: {
        resolveCallConfig: async () => {
          entered.resolve()
          await release.promise
          return {}
        }
      },
      subagents: {
        startContinuable: spawn,
        start: async () => {
          throw new Error('unexpected')
        }
      }
    }
    let selected = true
    const roles = async (): Promise<AgentRoleEntry[]> => [
      { name: 'off', path: roleFile, description: 'Off role', disabled: true, selectionEnabled: selected, rawText: await readFile(roleFile, 'utf8') }
    ]
    const running = executeAgentRole(host, roles, 'off', 'Do it', { session: { header: { cwd: root } } }, {}, 'continuable', new AbortController().signal)
    const rejected = expect(running).rejects.toThrow()
    await Promise.race([entered.promise, running])
    if (mode === 'revoked') selected = false
    else await writeFile(roleFile, '---\nmodel: [invalid]\n---\nMalformed')
    release.resolve()
    await rejected
    expect(spawn).not.toHaveBeenCalled()
  })
})
