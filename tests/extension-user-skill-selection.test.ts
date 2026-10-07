import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SkillRegistry, { isModelInvocable, isUserInvocable } from '@deepseek-ai/dsh-skill'
import { SessionId } from '@deepseek-ai/dsh-session'
import { captureExtensionSelection } from '../packages/market-contracts/src/contracts/extension-presets.js'
import { ScopedExtensionContributors, type ScopedContributorPorts } from '../packages/market-runtime/src/runtime/host/scoped-contributors.js'
import { createUserPanelStores, UserPanelSkillProvider } from '../packages/market-runtime/src/runtime/panels/user-panels.js'
import { scanSource } from '../packages/market-catalog/src/scanning/suite-scanner.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'
import { createMcpMount } from '../packages/market-bundle/src/runtime-adapters.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})
class Commands extends Service {
  constructor(ctx: Context) {
    super(ctx, 'commands')
  }
  register(): () => void {
    return () => {}
  }
}
const text = (name: string, controls = '') => '---\nname: ' + name + '\ndescription: Native ' + name + '\n' + controls + '---\nNative body for ' + name
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'extension-user-skills-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const stores = createUserPanelStores(join(root, 'agents'))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(Commands)
  ctx.skills.registerProvider(() => new UserPanelSkillProvider(stores.skills))
  const grants = new Map<Agent, Set<string>>()
  // Catalog discovery is unrelated to native skill policy; the stores, registry,
  // agent scopes, and production contributor lifecycle are real.
  const catalog = {
    enabledUserSuites: async () => [],
    readProjectCatalog: async () => ({ suites: [], enabledSuites: [] }),
    allMcpOverrides: async () => new Map(),
    mcpBackend: async () => 'bridge'
  } as unknown as ScopedContributorPorts['catalog']
  const contributors = new ScopedExtensionContributors({
    mcpMounts: createMcpMount,
    dataRoot: root,
    catalog,
    panels: stores,
    shell: () => undefined,
    allows: (agent, id) => grants.get(agent)?.has(id) === true
  })
  cleanups.push(() => contributors.disposeAll())
  const a = await ctx.agentLoop.create(SessionId('a'), { provider: 'mock', model: 'test' }, { cwd: root })
  const b = await ctx.agentLoop.create(SessionId('b'), { provider: 'mock', model: 'test' }, { cwd: root })
  const select = async (agent: Agent, names: string[]) => {
    const ids = names.map(name => 'skills:' + name)
    grants.set(agent, new Set(ids))
    await contributors.reconcile(agent, captureExtensionSelection(null, ids))
    contributors.committed(agent)
  }
  const names = async (agent?: Agent) => (await ctx.skills.list({ scope: agent, cwd: root })).filter(isModelInvocable).map(skill => skill.name)
  return { root, stores, ctx, grants, contributors, a, b, select, names, catalog }
}

describe('native user skill session selection', () => {
  it('enables an ordinary globally disabled entry only in its selected session without changing files', async () => {
    const { stores, ctx, contributors, a, b, select, names, grants } = await setup()
    const disabled = await stores.skills.create('disabled', text('disabled', 'disable-model-invocation: true\nuser-invocable: false\n'))
    const global = await stores.skills.create('global', text('global'))
    const before = await Promise.all([disabled.path, global.path].map(path => readFile(path)))
    await stores.skills.create('broken', '---\nname: broken\n---\nNo description')
    await select(a, ['disabled', 'broken'])
    await select(b, [])
    expect(await names(a)).toEqual(['disabled'])
    expect(await names(b)).toEqual([])
    expect(await names()).toEqual(['global'])
    expect((await ctx.skills.get('disabled', { scope: a }))?.content).toBe('Native body for disabled')
    expect(await ctx.skills.get('disabled', { scope: b })).toBeUndefined()
    expect(await ctx.skills.get('broken', { scope: a })).toBeUndefined()
    expect(await ctx.skills.get('global', { scope: b })).toBeUndefined()
    const denied = (await ctx.skills.list({ scope: b })).find(skill => skill.name === 'global')!
    expect(denied.invocation).toEqual({ modelInvocable: false, userInvocable: false })

    grants.set(a, new Set())
    expect(await ctx.skills.get('disabled', { scope: a })).toBeUndefined()
    contributors.committed(a)
    expect(await names(a)).toEqual([])
    grants.set(a, new Set(['skills:global']))
    contributors.invalidateAll()
    expect(await names(a)).toEqual(['global'])
    grants.set(a, new Set(['skills:disabled']))
    await contributors.ready(a)
    expect(await names(a)).toEqual(['disabled'])
    expect(await names(b)).toEqual([])
    await contributors.dispose(a)
    expect(await names(a)).toEqual(['global'])
    expect(await names(b)).toEqual([])
    expect(await Promise.all([disabled.path, global.path].map(path => readFile(path)))).toEqual(before)
  })

  it('keeps a higher-priority project suite ahead of the native same-name shadow', async () => {
    const { root, stores, ctx, grants, contributors, a, catalog } = await setup()
    await stores.skills.create('greet', text('greet'))
    const [scanned] = (await scanSource(join(import.meta.dirname, 'fixtures', 'v1-suite'), 'demo', 'project')).suites
    if (!scanned) throw new Error('fixture suite not found')
    const suite = withDefaultSurfaces(scanned)
    suite.activeSurfaces = { skills: true, commands: false, hooks: false, mcp: false, agents: false, lsp: false }
    vi.spyOn(catalog, 'readProjectCatalog').mockResolvedValue({ suites: [suite], enabledSuites: [suite] } as Awaited<ReturnType<typeof catalog.readProjectCatalog>>)
    const ids = ['market:demo/v1-suite', 'skills:' + JSON.stringify(['demo', 'v1-suite', 'skills', 'greet'])]
    grants.set(a, new Set(ids))
    await contributors.reconcile(a, captureExtensionSelection(null, ids))
    const candidate = (await ctx.skills.list({ scope: a, cwd: root })).find(skill => skill.name === 'greet')!
    expect(candidate).toMatchObject({ provider: 'agent-plugin', source: 'agent-plugin-project' })
    expect(isModelInvocable(candidate)).toBe(true)
    expect((await ctx.skills.get('greet', { scope: a, cwd: root }))?.provider).toBe('agent-plugin')
  })

  it('preserves authored one-sided invocation limits and keeps no-policy behavior unchanged', async () => {
    const { stores } = await setup()
    await stores.skills.create('model-only', text('model-only', 'user-invocable: false\n'))
    await stores.skills.create('user-only', text('user-only', 'disable-model-invocation: true\n'))
    await stores.skills.create('disabled', text('disabled', 'disabled: true\n'))
    await stores.skills.create('off-user-only', text('off-user-only', 'disabled: true\ndisable-model-invocation: true\n'))
    const global = new UserPanelSkillProvider(stores.skills)
    expect((await global.list({})).map(skill => skill.name).sort()).toEqual(['model-only', 'user-only'])
    const scoped = new UserPanelSkillProvider(stores.skills, { enabled: () => true })
    const candidates = await scoped.list({})
    expect(
      candidates
        .filter(isModelInvocable)
        .map(skill => skill.name)
        .sort()
    ).toEqual(['disabled', 'model-only'])
    expect(
      candidates
        .filter(isUserInvocable)
        .map(skill => skill.name)
        .sort()
    ).toEqual(['disabled', 'off-user-only', 'user-only'])
    expect(
      (
        await scoped.get(
          candidates.find(skill => skill.name === 'off-user-only')!,
          {}
        )
      )?.invocation
    ).toEqual({ modelInvocable: false, userInvocable: true })
  })

  it('rejects malformed entries and rechecks candidate identity, changed files, and revoked policy', async () => {
    const { stores } = await setup()
    await stores.skills.create('broken', '---\nname: broken\n---\nNo description')
    await stores.skills.create('valid', text('valid'))
    const enabled = new Set(['broken', 'valid'])
    const provider = new UserPanelSkillProvider(stores.skills, { enabled: entry => enabled.has(entry.name) })
    const candidates = await provider.list({})
    expect(candidates.map(skill => skill.name)).toEqual(['valid'])
    const candidate = candidates[0]!
    expect(await provider.get({ ...candidate, locator: { name: 'broken' }, name: 'broken' }, {})).toBeUndefined()
    expect(await provider.get({ ...candidate, locator: { name: 'valid' }, provider: 'another-provider' }, {})).toBeUndefined()
    expect(await provider.get({ ...candidate, locator: null }, {})).toBeUndefined()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const get = stores.skills.get.bind(stores.skills)
    vi.spyOn(stores.skills, 'get').mockImplementationOnce(async name => {
      entered.resolve()
      await release.promise
      return get(name)
    })
    const loading = provider.get(candidate, {})
    await entered.promise
    enabled.delete('valid')
    release.resolve()
    expect(await loading).toBeUndefined()
    enabled.add('valid')
    await stores.skills.update('valid', '---\nname: valid\n---\nBroken after listing')
    expect(await provider.get(candidate, {})).toBeUndefined()
  })
})
