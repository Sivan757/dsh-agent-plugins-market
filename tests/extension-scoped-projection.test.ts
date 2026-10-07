import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Catalog } from '../src/application/catalog.js'
import type { Suite } from '../src/model/types.js'
import { effectiveSurfaces } from '../src/model/types.js'
import type { McpSuiteOverrides } from '../src/application/mcp/mcp-overrides.js'
import { captureExtensionSelection } from '../src/contracts/extension-presets.js'
import { ScopedExtensionContributors } from '../src/runtime/host/scoped-contributors.js'
import type { UserPanelStore } from '../src/runtime/panels/user-panels.js'
import type { SuiteSkillProviderOptions } from '../src/runtime/surfaces/skills-provider.js'

const observed = vi.hoisted(() => ({ skills: [] as unknown[], commandPolicies: [] as unknown[][], commands: [] as unknown[], mcp: [] as unknown[], overrides: [] as unknown[] }))
vi.mock('../src/runtime/surfaces/skills-provider.js', () => ({
  SuiteSkillProvider: class {
    constructor(_catalog: unknown, options: unknown) {
      observed.skills.push(options)
    }
  }
}))
vi.mock('../src/runtime/panels/user-panels.js', () => ({ UserPanelSkillProvider: class {} }))
vi.mock('../src/runtime/surfaces/commands-mounts.js', () => ({
  CommandMountRegistry: class {
    setSelectionPolicy(...args: unknown[]) {
      observed.commandPolicies.push(args)
    }
    async reconcile(suites: unknown) {
      observed.commands.push(suites)
      return []
    }
    disposeAll() {}
  }
}))
vi.mock('../src/runtime/panels/user-commands.js', () => ({
  UserCommandMountRegistry: class {
    setSelectionPolicy(...args: unknown[]) {
      observed.commandPolicies.push(args)
    }
    async reconcile() {
      return []
    }
    disposeAll() {}
  }
}))
vi.mock('../src/runtime/surfaces/project-runtime.js', () => ({ suiteInstructions: async () => ({ text: '' }) }))
vi.mock('../src/runtime/surfaces/extension-hooks.js', () => ({
  ExtensionHooks: class {
    async reconcile() {
      return []
    }
    async dispose() {}
  }
}))
vi.mock('../src/runtime/mcp/mcp-mounts.js', () => ({
  McpMountRegistry: class {
    overrides?: () => Promise<unknown>
    setBackendProvider() {}
    setOverridesProvider(provider: () => Promise<unknown>) {
      this.overrides = provider
    }
    async reconcile(suites: unknown) {
      observed.mcp.push(suites)
      observed.overrides.push(await this.overrides?.())
      return []
    }
    async disposeAll() {}
  }
}))
afterEach(() => {
  for (const rows of Object.values(observed)) rows.length = 0
})
function suite(dimension: 'user' | 'project'): Suite {
  return {
    sourceId: 'source',
    id: dimension,
    dimension,
    root: '/unused',
    manifest: { layout: 'claude-code', id: dimension, name: dimension, path: '' },
    skills: [],
    enabled: false,
    errors: [],
    activeSurfaces: effectiveSurfaces(undefined),
    surfaces: { skills: 1, commands: 1, hooks: 0, agents: 0, mcp: 2, lsp: 0 },
    mcp: {
      schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      servers: { selected: { type: 'stdio', command: 'node' }, denied: { type: 'stdio', command: 'node' } }
    }
  }
}
function fixture() {
  const scope = {
    skills: {
      registerProvider(create: (control: { invalidate(): void; signal: AbortSignal }) => unknown) {
        create({ invalidate() {}, signal: new AbortController().signal })
        return () => {}
      }
    },
    systemPrompt: { section() {} },
    effect() {},
    logger: { warn() {} },
    inject(_deps: string[], apply: (scope: unknown) => void) {
      apply(scope)
      return { dispose: async () => {} }
    }
  }
  return { ctx: scope, session: { header: { cwd: '/workspace' } } } as unknown as Agent
}
it('uses pending projections for preparation while execution callbacks consult only live authorization', async () => {
  const agent = fixture()
  const user = suite('user')
  const project = suite('project')
  const original: McpSuiteOverrides = {
    selected: { enabled: false, auth: { enabled: true, scope: 'read' }, disabledTools: ['delete'], env: { TOKEN: 'credential-reference' }, startupTimeoutMs: 123 },
    denied: { enabled: false, disabledTools: ['all'] }
  }
  const enabledUserSuites = vi.fn(async () => [])
  const readProjectCatalog = vi.fn(async () => ({ enabledSuites: [] }))
  const catalog = {
    enabledUserSuites,
    readProjectCatalog,
    mcpBackend: async () => 'builtin',
    allMcpOverrides: async () => new Map([['source/project', original]])
  } as unknown as Catalog
  let allowed = false
  let projected = [user, project]
  const suites = vi.fn(async () => projected)
  const contributors = new ScopedExtensionContributors({
    dataRoot: '/unused',
    catalog,
    shell: () => undefined,
    suites,
    allows: () => allowed,
    registrationAllows: (_agent, id) => !id.endsWith('/denied'),
    panels: { commands: {} as UserPanelStore }
  })
  await contributors.reconcile(agent, captureExtensionSelection(null, ['market:source/user', 'market:source/project']))
  expect(observed.commands[0]).toEqual([user, project])
  expect(enabledUserSuites).not.toHaveBeenCalled()
  expect(readProjectCatalog).not.toHaveBeenCalled()
  const skill = observed.skills[0] as SuiteSkillProviderOptions
  expect(await skill.suites?.('/workspace')).toEqual([user, project])
  expect(skill.suiteAllowed?.(user)).toBe(false)
  expect(skill.overrideDisabled?.(user, { name: 'foo' } as Suite['skills'][number])).toBe(false)
  for (const policy of observed.commandPolicies) {
    expect(policy[2]).toEqual({ allowDisabled: true })
  }
  allowed = true
  expect(skill.suiteAllowed?.(user)).toBe(true)
  expect(skill.overrideDisabled?.(user, { name: 'foo' } as Suite['skills'][number])).toBe(true)
  projected = []
  expect(await skill.suites?.('/workspace')).toEqual([])
  allowed = false
  expect(skill.suiteAllowed?.(user)).toBe(false)
  const mounted = observed.mcp[0] as Suite[]
  expect(mounted).toHaveLength(1)
  expect(mounted[0]?.dimension).toBe('project')
  expect(Object.keys(mounted[0]?.mcp?.servers ?? {})).toEqual(['selected'])
  const overrides = observed.overrides[0] as Map<string, McpSuiteOverrides>
  expect(overrides.get('source/project')?.selected).toEqual({ ...original.selected, enabled: true })
  expect(overrides.get('source/project')?.denied).toEqual(original.denied)
  expect(original.selected?.enabled).toBe(false)
  await contributors.disposeAll()
})

it('loads a disabled skill through the actual provider using projected suites and live policy', async () => {
  const root = await mkdtemp(join(tmpdir(), 'extension-projection-'))
  const agent = fixture()
  const projected = suite('user')
  const file = join(root, 'SKILL.md')
  await writeFile(file, '---\nname: foo\ndescription: Test skill\ndisabled: true\n---\nSelected body\n')
  projected.skills = [{ name: 'foo', description: 'Test skill', file, directory: root, invocation: { modelInvocable: false, userInvocable: false } }]
  const catalog = { enabledUserSuites: async () => [], readProjectCatalog: async () => ({ enabledSuites: [] }) } as unknown as Catalog
  let allowed = true
  const contributors = new ScopedExtensionContributors({ dataRoot: root, catalog, shell: () => undefined, suites: async () => [projected], allows: () => allowed })
  try {
    await contributors.reconcile(agent, captureExtensionSelection(null, ['market:source/user']))
    const { SuiteSkillProvider } = await vi.importActual<typeof import('../src/runtime/surfaces/skills-provider.js')>('../src/runtime/surfaces/skills-provider.js')
    const provider = new SuiteSkillProvider(catalog, observed.skills[0] as SuiteSkillProviderOptions)
    const candidates = await provider.list({})
    expect(candidates).toHaveLength(1)
    expect((await provider.get(candidates[0]!, {}))?.content).toContain('Selected body')
    allowed = false
    expect(await provider.get(candidates[0]!, {})).toBeUndefined()
    expect(await provider.list({})).toEqual([])
  } finally {
    await contributors.disposeAll()
    await rm(root, { recursive: true, force: true })
  }
})
