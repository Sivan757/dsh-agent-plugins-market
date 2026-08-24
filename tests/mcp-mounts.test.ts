import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { McpMountRegistry } from '../src/runtime/mcp-mounts.js'
import type { Suite } from '../src/model/types.js'

const CC_COMMANDS_ROOT = fileURLToPath(new URL('./fixtures/cc-commands', import.meta.url))

interface MountedPlugin {
  config: Record<string, unknown>
  disposed: boolean
}

function fakeContext(): { ctx: Record<string, unknown>; mounts: Map<string, MountedPlugin> } {
  const mounts = new Map<string, MountedPlugin>()
  const ctx: Record<string, unknown> = {
    plugin: (plugin: unknown, config: Record<string, unknown>) => {
      const serverName = config['serverName'] as string
      const mounted: MountedPlugin = { config, disposed: false }
      mounts.set(serverName, mounted)
      return {
        await: async () => {},
        dispose: async () => {
          mounted.disposed = true
        }
      }
    },
    logger: { warn: () => {} }
  }
  return { ctx, mounts }
}

function suite(id: string, serverKey: string): Suite {
  return {
    sourceId: 'demo',
    id,
    root: `/tmp/${id}`,
    manifest: { layout: 'agent-plugin-v1', path: `/tmp/${id}/plugin.json`, id, name: id },
    skills: [],
    mcp: {
      schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      servers: { [serverKey]: { type: 'stdio', command: 'tool' } }
    },
    surfaces: { skills: 0, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 0 },
    dimension: 'user',
    enabled: true,
    errors: []
  }
}

describe('McpMountRegistry', () => {
  it('mounts enabled suites and unmounts removed ones through ctx.plugin', async () => {
    const { ctx, mounts } = fakeContext()
    const registry = new McpMountRegistry(ctx as never, '/tmp/data')
    const diagnostics = await registry.reconcile([suite('alpha', 'db')])
    expect(diagnostics).toEqual([])
    expect(mounts.size).toBe(1)
    const mounted = [...mounts.values()][0]!
    expect(mounted.config['transport']).toBe('stdio')
    expect(mounted.config['serverName']).toBe('alpha__db')

    await registry.reconcile([])
    expect(mounted.disposed).toBe(true)
    expect(mounts.size).toBe(1)

    await registry.disposeAll()
  })

  it('reports duplicate derived serverNames instead of double-mounting', async () => {
    const { ctx, mounts } = fakeContext()
    const registry = new McpMountRegistry(ctx as never, '/tmp/data')
    const duplicate = suite('alpha', 'db')
    const diagnostics = await registry.reconcile([duplicate, suite('alpha!', 'db')])
    expect(diagnostics.some(diagnostic => diagnostic.reason.includes('already mounted'))).toBe(true)
    expect(mounts.size).toBe(1)
    await registry.disposeAll()
  })
})

describe('CommandMountRegistry (CC commands compat)', () => {
  it('registers commands/*.md and forwards the template as a model follow-up', async () => {
    const registered: Array<{ name: string; description: string; input?: { hint: string }; handler: (inv: { agent: unknown; rawInput: string }) => unknown }> = []
    const ctx = {
      commands: {
        register: (def: { name: string; description: string; input?: { hint: string }; handler: (inv: { agent: unknown; rawInput: string }) => unknown }) => {
          registered.push(def)
          return () => {
            registered.splice(registered.indexOf(def), 1)
          }
        }
      }
    }
    const registry = new (await import('../src/runtime/commands-mounts.js')).CommandMountRegistry(ctx as never)
    const suites = await (await import('../src/catalog/suite-scanner.js')).discoverSuitesInSource(CC_COMMANDS_ROOT, 'cc', 'user')
    suites[0]!.enabled = true
    const diagnostics = await registry.reconcile(suites)
    expect(diagnostics).toEqual([])
    // Commands register under their file name; agents/*.md register as
    // /agent-<name> so subagents are selectable from the slash menu.
    expect(registered.map(def => def.name)).toEqual(['review', 'agent-codex-rescue'])
    expect(registered[0]!.description).toBe('[cc-commands] Run a challenge review')
    expect(registered[1]!.description).toContain('[cc-commands]')
    expect(registered[1]!.input).toEqual({ hint: '子代理' })
    let followup: { content: Array<{ type: string; text: string }> } | undefined
    const result = registered[0]!.handler({
      agent: {
        followup: (message: { content: Array<{ type: string; text: string }> }) => {
          followup = message
        }
      },
      rawInput: '--wait focus'
    })
    expect(result).toMatchObject({ kind: 'success' })
    expect(followup!.content[0]!.text).toContain('Raw arguments: `--wait focus`')
    registry.disposeAll()
    expect(registered.length).toBe(0)
  })
})

describe('agents compat (agent-<name> skills)', () => {
  it('lists agent definitions as agent-* skills and renders a usable body', async () => {
    const { Catalog } = await import('../src/application/catalog.js')
    const { mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const userRoot = await mkdtemp(`${tmpdir()}/dsh-agent-plugins-agents-`)
    const manager = new Catalog({ userRoot, dataRoot: `${userRoot}/data`, onChanged: () => {} })
    await manager.load()
    await manager.mergeSources([{ id: 'cc', url: CC_COMMANDS_ROOT, local: true }])
    await manager.install('cc', 'cc-commands')
    await manager.setEnabled('cc', 'cc-commands', true)
    const provider = new (await import('../src/runtime/skills-provider.js')).SuiteSkillProvider(manager)
    const candidates = await provider.list({})
    const names = candidates.map(candidate => candidate.name)
    expect(names).toContain('agent-codex-rescue')
    expect(names).toContain('plain')
    const agent = candidates.find(candidate => candidate.name === 'agent-codex-rescue')!
    const definition = await provider.get(agent, {})
    expect(definition!.content).toContain('子代理定义')
    expect(definition!.content).toContain('forwarding wrapper')
  })
})

describe('HooksMountRegistry (CC hooks compat)', () => {
  it('mounts one bridge per suite with the suite hook config path', async () => {
    const mounted: Array<{ config: Record<string, unknown> }> = []
    const ctx = {
      plugin: (_plugin: unknown, config: Record<string, unknown>) => {
        mounted.push({ config })
        return { await: async () => {}, dispose: async () => {} }
      },
      logger: { warn: () => {} }
    }
    const registry = new (await import('../src/runtime/hooks-mounts.js')).HooksMountRegistry(ctx as never)
    const suites = await (await import('../src/catalog/suite-scanner.js')).discoverSuitesInSource(CC_COMMANDS_ROOT, 'cc', 'user')
    suites[0]!.enabled = true
    const diagnostics = await registry.reconcile(suites)
    expect(diagnostics).toEqual([])
    expect(mounted).toHaveLength(1)
    expect(mounted[0]!.config['configPath']).toContain('hooks.json')
    expect(mounted[0]!.config['pluginRoot']).toContain('cc-commands')
    await registry.disposeAll()
    expect(mounted).toHaveLength(1)
  })
})
