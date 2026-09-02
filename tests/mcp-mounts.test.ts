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

  it('serializes overlapping reconcile calls so disable cannot race an in-flight mount', async () => {
    let releaseReady!: () => void
    const ready = new Promise<void>(resolve => {
      releaseReady = resolve
    })
    let mountStarted!: () => void
    const started = new Promise<void>(resolve => {
      mountStarted = resolve
    })
    const mounted = { disposed: false }
    const ctx = {
      plugin: () => {
        mountStarted()
        return {
          await: async () => ready,
          dispose: async () => {
            mounted.disposed = true
          }
        }
      },
      logger: { warn: () => {} }
    }
    const registry = new McpMountRegistry(ctx as never, '/tmp/data')

    const enabling = registry.reconcile([suite('race', 'db')])
    await started
    const disabling = registry.reconcile([])
    let disableSettled = false
    void disabling.then(() => {
      disableSettled = true
    })
    await Promise.resolve()
    expect(disableSettled).toBe(false)
    expect(mounted.disposed).toBe(false)

    releaseReady()
    await enabling
    await disabling
    expect(mounted.disposed).toBe(true)
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

  it('surfaces a failed startup as `failed` and leaves no orphan child behind', async () => {
    const disposed: string[] = []
    const ctx = {
      plugin: () => ({
        // `dsh-mcp-client` rejects on startup failure because mounts are
        // created with failOnStartupError, so the real error reaches us.
        await: async () => {
          throw new Error('connection refused')
        },
        dispose: async () => {
          disposed.push('disposed')
        }
      }),
      logger: { warn: () => {} }
    }
    const registry = new McpMountRegistry(ctx as never, '/tmp/data')
    const broken = suite('broken', 'service')

    const diagnostics = await registry.reconcile([broken])

    // The connection error is reported with its real message, not swallowed
    // into a silent "degraded" row.
    expect(diagnostics).toContainEqual({
      suiteId: 'broken',
      serverKey: 'service',
      code: 'mount-failed',
      reason: 'mount failed: connection refused'
    })
    // The half-mounted handle is disposed so no child process survives.
    expect(disposed).toEqual(['disposed'])
    await registry.disposeAll()
  })

  it('retains a mount after failed disposal so a later reconcile can retry cleanup', async () => {
    let disposeAttempts = 0
    const ctx = {
      plugin: () => ({
        await: async () => {},
        dispose: async () => {
          disposeAttempts++
          if (disposeAttempts === 1) throw new Error('busy')
        }
      }),
      logger: { warn: () => {} }
    }
    const registry = new McpMountRegistry(ctx as never, '/tmp/data')
    const mountedSuite = suite('retry', 'service')

    await registry.reconcile([mountedSuite])
    const first = await registry.reconcile([])
    const second = await registry.reconcile([])

    expect(first).toContainEqual({ suiteId: 'retry', serverKey: 'service', code: 'unmount-failed', reason: 'unmount failed: busy' })
    expect(second).toEqual([])
    expect(disposeAttempts).toBe(2)
  })

  it('does not spawn a server when an environment credential is missing', async () => {
    const mounted: Array<Record<string, unknown>> = []
    const ctx = {
      get: (name: string) => (name === 'credentials' ? { resolve: async () => undefined } : undefined),
      plugin: (_plugin: unknown, config: Record<string, unknown>) => {
        mounted.push(config)
        return { await: async () => {}, dispose: async () => {} }
      },
      logger: { warn: () => {} }
    }
    const authSuite = suite('auth', 'service')
    authSuite.mcp!.servers.service = { type: 'stdio', command: 'tool', env: { API_TOKEN: '${API_TOKEN}' } }
    const registry = new McpMountRegistry(ctx as never, '/tmp/data')

    const diagnostics = await registry.reconcile([authSuite])

    expect(mounted).toHaveLength(0)
    expect(diagnostics).toContainEqual({
      suiteId: 'auth',
      serverKey: 'service',
      code: 'missing-credential',
      credentialRefs: ['API_TOKEN'],
      reason: 'missing credential reference API_TOKEN'
    })
  })

  it('mounts with a credential supplied by the host resolver', async () => {
    const mounted: Array<{ config: Record<string, unknown>; disposed: boolean }> = []
    const ctx = {
      get: (name: string) => (name === 'credentials' ? { resolve: async (ref: string) => (ref === 'API_TOKEN' ? { value: 'secret', source: 'file' } : undefined) } : undefined),
      plugin: (_plugin: unknown, config: Record<string, unknown>) => {
        const row = { config, disposed: false }
        mounted.push(row)
        return {
          await: async () => {},
          dispose: async () => {
            row.disposed = true
          }
        }
      },
      logger: { warn: () => {} }
    }
    const authSuite = suite('auth', 'service')
    authSuite.mcp!.servers.service = { type: 'stdio', command: 'tool', env: { API_TOKEN: '${API_TOKEN}' } }
    const registry = new McpMountRegistry(ctx as never, '/tmp/data')

    await expect(registry.reconcile([authSuite])).resolves.toEqual([])

    expect(mounted).toHaveLength(1)
    expect((mounted[0]!.config['env'] as Record<string, string>).API_TOKEN).toBe('secret')
    await registry.disposeAll()
    expect(mounted[0]!.disposed).toBe(true)
  })

  it('skips mounting when a foreign MCP client already owns the derived serverName namespace', async () => {
    const mounted: Array<Record<string, unknown>> = []
    const ctx = {
      plugin: (_plugin: unknown, config: Record<string, unknown>) => {
        mounted.push(config)
        return { await: async () => {}, dispose: async () => {} }
      },
      logger: { warn: () => {} }
    }
    const registry = new McpMountRegistry(ctx as never, '/tmp/data')
    // A native host MCP client (or another plugin) already registered tools
    // under this suite's derived namespace.
    registry.setToolNamesProvider(() => ['mcp__alpha__db__query', 'other_tool'])

    const diagnostics = await registry.reconcile([suite('alpha', 'db')])

    expect(mounted).toHaveLength(0)
    expect(diagnostics).toContainEqual({
      suiteId: 'alpha',
      serverKey: 'db',
      code: 'foreign-mount',
      reason: expect.stringContaining('already mounted by another MCP client')
    })

    // Once the foreign owner goes away, a later reconcile mounts normally.
    registry.setToolNamesProvider(() => [])
    await expect(registry.reconcile([suite('alpha', 'db')])).resolves.toEqual([])
    expect(mounted).toHaveLength(1)
    expect(mounted[0]!['serverName']).toBe('alpha__db')
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

  it('disposes the bridge when the suite is disabled or uninstalled (reconcile shrinks)', async () => {
    const handles: Array<{ disposed: boolean }> = []
    const ctx = {
      plugin: () => {
        const handle = { disposed: false }
        handles.push(handle)
        return {
          await: async () => {},
          dispose: async () => {
            handle.disposed = true
          }
        }
      },
      logger: { warn: () => {} }
    }
    const registry = new (await import('../src/runtime/hooks-mounts.js')).HooksMountRegistry(ctx as never)
    const suites = await (await import('../src/catalog/suite-scanner.js')).discoverSuitesInSource(CC_COMMANDS_ROOT, 'cc', 'user')
    suites[0]!.enabled = true

    // Mounted while enabled.
    await registry.reconcile(suites)
    expect(handles).toHaveLength(1)
    expect(handles[0]!.disposed).toBe(false)

    // Disabling the suite: the caller reconciles with the enabled list only
    // (the disabled suite is absent from it) → bridge disposed.
    suites[0]!.enabled = false
    await registry.reconcile([])
    expect(handles[0]!.disposed).toBe(true)

    // Re-enabling mounts a fresh bridge.
    suites[0]!.enabled = true
    await registry.reconcile(suites)
    expect(handles).toHaveLength(2)
    expect(handles[1]!.disposed).toBe(false)

    // Uninstalling (suite absent) disposes the live bridge again.
    await registry.reconcile([])
    expect(handles[1]!.disposed).toBe(true)
  })
})
