import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies, mountAgentLoopTestHarness } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { bindScopeParent } from '@deepseek-ai/dsh-scope'
import { McpMountRegistry, supportsMcpSessionControl } from '../packages/market-mcp/src/runtime/mcp/mcp-mounts.js'
import { effectiveSurfaces, type Suite } from '../packages/market-contracts/src/model/types.js'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import Lsp, { LspProviderId } from '@deepseek-ai/dsh-lsp'
import * as lspTool from '@deepseek-ai/dsh-tool-lsp'
import { attachExtensionToolGates, type ExtensionLspProvider, type ExtensionToolOwnership } from '../packages/market-runtime/src/runtime/host/extension-tool-gates.js'
import { bridgeToolRegistrations, registerOwnedBridgeTool } from '../packages/market-mcp/src/runtime/mcp/bridge/tool-ownership.js'
import { publicToolName, syncTools, type ToolHost } from '../packages/market-mcp/src/runtime/mcp/bridge/tools.js'

const cleanups: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanups.splice(0).reverse()) await dispose()
})

interface ProgramRequest {
  program: string
  bindings: Array<{ functions: Record<string, (args: unknown) => Promise<unknown>> }>
}

// The real run_code transport supplies bindings and performs every nested dispatch. Only the
// language substrate is replaced, so these tests require no subprocess or installed runtime binary.
class BindingRuntime extends Service {
  readonly language = 'typescript'
  readonly isolation = 'test'
  beforeCall?: () => void
  constructor(ctx: Context) {
    super(ctx, 'ptcRuntime')
  }
  resolve(request: ProgramRequest): ProgramRequest {
    return request
  }
  async run(request: ProgramRequest) {
    const { name, args = {} } = JSON.parse(request.program) as { name: string; args?: unknown }
    this.beforeCall?.()
    const call = request.bindings[0]?.functions[name]
    if (call === undefined) return { logs: [], error: { kind: 'exception', message: 'binding unavailable: ' + name } }
    try {
      return { logs: [], value: await call(args) }
    } catch (error) {
      return { logs: [], error: { kind: 'exception', message: String(error) } }
    }
  }
}

async function setup() {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(BindingRuntime)
  const harness = await mountAgentLoopTestHarness(ctx)
  const a = await harness.create(SessionId('extension-tools-a'), {}, { cwd: '/same/workspace' })
  const b = await harness.create(SessionId('extension-tools-b'), {}, { cwd: '/same/workspace' })
  const chosen = new Map<Agent, Set<string>>([
    [a, new Set()],
    [b, new Set()]
  ])
  const notReady = new Set<Agent>()
  const providers: ExtensionLspProvider[] = []
  let ownsLsp = false
  const ownership: ExtensionToolOwnership = {
    mcpTools: () =>
      [ctx, a.ctx, b.ctx].flatMap(owner =>
        bridgeToolRegistrations(owner).map(entry => ({
          ...entry,
          name: entry.definition.name,
          resourceId: 'mcp:' + entry.serverName,
          suiteId: 'source/suite'
        }))
      ),
    lspProviders: () => providers,
    ownsLspTool: () => ownsLsp
  }
  const gates = [a, b].map(agent =>
    attachExtensionToolGates(agent, ownership, {
      ready: candidate => !notReady.has(candidate),
      allows: (candidate, id) => chosen.get(candidate)?.has(id) === true
    })
  )
  cleanups.push(...gates.map(gate => () => gate.dispose()))
  const refresh = () => gates.forEach(gate => gate.refresh())
  const call = (agent: Agent, name: string, args: unknown = {}) =>
    ctx.tools.execute({ callId: ToolCallId('test-call'), name, arguments: args, agent, signal: new AbortController().signal })
  const ptc = (agent: Agent, name: string, args: unknown = {}) => call(agent, 'run_code', { code: JSON.stringify({ name, args }), description: 'Exercise nested dispatch' })
  const register = (owner: Context, server: string, raw: string, execute = vi.fn(async () => 'called')) => {
    const definition = defineTool({
      name: publicToolName(server, raw),
      description: raw,
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute
    })
    const remove = registerOwnedBridgeTool(owner, server, definition, () => owner.tools.register(definition))
    cleanups.push(remove)
    return { definition, execute, remove }
  }
  return {
    ctx,
    a,
    b,
    chosen,
    notReady,
    providers,
    ownership,
    gates,
    refresh,
    call,
    ptc,
    register,
    enableLsp: () => {
      ownsLsp = true
    }
  }
}

describe('extension gates on the published rc.2 ToolRuntime', () => {
  it('publishes source-qualified mount ownership before tool registration completes', async () => {
    const f = await setup()
    let remove: (() => void) | undefined
    let duringRegistration: ReturnType<McpMountRegistry['toolOwnership']> = []
    const mountContext = {
      root: f.ctx.root,
      logger: { warn: vi.fn() },
      plugin(_plugin: unknown, config: { serverName: string }) {
        const definition = defineTool({
          name: publicToolName(config.serverName, 'query'),
          description: 'Query',
          parameters: {},
          output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
          execute: async () => 'ok'
        })
        remove = registerOwnedBridgeTool(f.ctx, config.serverName, definition, () => {
          duringRegistration = registry.toolOwnership()
          return f.ctx.tools.register(definition)
        })
        return { await: async () => {}, dispose: () => remove?.() }
      }
    }
    const registry = new McpMountRegistry(mountContext as unknown as Context, '/unused-data')
    cleanups.push(() => registry.disposeAll())
    const suite: Suite = {
      sourceId: 'source',
      id: 'suite',
      root: '/unused',
      manifest: { layout: 'claude-code', path: '', id: 'suite', name: 'Suite' },
      skills: [],
      mcp: { schema: 'native-client', servers: { db: { type: 'streamable-http', url: 'https://example.test/mcp' } } },
      surfaces: { skills: 0, commands: 0, hooks: 0, mcp: 1, lsp: 0, agents: 0 },
      activeSurfaces: effectiveSurfaces(undefined),
      dimension: 'user',
      enabled: true,
      errors: []
    }
    expect(await registry.reconcile([suite])).toEqual([])
    expect(duringRegistration).toMatchObject([{ resourceId: 'mcp:plugin:source/suite/db', suiteId: 'source/suite', name: publicToolName('suite__db', 'query') }])
    expect(registry.toolOwnership()).toHaveLength(1)
    await registry.disposeAll()
    expect(registry.toolOwnership()).toEqual([])
    expect(supportsMcpSessionControl('builtin')).toBe(true)
    expect(supportsMcpSessionControl('host')).toBe(false)
  })

  it('isolates opposite same-workspace choices in Native and PTC without shared teardown', async () => {
    const f = await setup()
    const tool = f.register(f.ctx, 'db', 'query')
    f.chosen.get(f.a)!.add('mcp:db')
    f.refresh()
    expect(f.a.session.header.cwd).toBe(f.b.session.header.cwd)
    expect(f.ctx.tools.schemas(f.a).map(schema => schema.name)).toContain(tool.definition.name)
    expect(f.ctx.tools.schemas(f.b).map(schema => schema.name)).not.toContain(tool.definition.name)
    expect((await f.call(f.b, tool.definition.name)).isError).toBe(true)
    expect(tool.execute).not.toHaveBeenCalled()
    expect((await f.call(f.a, tool.definition.name)).isError).toBe(false)
    f.a.ctx.tools.presentAs('ptc')
    f.b.ctx.tools.presentAs('ptc')
    expect((await f.ptc(f.b, tool.definition.name)).isError).toBe(true)
    expect((await f.ptc(f.a, tool.definition.name)).isError).toBe(false)
    expect(tool.execute).toHaveBeenCalledTimes(2)
    expect(f.ctx.tools.get(tool.definition.name)).toBe(tool.definition)
  })

  it('guards stale bindings and own-scope tools after policy changes and rejects unready state', async () => {
    const f = await setup()
    const tool = f.register(f.a.ctx, 'project', 'query')
    f.chosen.get(f.a)!.add('mcp:project')
    f.a.ctx.tools.presentAs('ptc')
    const runtime = f.ctx.get('ptcRuntime') as unknown as BindingRuntime
    runtime.beforeCall = () => f.chosen.get(f.a)!.clear()
    expect((await f.ptc(f.a, tool.definition.name)).isError).toBe(true)
    expect(tool.execute).not.toHaveBeenCalled()
    runtime.beforeCall = undefined
    f.chosen.get(f.a)!.add('mcp:project')
    f.notReady.add(f.a)
    expect((await f.ptc(f.a, tool.definition.name)).isError).toBe(true)
    expect(tool.execute).not.toHaveBeenCalled()
    f.notReady.delete(f.a)
    expect((await f.ptc(f.a, tool.definition.name)).isError).toBe(false)
    expect(tool.execute).toHaveBeenCalledTimes(1)
  })

  it('keeps own-scope same-name tools independent even across an agent parent chain', async () => {
    const f = await setup()
    bindScopeParent(f.b, f.a)
    const parentTool = f.register(f.a.ctx, 'project', 'query')
    const childTool = f.register(f.b.ctx, 'project', 'query')
    f.chosen.get(f.b)!.add('mcp:project')
    f.refresh()
    expect((await f.call(f.a, parentTool.definition.name)).isError).toBe(true)
    expect((await f.call(f.b, childTool.definition.name)).isError).toBe(false)
    expect(parentTool.execute).not.toHaveBeenCalled()
    expect(childTool.execute).toHaveBeenCalledTimes(1)
    f.gates[0]!.dispose()
    expect((await f.call(f.b, childTool.definition.name)).isError).toBe(false)
  })

  it('restricts the nearest inherited definition rather than a shadowed global owner', async () => {
    const f = await setup()
    bindScopeParent(f.b, f.a)
    const global = f.register(f.ctx, 'A', 'B__query')
    const inherited = f.register(f.a.ctx, 'A__B', 'query')
    f.chosen.get(f.a)!.add('mcp:A')
    f.chosen.get(f.b)!.add('mcp:A__B')
    f.refresh()
    expect(f.ctx.tools.get(global.definition.name, f.b)).toBe(inherited.definition)
    expect((await f.call(f.b, inherited.definition.name)).isError).toBe(false)
    expect(global.execute).not.toHaveBeenCalled()
    expect(inherited.execute).toHaveBeenCalledTimes(1)
  })

  it('owns dynamic definitions before tools/change and never loops on restriction notifications', async () => {
    const f = await setup()
    const changes = vi.fn()
    const off = f.ctx.on('tools/change', changes)
    cleanups.push(() => {
      off()
    })
    const dynamic = f.register(f.ctx, 'db', 'new.tool/' + 'x'.repeat(80))
    expect(dynamic.definition.name).toHaveLength(64)
    expect(f.ctx.tools.schemas(f.a).map(schema => schema.name)).not.toContain(dynamic.definition.name)
    expect((await f.call(f.a, dynamic.definition.name)).isError).toBe(true)
    expect(dynamic.execute).not.toHaveBeenCalled()
    const count = changes.mock.calls.length
    f.refresh()
    f.refresh()
    expect(changes).toHaveBeenCalledTimes(count)
    expect(count).toBeLessThan(8)
    dynamic.remove()
    expect(f.ctx.tools.get(dynamic.definition.name)).toBeUndefined()
  })

  it('keeps colliding namespaces and foreign same-name scoped replacements distinct', async () => {
    const f = await setup()
    const first = f.register(f.ctx, 'A', 'B__query')
    expect(first.definition.name).toBe(publicToolName('A__B', 'query'))
    f.chosen.get(f.a)!.add('mcp:A__B')
    f.refresh()
    expect((await f.call(f.a, first.definition.name)).isError).toBe(true)
    expect(first.execute).not.toHaveBeenCalled()
    const replacement = defineTool({
      name: first.definition.name,
      description: 'Foreign local tool',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => 'foreign'
    })
    cleanups.push(f.a.ctx.tools.register(replacement))
    expect(await f.call(f.a, first.definition.name)).toMatchObject({ isError: false, value: 'foreign' })
    expect(first.execute).not.toHaveBeenCalled()
    expect(() => f.register(f.ctx, 'A__B', 'query')).toThrow()
    expect(bridgeToolRegistrations(f.ctx)).toHaveLength(1)
  })

  it('denies MCP transport calls after real bridge discovery and allows the other agent', async () => {
    const f = await setup()
    const request = vi.fn(async (request: { method: string }) =>
      request.method === 'tools/list' ? { tools: [{ name: 'query', inputSchema: { type: 'object', properties: {} } }] } : { content: [{ type: 'text', text: 'server-result' }] }
    )
    const host: ToolHost = {
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
      tools: { register: definition => registerOwnedBridgeTool(f.ctx, 'db', definition, () => f.ctx.tools.register(definition as ToolDefinition)) }
    }
    const registrations = await syncTools({ request } as never, host, { serverName: 'db', registrationFailure: 'throw', toolCallTimeoutMs: 1000 }, new Map())
    cleanups.push(() => {
      for (const remove of registrations.values()) remove()
    })
    const name = publicToolName('db', 'query')
    f.chosen.get(f.b)!.add('mcp:db')
    f.refresh()
    request.mockClear()
    expect((await f.call(f.a, name)).isError).toBe(true)
    expect(request).not.toHaveBeenCalled()
    expect((await f.call(f.b, name)).isError).toBe(false)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('guards the actual LSP provider by final extension and denies unknown routes before query', async () => {
    const f = await setup()
    await f.ctx.plugin(Lsp)
    f.enableLsp()
    await f.ctx.plugin(lspTool)
    const tsQuery = vi.fn(async () => ({ kind: 'hover' as const, hover: { contents: 'typescript' } }))
    const pyQuery = vi.fn(async () => ({ kind: 'hover' as const, hover: { contents: 'python' } }))
    cleanups.push(f.ctx.lsp.registerProvider({ id: LspProviderId('source/suite/ts'), extensionToLanguage: { '.ts': 'typescript' }, query: tsQuery }))
    cleanups.push(f.ctx.lsp.registerProvider({ id: LspProviderId('direct/py'), extensionToLanguage: { '.py': 'python' }, query: pyQuery }))
    f.providers.push({ resourceId: 'lsp:source/suite/ts', suiteId: 'source/suite', extensions: ['.ts'] }, { resourceId: 'lsp:direct/py', extensions: ['.py'] })
    f.chosen.get(f.a)!.add('lsp:source/suite/ts')
    f.chosen.get(f.b)!.add('lsp:direct/py')
    f.refresh()
    const args = (file_path: string) => ({ operation: 'hover', file_path, line: 1, character: 1 })
    expect((await f.call(f.b, 'lsp', args('foo.TS'))).isError).toBe(true)
    expect((await f.call(f.a, 'lsp', args('foo.unknown'))).isError).toBe(true)
    expect(tsQuery).not.toHaveBeenCalled()
    expect(pyQuery).not.toHaveBeenCalled()
    expect((await f.call(f.a, 'lsp', args('foo.TS'))).isError).toBe(false)
    f.b.ctx.tools.presentAs('ptc')
    expect((await f.ptc(f.b, 'lsp', args('foo.ts'))).isError).toBe(true)
    expect((await f.ptc(f.b, 'lsp', args('foo.py'))).isError).toBe(false)
    expect(tsQuery).toHaveBeenCalledTimes(1)
    expect(pyQuery).toHaveBeenCalledTimes(1)
    f.chosen.get(f.a)!.clear()
    f.refresh()
    expect(f.ctx.tools.get('lsp', f.a)).toBeUndefined()
    expect(f.ctx.tools.get('lsp', f.b)).toBeDefined()
    expect((await f.ptc(f.b, 'lsp', args('foo.py'))).isError).toBe(false)
  })

  it('keeps the denial code and identity while explaining the action a caller can take', async () => {
    const f = await setup()
    await f.ctx.plugin(Lsp)
    f.enableLsp()
    await f.ctx.plugin(lspTool)
    const tsQuery = vi.fn(async () => ({ kind: 'hover' as const, hover: { contents: 'typescript' } }))
    cleanups.push(f.ctx.lsp.registerProvider({ id: LspProviderId('source/suite/ts'), extensionToLanguage: { '.ts': 'typescript' }, query: tsQuery }))
    // One enabled route keeps the lsp tool visible, so every denial below comes from the
    // guard rather than from a restriction hiding the tool.
    f.providers.push(
      { resourceId: 'lsp:source/suite/ts', suiteId: 'source/suite', extensions: ['.ts'] },
      { resourceId: 'lsp:direct/zig', extensions: ['.zig'] },
      { resourceId: 'lsp:direct/rs', extensions: ['.rs'] },
      { resourceId: 'lsp:other/rs', extensions: ['.rs'] }
    )
    f.chosen.get(f.a)!.add('lsp:source/suite/ts')
    f.refresh()
    const denial = async (name: string, value: unknown): Promise<string> => {
      const result = await f.call(f.a, name, value)
      expect(result.isError).toBe(true)
      if (!result.isError) throw new Error('expected a denial')
      return result.error.message
    }
    const args = (file_path: unknown) => ({ operation: 'hover', file_path, line: 1, character: 1 })

    // A disabled own-scope tool is denied by the guard, and the reason says retrying cannot change it.
    const tool = f.register(f.a.ctx, 'project', 'query')
    const disabled = await denial(tool.definition.name, {})
    expect(disabled.startsWith('extension-resource-disabled: mcp:project')).toBe(true)
    expect(disabled).toContain('Do not retry unchanged')
    expect(disabled).toContain('ask the user to check session readiness and enable')
    expect(tool.execute).not.toHaveBeenCalled()
    f.chosen.get(f.a)!.add('mcp:project')
    f.notReady.add(f.a)
    expect(await denial(tool.definition.name, {})).toContain('check session readiness')
    expect(tool.execute).not.toHaveBeenCalled()
    f.notReady.delete(f.a)

    // A missing argument names the parameter to supply.
    const badPath = await denial('lsp', args(42))
    expect(badPath.startsWith('extension-lsp-route-unavailable: invalid file_path')).toBe(true)
    expect(badPath).toContain('pass the file_path string')

    // No provider, one disabled provider, and several providers read as different situations.
    const missing = await denial('lsp', args('foo.unknown'))
    expect(missing.startsWith('extension-lsp-route-unavailable: .unknown')).toBe(true)
    expect(missing).toContain('no mounted LSP provider serves this extension')
    const disabledProvider = await denial('lsp', args('foo.zig'))
    expect(disabledProvider.startsWith('extension-resource-disabled: lsp:direct/zig')).toBe(true)
    expect(disabledProvider).toContain('ask the user to check session readiness and enable')
    const ambiguous = await denial('lsp', args('foo.rs'))
    expect(ambiguous.startsWith('extension-lsp-route-unavailable: .rs')).toBe(true)
    expect(ambiguous).toContain('more than one mounted LSP provider')
    expect(ambiguous).toContain('exactly one')
    expect(tsQuery).not.toHaveBeenCalled()

    // The decisions themselves are unchanged: the enabled single route still runs.
    expect((await f.call(f.a, 'lsp', args('foo.TS'))).isError).toBe(false)
    expect(tsQuery).toHaveBeenCalledTimes(1)
    expect(f.chosen.get(f.a)!.has('lsp:source/suite/ts')).toBe(true)
  })
})
