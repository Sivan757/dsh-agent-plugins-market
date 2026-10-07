/**
 * Host-shared project MCP: one mount per workspace, released by its last session.
 *
 * The fixture is a project-dimension v1 suite, so it is portable package data
 * (`isPortableMcp`) and its declaration is the realistic relative one: a
 * `./bin/server` wrapper the suite ships, which execs the interpreter itself.
 * The host path is real — @deepseek-ai/dsh-mcp-client is mounted as a plugin over
 * stdio — and every sharing claim is read from the host ToolRuntime through
 * tools.get, never from an internal map of ours.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import Persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionQueryEngine from '@deepseek-ai/dsh-session-query'
import { toMcpMounts } from '../src/application/mcp/mcp-config.js'
import { ScopedExtensionContributors, type ScopedContributorPorts } from '../src/runtime/host/scoped-contributors.js'
import { createUserPanelStores } from '../src/runtime/panels/user-panels.js'
import type { DiscoveredSuite } from '../src/model/types.js'
import { withDefaultSurfaces } from './helpers/projected-suite.js'

class TestQuery extends SessionQueryEngine {
  searchSessions(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }
  searchEvents(): Promise<never> {
    return Promise.reject(new Error('not used'))
  }
}
/** The host command seat the scoped mount reconciles against. */
function fakeCommands() {
  class FakeCommands extends Service {
    constructor(ctx: Context) {
      super(ctx, 'commands')
    }
    register(): () => void {
      return () => {}
    }
  }
  return { Plugin: FakeCommands }
}
/** The host shell seat the scoped hook fiber injects. */
function fakeShell() {
  class FakeShell extends Service {
    constructor(ctx: Context) {
      super(ctx, 'shell')
    }
    resolve(request: unknown): unknown {
      return request
    }
    async run(): Promise<unknown> {
      return { exitCode: 0, timedOut: false, aborted: false, stdout: { text: '', truncated: false }, stderr: { text: '', truncated: false } }
    }
  }
  return { Plugin: FakeShell }
}
/** The MCP server the suite ships, plus the relative wrapper its declaration names. */
async function writeShippedServer(root: string): Promise<void> {
  await mkdir(join(root, 'bin'), { recursive: true })
  const script = join(root, 'bin', 'server.mjs')
  await writeFile(
    script,
    [
      "const send = value => process.stdout.write(JSON.stringify(value) + '\\n')",
      "let buffer = ''",
      "process.stdin.on('data', chunk => {",
      '  buffer += chunk.toString()',
      '  let index',
      "  while ((index = buffer.indexOf('\\n')) >= 0) {",
      '    const line = buffer.slice(0, index).trim()',
      '    buffer = buffer.slice(index + 1)',
      "    if (line === '') continue",
      '    const message = JSON.parse(line)',
      "    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1.0.0' } } })",
      "    else if (message.method === 'tools/list') send({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'ping', description: 'ping', inputSchema: { type: 'object', properties: {} } }] } })",
      "    else if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: {} })",
      '  }',
      '})',
      ''
    ].join('\n')
  )
  const wrapper = join(root, 'bin', 'server')
  await writeFile(wrapper, ['#!/bin/sh', 'exec "' + process.execPath + '" "$(dirname "$0")/server.mjs" "$@"', ''].join('\n'))
  await chmod(wrapper, 0o755)
}
const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})
const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
const selection = { presetId: null, presetName: null, presetRevision: null, modified: false, enabledIds: ['market:demo/v1-suite'] }

/** One real host context, a shipped project suite, and the production scoped mount. */
async function setup(options: { command?: string } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'host-mcp-lifecycle-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const suiteRoot = join(root, 'suite')
  await writeShippedServer(suiteRoot)
  let command = options.command ?? './bin/server'
  const declared = (): DiscoveredSuite => ({
    sourceId: 'demo',
    id: 'v1-suite',
    root: suiteRoot,
    manifest: { layout: 'agent-plugin-v1', path: join(suiteRoot, 'plugin.json'), id: 'v1-suite', name: 'v1-suite' },
    skills: [],
    mcp: {
      schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      root: suiteRoot,
      servers: { db: { type: 'stdio', command, args: [] } }
    },
    surfaces: { skills: 0, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 0 },
    dimension: 'project',
    enabled: true,
    errors: []
  })
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(Persistence, { root: join(root, 'sessions') })
  await ctx.plugin(TestQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  ctx.plugin(fakeCommands().Plugin)
  ctx.plugin(fakeShell().Plugin)
  ctx.plugin(SkillRegistry)
  await tick()
  const suiteAt = () => withDefaultSurfaces(declared())
  // Local stub cast, deliberately narrow: Catalog carries private state, so the
  // runtime is handed only the four catalog reads this path performs. No production
  // port is widened for the sake of a test.
  const catalogReads: ScopedContributorPorts['catalog'] = {
    readProjectCatalog: async () => ({ suites: [suiteAt()], enabledSuites: [suiteAt()] }),
    enabledUserSuites: async () => [],
    allMcpOverrides: async () => new Map(),
    mcpBackend: async () => 'host'
  } as unknown as ScopedContributorPorts['catalog']
  const contributors = new ScopedExtensionContributors({
    dataRoot: root,
    catalog: catalogReads,
    shell: () => undefined,
    allows: () => true,
    panels: { commands: createUserPanelStores(join(root, 'agents')).commands },
    hostContext: ctx
  })
  const registered: string[] = []
  const released: string[] = []
  const realRegister = ctx.tools.register.bind(ctx.tools)
  vi.spyOn(ctx.tools, 'register').mockImplementation((definition: { name: string }) => {
    registered.push(definition.name)
    const off = realRegister(definition as never)
    return () => {
      released.push(definition.name)
      off()
    }
  })
  const diagnostics: string[] = []
  const capture = (agent: Agent): void => {
    const logger = (agent.ctx as unknown as { logger?: { warn?: (message: string) => void } }).logger
    if (logger?.warn === undefined) return
    const original = logger.warn.bind(logger)
    logger.warn = (message: string) => {
      diagnostics.push(String(message))
      original(message)
    }
  }
  const create = (id: string, cwd = root) => ctx.agentLoop.create(SessionId(id), { provider: 'mock', model: 'test' }, { cwd })
  return {
    root,
    ctx,
    contributors,
    create,
    registered,
    released,
    diagnostics,
    capture,
    suiteAt,
    setCommand: (value: string) => {
      command = value
    }
  }
}

describe('host-shared project MCP lifecycle', () => {
  it('projects the shipped project suite into a real mount request', async () => {
    const h = await setup()
    const projected = await toMcpMounts(h.suiteAt(), h.root)
    expect(projected.failures).toEqual([])
    expect(projected.mounts).toHaveLength(1)
    // The declaration is relative; the mount request carries the shipped wrapper,
    // resolved by the pipeline rather than by the fixture.
    expect(projected.mounts[0]?.config).toMatchObject({ transport: 'stdio' })
    expect(String((projected.mounts[0]?.config as { command?: string }).command)).toContain('bin/server')
  })

  it('mounts once for two sessions in one workspace and releases on the last dispose', async () => {
    const h = await setup()
    const first = await h.create('session-one')
    const second = await h.create('session-two')
    expect(first.session.header.cwd).toBe(second.session.header.cwd)
    h.capture(first)
    await h.contributors.reconcile(first, selection)
    await vi.waitFor(() => expect(h.registered.length).toBeGreaterThan(0))
    const exposed = h.registered[0]!
    expect(h.ctx.tools.get(exposed, first)).toBeDefined()
    const afterFirst = h.registered.length
    await h.contributors.reconcile(second, selection)
    expect(h.registered.length).toBe(afterFirst)
    await h.contributors.dispose(first)
    expect(h.released).toHaveLength(0)
    expect(h.ctx.tools.get(exposed, first)).toBeDefined()
    await h.contributors.dispose(second)
    await vi.waitFor(() => expect(h.released.length).toBe(afterFirst))
    expect(h.ctx.tools.get(exposed, first)).toBeUndefined()
  })

  it('does not silently double-mount one server name across two workspaces', async () => {
    const h = await setup()
    const dirA = await mkdtemp(join(tmpdir(), 'host-mcp-ws-a-'))
    const dirB = await mkdtemp(join(tmpdir(), 'host-mcp-ws-b-'))
    cleanups.push(() => rm(dirA, { recursive: true, force: true }))
    cleanups.push(() => rm(dirB, { recursive: true, force: true }))
    const first = await h.create('workspace-a', dirA)
    const second = await h.create('workspace-b', dirB)
    h.capture(first)
    h.capture(second)
    await h.contributors.reconcile(first, selection)
    await vi.waitFor(() => expect(h.registered.length).toBeGreaterThan(0))
    const afterFirst = h.registered.length
    await h.contributors.reconcile(second, selection)
    await tick()
    expect(h.registered.length).toBe(afterFirst)
    expect(h.diagnostics, JSON.stringify(h.diagnostics)).not.toHaveLength(0)
  })

  it('mounts a failing server again after the failure, proving the entry was released', async () => {
    const h = await setup({ command: './bin/missing' })
    const agent = await h.create('failing-session')
    h.capture(agent)
    await h.contributors.reconcile(agent, selection)
    expect(h.registered).toHaveLength(0)
    expect(h.diagnostics, JSON.stringify(h.diagnostics)).not.toHaveLength(0)
    h.setCommand('./bin/server')
    await h.contributors.reconcile(agent, selection)
    await vi.waitFor(() => expect(h.registered.length).toBeGreaterThan(0))
    expect(h.ctx.tools.get(h.registered[0]!, agent)).toBeDefined()
  })
})
