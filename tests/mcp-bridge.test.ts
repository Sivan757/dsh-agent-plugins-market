/**
 * Tests for the market's self-built MCP bridge: public tool naming,
 * two-phase tool synchronization over a structural host, tool execution
 * mapping, transport construction (stdio / streamable-http / sse with the
 * OAuth provider wiring), and the bridge plugin shell's apply lifecycle.
 *
 * Core cases are ported from the harness `dsh-mcp-client` specs (archived
 * patch series `docs/upstream-proposal/patches/`); the host is faked
 * structurally because the bridge must not depend on host test packages.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { publicToolName, syncTools, type ToolBridgeOptions, type ToolDefinition, type ToolHost } from '../src/runtime/mcp-client/tools.js'
import { createTransport } from '../src/runtime/mcp-client/transport.js'
import { apply } from '../src/runtime/mcp-client/bridge.js'
import type { Config } from '../src/runtime/mcp-client/config.js'
import type { Context } from '@deepseek-ai/cordis'

const testToolSignal = new AbortController().signal

// ---- Mock MCP Client ----

interface MockTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  execution?: { taskSupport?: 'optional' | 'required' | 'forbidden' }
}

function createMockClient(tools: MockTool[], callResult: Record<string, unknown> = { content: [{ type: 'text', text: 'ok' }] }) {
  const listTools = vi.fn(async (): Promise<{ tools: MockTool[]; nextCursor: string | undefined }> => ({ tools, nextCursor: undefined }))
  const callTool = vi.fn(async (): Promise<Record<string, unknown>> => ({ ...callResult }))
  return {
    listTools,
    callTool,
    request: vi.fn(async (
      request: { method: string; params?: Record<string, unknown> },
    ): Promise<unknown> => {
      if (request.method === 'tools/list') return listTools()
      if (request.method === 'tools/call') return callTool()
      throw new Error(`unexpected MCP request: ${request.method}`)
    }),
    setNotificationHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }
}

// ---- Structural fake host ----

function createFakeHost(): ToolHost & { registered: Map<string, ToolDefinition> } {
  const registered = new Map<string, ToolDefinition>()
  return {
    registered,
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    tools: {
      register: (definition: ToolDefinition) => {
        registered.set(definition.name, definition)
        return () => { registered.delete(definition.name) }
      },
    },
  }
}

const defaultOpts: ToolBridgeOptions = { registrationFailure: 'throw', serverName: 'srv', toolCallTimeoutMs: 60_000 }

// ---- publicToolName ----

describe('publicToolName', () => {
  it('joins clean names verbatim', () => {
    expect(publicToolName('github', 'create_issue')).toBe('mcp__github__create_issue')
    expect(publicToolName('everything', 'get-sum')).toBe('mcp__everything__get-sum')
  })

  it('replaces invalid characters and appends an identity hash', () => {
    const name = publicToolName('srv', 'admin.reset')
    expect(name).toMatch(/^mcp__srv__admin_reset_[0-9a-f]{12}$/)
    expect(name.length).toBeLessThanOrEqual(64)
  })

  it('truncates over-long names and appends an identity hash', () => {
    const rawName = 'a'.repeat(80)
    const name = publicToolName('srv', rawName)
    expect(name).toHaveLength(64)
    expect(name).toMatch(/_[0-9a-f]{12}$/)
    expect(name.startsWith('mcp__srv__aaa')).toBe(true)
  })

  it('is deterministic and collision-free for distinct identities', () => {
    // Two raw names that normalize to the same base must not collapse.
    const a = publicToolName('srv', 'admin.reset')
    const b = publicToolName('srv', 'admin_reset')
    expect(a).toBe(publicToolName('srv', 'admin.reset'))
    expect(a).not.toBe(b)
  })
})

// ---- syncTools ----

describe('syncTools', () => {
  it('registers tools under server-qualified public names', async () => {
    const host = createFakeHost()
    const client = createMockClient([
      { name: 'greet', description: 'Say hello', inputSchema: { type: 'object', properties: { name: { type: 'string' } } } },
      { name: 'add', description: 'Add numbers', inputSchema: { type: 'object', properties: {} } },
    ])

    const disposers = await syncTools(client as never, host, defaultOpts, new Map())

    expect(disposers.size).toBe(2)
    expect([...host.registered.keys()].sort()).toEqual(['mcp__srv__add', 'mcp__srv__greet'])
  })

  it('lets two servers publish the same raw name side by side', async () => {
    const host = createFakeHost()
    const clientA = createMockClient([{ name: 'search', inputSchema: { type: 'object' } }])
    const clientB = createMockClient([{ name: 'search', inputSchema: { type: 'object' } }])

    await syncTools(clientA as never, host, { ...defaultOpts, serverName: 'github' }, new Map())
    await syncTools(clientB as never, host, { ...defaultOpts, serverName: 'web' }, new Map())

    expect(host.registered.has('mcp__github__search')).toBe(true)
    expect(host.registered.has('mcp__web__search')).toBe(true)
  })

  it('rejects a tool list where one raw name appears twice, leaving the previous generation intact', async () => {
    const host = createFakeHost()
    const client = createMockClient([{ name: 'first', inputSchema: { type: 'object' } }])
    const previous = await syncTools(client as never, host, defaultOpts, new Map())
    expect(host.registered.size).toBe(1)

    const badClient = createMockClient([
      { name: 'dup', inputSchema: { type: 'object' } },
      { name: 'dup', inputSchema: { type: 'object' } },
    ])
    await expect(syncTools(badClient as never, host, defaultOpts, previous)).rejects.toThrow(/more than once/)
    // The failed fetch leaves the previous generation registered untouched.
    expect([...host.registered.keys()]).toEqual(['mcp__srv__first'])
  })

  it('swaps generations: re-sync disposes the previous registration only after a successful fetch', async () => {
    const host = createFakeHost()
    const client = createMockClient([{ name: 'before', inputSchema: { type: 'object' } }])
    const previous = await syncTools(client as never, host, defaultOpts, new Map())

    const changed = createMockClient([{ name: 'after', inputSchema: { type: 'object' } }])
    const next = await syncTools(changed as never, host, defaultOpts, previous)
    expect([...next.keys()]).toEqual(['mcp__srv__after'])
    expect([...host.registered.keys()]).toEqual(['mcp__srv__after'])
  })

  it('falls back to untyped output when the advertised schema leaves the supported subset', async () => {
    const host = createFakeHost()
    const client = createMockClient([
      { name: 'weird', inputSchema: { type: 'object' }, outputSchema: { type: 'object', properties: { a: { type: 'bogus' } } } },
    ])

    await syncTools(client as never, host, defaultOpts, new Map())

    const definition = host.registered.get('mcp__srv__weird')!
    expect(definition.output.schema).toMatchObject({ type: 'object' })
    // The structuredContent property exists but is unconstrained ({}).
    expect((definition.output.schema.properties as Record<string, unknown>)['structuredContent']).toEqual({})
  })

  it('contains a registry conflict for ordinary syncs and rolls back to zero tools', async () => {
    const host = createFakeHost()
    // Squatting registration on the server's namespace.
    host.registered.set('mcp__srv__squatted', { name: 'mcp__srv__squatted', description: '', parameters: {}, output: { schema: { type: 'object' }, render: () => [] }, execute: async () => ({}) })
    const register = host.tools.register
    host.tools.register = definition => {
      if (definition.name === 'mcp__srv__squatted') throw new Error('name already registered')
      return register(definition)
    }
    const client = createMockClient([
      { name: 'squatted', inputSchema: { type: 'object' } },
      { name: 'other', inputSchema: { type: 'object' } },
    ])

    const disposers = await syncTools(client as never, host, { ...defaultOpts, registrationFailure: 'contain' }, new Map())

    expect(disposers.size).toBe(0)
    expect(host.logger.error).toHaveBeenCalledWith(expect.stringContaining('tool registration failed'))
  })
})

// ---- tool execution ----

describe('tool execution', () => {
  it('sends the raw name on the wire and returns the canonical MCP result', async () => {
    const host = createFakeHost()
    const client = createMockClient(
      [{ name: 'greet', inputSchema: { type: 'object' } }],
      { content: [{ type: 'text', text: 'hello' }], structuredContent: { greeting: 'hello' } },
    )
    await syncTools(client as never, host, defaultOpts, new Map())

    const definition = host.registered.get('mcp__srv__greet')!
    const value = await definition.execute({ name: 'x' }, { signal: testToolSignal }) as { content: unknown[]; structuredContent?: unknown }

    expect(client.callTool).toHaveBeenCalled()
    expect(value.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(value.structuredContent).toEqual({ greeting: 'hello' })
  })

  it('throws on an isError result so the registry produces an error outcome', async () => {
    const host = createFakeHost()
    const client = createMockClient(
      [{ name: 'bad', inputSchema: { type: 'object' } }],
      { content: [{ type: 'text', text: 'boom' }], isError: true },
    )
    await syncTools(client as never, host, defaultOpts, new Map())

    const definition = host.registered.get('mcp__srv__bad')!
    await expect(definition.execute({}, { signal: testToolSignal })).rejects.toThrow('boom')
  })

  it('rejects tools that require task-based execution', async () => {
    const host = createFakeHost()
    const client = createMockClient([
      { name: 'tasky', inputSchema: { type: 'object' }, execution: { taskSupport: 'required' } },
    ])
    await syncTools(client as never, host, defaultOpts, new Map())

    const definition = host.registered.get('mcp__srv__tasky')!
    await expect(definition.execute({}, { signal: testToolSignal })).rejects.toThrow(/task-based execution/)
  })
})

// ---- transport construction ----

const { constructedOptions, constructedUrls, clientConnectFailures } = vi.hoisted(() => {
  const constructedOptions: Array<Record<string, unknown>> = []
  const constructedUrls: Array<string> = []
  /** Queued one-shot errors the mocked Client's next connect() rejects with. */
  const clientConnectFailures: Error[] = []
  return { constructedOptions, constructedUrls, clientConnectFailures }
})

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: class {
    onclose: (() => void) | undefined = undefined
    request = vi.fn(async (request: { method: string }) => {
      if (request.method === 'tools/list') return { tools: [], nextCursor: undefined }
      if (request.method === 'tools/call') return { content: [] }
      throw new Error(`unexpected MCP request: ${request.method}`)
    })
    setNotificationHandler = vi.fn()
    connect = vi.fn(async () => {
      const failure = clientConnectFailures.shift()
      if (failure !== undefined) throw failure
    })
    close = vi.fn(async () => { this.onclose?.() })
  },
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class { start = vi.fn(async () => {}); send = vi.fn(); close = vi.fn(async () => {}) },
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    url: URL
    options: Record<string, unknown>
    finishAuth = vi.fn(async () => {})
    constructor(url: URL, options?: Record<string, unknown>) {
      this.url = url
      this.options = options ?? {}
      constructedUrls.push(url.toString())
      constructedOptions.push(this.options)
    }
  },
}))

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class {
    url: URL
    options: Record<string, unknown>
    finishAuth = vi.fn(async () => {})
    constructor(url: URL, options?: Record<string, unknown>) {
      this.url = url
      this.options = options ?? {}
      constructedUrls.push(url.toString())
      constructedOptions.push(this.options)
    }
  },
}))

function httpConfig(auth?: { enabled: boolean; scope?: string }): Config {
  return {
    transport: 'streamable-http',
    serverName: 'srv',
    url: 'https://mcp.example/mcp',
    headers: {},
    ...(auth === undefined ? {} : { auth }),
    toolCallTimeoutMs: 60_000,
    failOnStartupError: false,
  }
}

beforeEach(() => {
  constructedOptions.length = 0
  constructedUrls.length = 0
})

describe('transport construction with auth', () => {
  it('wires a provider when auth is enabled and carries the scope', () => {
    const { oauthProvider: provider } = createTransport(httpConfig({ enabled: true, scope: 'repo' }), undefined, () => {})
    expect(provider).toBeDefined()
    expect(provider!.clientMetadata.client_name).toBe('DeepSeek Harness (dsh-agent-plugins-market)')
    // Default loopback: ephemeral port placeholder until the listener binds.
    expect(provider!.redirectUrl).toBe('http://127.0.0.1:0/callback')
    expect(provider!.clientMetadata.scope).toBe('repo')
  })

  it('attempts OAuth silently without any auth declaration', () => {
    const { oauthProvider } = createTransport(httpConfig())
    expect(oauthProvider).toBeDefined()
  })

  it('skips the provider when the headers already carry a static Authorization', () => {
    const config = { ...httpConfig(), headers: { Authorization: 'Bearer static-token' } } as Config
    const { oauthProvider } = createTransport(config)
    expect(oauthProvider).toBeUndefined()
  })

  it('skips the provider on an explicit opt-out', () => {
    const { oauthProvider } = createTransport({ ...httpConfig(), auth: { enabled: false } } as Config)
    expect(oauthProvider).toBeUndefined()
  })

  it('binds the streamable-http transport so finishAuth completes inside the generation', () => {
    const { transport, oauthProvider } = createTransport(httpConfig({ enabled: true }), undefined)
    expect(constructedUrls[0]).toBe('https://mcp.example/mcp')
    expect(constructedOptions[0]).toHaveProperty('authProvider')
    // The provider's bound transport is the handed-out generation.
    expect(transport).toBeDefined()
    expect(oauthProvider).toBeDefined()
  })

  it('uses the mounted credentials service so state can persist', () => {
    const store = {
      describeRecord: async () => ({ configured: false, writable: true }),
      readRecord: async () => undefined,
      modifyRecord: async (_key: string, mutate: (current: unknown) => Promise<unknown>) => mutate(undefined),
    }
    const { oauthProvider: provider } = createTransport(httpConfig({ enabled: true }), store)
    expect((provider as unknown as { store: unknown }).store).toBe(store)
  })

  it('builds an sse transport with the configured headers and OAuth provider', () => {
    const config: Config = {
      transport: 'sse',
      serverName: 'legacy',
      url: 'https://mcp.example/sse',
      headers: { 'x-custom': 'yes' },
      auth: { enabled: true },
      toolCallTimeoutMs: 60_000,
      failOnStartupError: true,
    }
    const { transport, oauthProvider } = createTransport(config, undefined)
    expect(constructedUrls[0]).toBe('https://mcp.example/sse')
    expect((constructedOptions[0]['requestInit'] as Record<string, unknown>)['headers']).toEqual({ 'x-custom': 'yes' })
    expect(constructedOptions[0]).toHaveProperty('authProvider')
    expect(oauthProvider).toBeDefined()
    expect(transport).toBeDefined()
  })

  it('builds a stdio transport without an OAuth provider', () => {
    const config: Config = {
      transport: 'stdio',
      serverName: 'local',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-everything'],
      env: {},
      cwd: '',
      toolCallTimeoutMs: 60_000,
      failOnStartupError: true,
    }
    const { oauthProvider } = createTransport(config, undefined)
    expect(oauthProvider).toBeUndefined()
  })
})

// ---- bridge plugin shell ----

/** A fake cordis context: effects run immediately and their disposers are collected. */
function fakeContext(options: { credentials?: unknown } = {}): Context & { effects: Array<() => void> } {
  const effects: Array<() => void> = []
  const tools = { register: () => () => {} }
  const ctx = {
    root: {},
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    effect(fn: () => unknown) {
      const teardown = fn()
      if (typeof teardown === 'function') effects.push(teardown)
    },
    tools,
    ...(options.credentials === undefined ? {} : { get: (name: string) => (name === 'credentials' ? options.credentials : undefined) }),
  }
  return Object.assign(ctx, { effects }) as Context & { effects: Array<() => void> }
}

describe('bridge apply', () => {
  it('activates against a mock transport and wires the OAuth provider', async () => {
    const ctx = fakeContext()
    await apply(ctx, httpConfig({ enabled: true }))
    expect(constructedUrls[0]).toBe('https://mcp.example/mcp')
    expect(constructedOptions[0]).toHaveProperty('authProvider')
    await Promise.all(ctx.effects.map(dispose => dispose()))
  })

  it('fails the instance when failOnStartupError is set and the initial connection fails', async () => {
    const ctx = fakeContext()
    const failingConfig: Config = { ...httpConfig(), url: 'https://down.example/mcp', failOnStartupError: true }
    clientConnectFailures.push(new Error('connection refused'))

    await expect(apply(ctx, failingConfig)).rejects.toThrow(/initial connection or tool synchronization failed/)
  })

  it('rejects a duplicate serverName before any connection work', async () => {
    const ctx = fakeContext()
    await apply(ctx, httpConfig())
    await expect(apply(ctx, httpConfig())).rejects.toThrow(/already in use/)
    await Promise.all(ctx.effects.map(dispose => dispose()))
  })

  it('rejects a misconfigured serverName before any connection work', async () => {
    const ctx = fakeContext()
    await expect(apply(ctx, { ...httpConfig(), serverName: 'not valid!' } as Config)).rejects.toThrow(/serverName/)
  })
})
