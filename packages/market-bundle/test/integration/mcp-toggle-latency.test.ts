/**
 * Behavior and latency of the MCP surface switch, through the real code.
 *
 * The owner's MCP servers are remote Streamable HTTP endpoints, so one mount
 * pass pays one network handshake per server. This file drives the real mount
 * registry, the real reconciler gates and the real surface-toggle route
 * against loopback endpoints that delay `initialize`, and states what the
 * switch must guarantee while it does so.
 *
 * Concurrency is asserted from recorded spans, not from wall-clock thresholds:
 * a pass that ran its servers one at a time peaks at one open handshake, and
 * the tests below require more. Durations are printed as evidence, and only the
 * switch budget is compared against time, because it is a time contract.
 *
 * The endpoint delay is `MARKET_MCP_PERF_HANDSHAKE_MS` (default 300), so the
 * numbers reproduce on a slower or faster machine.
 *
 * @module test/mcp-toggle-latency
 */
import { afterAll, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RuntimeReconciler } from '../../../../packages/market-runtime/src/runtime/core/reconciler.js'
import { ResourceFilterService } from '../../../../packages/market-runtime/src/runtime/host/resource-filter-service.js'
import { SurfaceToggleService } from '../../../../packages/market-runtime/src/runtime/host/surface-toggle-service.js'
import { mountSuiteRoutes } from '../../../../packages/market-bundle/src/routes.js'
import { createSharedMcpMount } from '../../../../packages/market-bundle/src/runtime-adapters.js'
import { effectiveSurfaces, type Suite } from '../../../../packages/market-contracts/src/model/types.js'
import type { LspMountPort, SharedMcpMountPort } from '../../../../packages/market-runtime/src/adapter-contracts.js'
import type { RuntimeDiagnostics } from '../../../../packages/market-runtime/src/runtime/core/reconciler.js'
import { startFakeStreamableMcpServer, peakOverlap, type FakeStreamableMcpServer, type Span } from './helpers/fake-streamable-mcp.js'

const HANDSHAKE_MS = Number(process.env['MARKET_MCP_PERF_HANDSHAKE_MS'] ?? 300)
const SERVER_COUNT = 3
/** One server's whole startup budget in the hanging-server case. */
const STARTUP_BUDGET_MS = 2_500
/** Teardown one fixture bridge spends before its disposer returns. */
const TEARDOWN_MS = 200

const measurements: Array<{ label: string; ms: number }> = []

function record(label: string, startedAt: number): number {
  const ms = performance.now() - startedAt
  measurements.push({ label, ms })
  return ms
}

afterAll(() => {
  if (measurements.length === 0) return
  const lines = measurements.map(row => '  ' + row.label + ': ' + row.ms.toFixed(0) + 'ms').join('\n')
  console.log('\nMCP switch latency, handshake delay ' + String(HANDSHAKE_MS) + 'ms, ' + String(SERVER_COUNT) + ' servers\n' + lines + '\n')
})

describe('MCP surface switch', () => {
  it('mounts every server of one pass at the same time, each exactly once', async () => {
    const harness = await createHarness()
    try {
      // One server's pass is the unit this harness costs, measured on the same
      // machine moments earlier. A three-server pass that took three units
      // would be serial; the assertion is a ratio, so it survives a slow host.
      const baseline = performance.now()
      await harness.reconciler.reconcile([harness.suites[0]!])
      const baselineMs = performance.now() - baseline
      await harness.reconciler.reconcile([])
      record('one pass, mount 1 server (baseline)', baselineMs)
      const before = harness.servers.map(server => server.initializes())

      const started = performance.now()
      const diagnostics = await harness.reconciler.reconcile(harness.suites)
      const passMs = record('one pass, mount ' + String(SERVER_COUNT) + ' servers', started)

      expect(diagnostics.mcp).toEqual([])
      expect(harness.tools.size).toBe(SERVER_COUNT)
      // Each server was asked exactly once by this pass.
      for (const [index, server] of harness.servers.entries()) expect(server.initializes() - (before[index] ?? 0)).toBe(1)

      // State, not timing: the handshakes genuinely overlapped. Serial work
      // peaks at one open handshake however fast the machine is.
      expect(peakOverlap(harness.spans())).toBeGreaterThan(1)
      // And one unit of work, not three: the pass is not one handshake deep per
      // server, whatever this host's constant cost is.
      expect(passMs).toBeLessThan(baselineMs * 2)

      // A repeat pass over the same suites must not touch a live mount.
      const settled = harness.servers.map(server => server.initializes())
      const again = performance.now()
      await harness.reconciler.reconcile(harness.suites)
      record('one pass, nothing to do', again)
      expect(harness.servers.map(server => server.initializes())).toEqual(settled)
    } finally {
      await harness.close()
    }
  })

  it('unmounts a batch at the same time', async () => {
    const harness = await createHarness({ teardownDelayMs: TEARDOWN_MS })
    try {
      await harness.reconciler.reconcile(harness.suites)
      expect(harness.tools.size).toBe(SERVER_COUNT)

      harness.clearTeardowns()
      const started = performance.now()
      await harness.reconciler.reconcile([])
      record('one pass, unmount ' + String(SERVER_COUNT) + ' servers, ' + String(TEARDOWN_MS) + 'ms teardown each', started)

      expect(harness.tools.size).toBe(0)
      expect(harness.registry.toolOwnership()).toEqual([])
      // State, not timing: two teardowns were open at once. A serial unmount
      // peaks at one however fast the host is.
      expect(peakOverlap(harness.teardowns())).toBeGreaterThan(1)
    } finally {
      await harness.close()
    }
  })

  it('answers the switch before a server that spends its whole startup budget', async () => {
    const harness = await createHarness({ hang: SERVER_COUNT - 1, startupTimeoutMs: STARTUP_BUDGET_MS })
    try {
      await harness.toggle('mcp', false)
      expect(harness.tools.size).toBe(0)

      const started = performance.now()
      await harness.toggle('mcp', true)
      const answerMs = record('surface-toggle route, mcp on, one server hangs for ' + String(STARTUP_BUDGET_MS) + 'ms', started)

      // State: the route answered while the pass it started was still running.
      expect(harness.passRunning()).toBe(true)
      // Time: it answered on its own budget, not the server's.
      expect(answerMs).toBeLessThan(STARTUP_BUDGET_MS)

      // The pass keeps running and reports the failed server.
      const diagnostics = await harness.passSettled()
      expect(diagnostics.mcp).toContainEqual(expect.objectContaining({ code: 'mount-failed' }))
      // The healthy servers are live, and the hung one left no tools behind.
      expect(harness.tools.size).toBe(SERVER_COUNT - 1)
      expect(harness.registry.toolOwnership().map(row => row.suiteId)).not.toContain('perf/suite' + String(SERVER_COUNT - 1))
    } finally {
      await harness.close()
    }
  })

  it('leaves healthy servers mounted when another surface gate flips', async () => {
    const harness = await createHarness()
    try {
      await harness.reconciler.reconcile(harness.suites)
      expect(harness.tools.size).toBe(SERVER_COUNT)

      harness.gates.lsp = false
      await harness.reconciler.reconcile(harness.suites)
      harness.gates.lsp = true
      await harness.reconciler.reconcile(harness.suites)

      // No handshake repeated: an unrelated switch cannot restart a live mount.
      for (const server of harness.servers) expect(server.initializes()).toBe(1)
      expect(harness.tools.size).toBe(SERVER_COUNT)

      // The MCP switch itself is a real unmount and remount, once each.
      harness.gates.mcp = false
      await harness.reconciler.reconcile(harness.suites)
      expect(harness.tools.size).toBe(0)
      harness.gates.mcp = true
      await harness.reconciler.reconcile(harness.suites)
      for (const server of harness.servers) expect(server.initializes()).toBe(2)
      expect(harness.tools.size).toBe(SERVER_COUNT)
    } finally {
      await harness.close()
    }
  })

  it('reports a failed server and leaves no mount behind', async () => {
    const harness = await createHarness()
    try {
      await harness.servers[0]?.close()

      const diagnostics = await harness.reconciler.reconcile(harness.suites)

      expect(diagnostics.mcp).toContainEqual(expect.objectContaining({ suiteId: 'perf/suite0', code: 'mount-failed' }))
      // The other servers mounted, and the failed one owns no namespace.
      expect(harness.tools.size).toBe(SERVER_COUNT - 1)
      expect(harness.registry.toolOwnership().map(row => row.suiteId)).not.toContain('perf/suite0')
      expect(harness.registry.serverOwner('suite0__remote')).toBeUndefined()
    } finally {
      await harness.close()
    }
  })

  it('turns an unexpected throw inside one mount into a diagnostic and still finishes the batch', async () => {
    const harness = await createHarness()
    try {
      // A stdio mount creates its PLUGIN_DATA directory before connecting. A
      // regular file where that directory belongs makes the creation fail with
      // ENOTDIR, which throws inside mountWith rather than returning a failure
      // the registry already knows how to report. That is the shape a batch
      // lane can reject in, and no lane may take the pass with it.
      const broken = stdioSuite('blocked')
      await writeFile(join(harness.dataRoot, 'perf'), 'not a directory')

      const diagnostics = await harness.reconciler.reconcile([...harness.suites, broken])

      expect(diagnostics.mcp).toContainEqual(expect.objectContaining({ suiteId: 'perf/blocked', code: 'mount-failed' }))
      // The rest of the batch mounted: one throw did not abort its siblings.
      expect(harness.tools.size).toBe(SERVER_COUNT)
      expect(harness.registry.serverOwner('blocked__local')).toBeUndefined()

      // And the next pass still tears everything down, so no straggler left a
      // live mount behind the failing pass.
      await harness.reconciler.reconcile([])
      expect(harness.tools.size).toBe(0)
      expect(harness.registry.toolOwnership()).toEqual([])
    } finally {
      await harness.close()
    }
  })

  it('mounts a duplicate that takes over a serverName its winner could not claim', async () => {
    // The first claimant hangs for its whole budget, so the name is free after
    // the additions batch. Settling the claim statically without a second
    // attempt would leave the server unmounted for good.
    const harness = await createHarness({ hang: 0, startupTimeoutMs: STARTUP_BUDGET_MS })
    try {
      const copy = await harness.startServer({ handshakeDelayMs: 10 })
      const winner = harness.suites[0]!
      const duplicate: Suite = { ...winner, sourceId: 'other', mcp: { ...winner.mcp!, servers: { remote: { type: 'streamable-http', url: copy.url, headers: {} } } } }

      const diagnostics = await harness.reconciler.reconcile([winner, duplicate, ...harness.suites.slice(1)])

      expect(diagnostics.mcp).toContainEqual(expect.objectContaining({ suiteId: 'perf/suite0', code: 'mount-failed' }))
      // Exactly one copy ended up owning the name, and it is the one that answered.
      expect(harness.registry.serverOwner('suite0__remote')).toEqual({ suiteId: 'other/suite0', serverKey: 'remote' })
      expect(harness.tools.size).toBe(SERVER_COUNT)
      expect(harness.servers[0]?.initializes()).toBe(1)
    } finally {
      await harness.close()
    }
  })

  it('mounts sibling servers of one suite in the same batch', async () => {
    // The guard reads the live tool registry, so two servers of one suite must
    // not be able to see each other there. Server names are
    // `<suite>__<key>` after sanitization, and sanitizeToken collapses
    // underscore runs, so no derived name is another derived name plus "__".
    // That makes sibling namespaces disjoint and the batch order-independent.
    const harness = await createHarness()
    try {
      const both = multiServerSuite({ x: harness.servers[0]!.url, x__y: harness.servers[1]!.url })

      const diagnostics = await harness.reconciler.reconcile([both])

      expect(diagnostics.mcp).toEqual([])
      // "x__y" sanitizes to "x_y", so the two namespaces cannot prefix one another.
      expect(harness.registry.serverOwner('a__x')).toEqual({ suiteId: 'perf/a', serverKey: 'x' })
      expect(harness.registry.serverOwner('a__x_y')).toEqual({ suiteId: 'perf/a', serverKey: 'x__y' })
      expect(harness.tools.size).toBe(2)
    } finally {
      await harness.close()
    }
  })

  it('still reports a namespace another MCP client owns', async () => {
    const harness = await createHarness()
    try {
      harness.registry.setToolNamesProvider(() => ['mcp__suite0__remote__probe'])
      const diagnostics = await harness.reconciler.reconcile([harness.suites[0]!])

      expect(diagnostics.mcp).toContainEqual(expect.objectContaining({ code: 'foreign-mount' }))
      expect(harness.tools.size).toBe(0)
    } finally {
      await harness.close()
    }
  })

  it('answers the surface-toggle route for the mcp key in both directions', async () => {
    const harness = await createHarness()
    try {
      await harness.toggle('mcp', false)

      const enabling = performance.now()
      await harness.toggle('mcp', true)
      record('surface-toggle route, mcp on', enabling)
      expect(harness.tools.size).toBe(SERVER_COUNT)

      const disabling = performance.now()
      await harness.toggle('mcp', false)
      record('surface-toggle route, mcp off', disabling)
      expect(harness.tools.size).toBe(0)
    } finally {
      await harness.close()
    }
  })
})

interface HarnessOptions {
  /** Index of the server that accepts `initialize` and never answers it. */
  hang?: number
  /** Declared per-server startup timeout, which bounds a hanging handshake. */
  startupTimeoutMs?: number
  /** Teardown one fixture bridge spends before its disposer returns. */
  teardownDelayMs?: number
}

interface Harness {
  registry: SharedMcpMountPort
  reconciler: RuntimeReconciler
  suites: Suite[]
  servers: FakeStreamableMcpServer[]
  gates: { mcp: boolean; lsp: boolean }
  toggles: { mcp: boolean }
  tools: Map<string, unknown>
  /** The plugin data root, for a test that needs to make one path unwritable. */
  dataRoot: string
  /** Start one more endpoint the harness closes with the rest. */
  startServer(options?: { handshakeDelayMs?: number }): Promise<FakeStreamableMcpServer>
  /** Every `initialize` span the suite's servers recorded. */
  spans(): Span[]
  /** Teardown spans recorded since the last {@link clearTeardowns}. */
  teardowns(): Span[]
  clearTeardowns(): void
  /** Whether the pass the last switch scheduled is still running. */
  passRunning(): boolean
  /** Flip one surface switch through the registered route handler. */
  toggle(key: 'mcp', enabled: boolean): Promise<void>
  /** Wait for the pass the last switch scheduled, and return its diagnostics. */
  passSettled(): Promise<RuntimeDiagnostics>
  close(): Promise<void>
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const servers: FakeStreamableMcpServer[] = []
  for (let index = 0; index < SERVER_COUNT; index += 1) {
    servers.push(await startFakeStreamableMcpServer({ handshakeDelayMs: HANDSHAKE_MS, ...(options.hang === index ? { hangHandshake: true } : {}) }))
  }

  const teardowns: Span[] = []
  const { ctx, tools } = mountContext(options.teardownDelayMs ?? 0, teardowns)
  const dataRoot = await mkdtemp(join(tmpdir(), 'mcp-toggle-latency-'))
  const registry = createSharedMcpMount(ctx, dataRoot)
  const reconciler = new RuntimeReconciler(ctx, dataRoot, { mcp: registry, lsp: stubLsp() })

  const suites = servers.map((server, index) => streamableSuite('suite' + String(index), 'remote', server.url, options.startupTimeoutMs))
  const gates = { mcp: true, lsp: true }
  reconciler.setSurfaceGates({ allows: surface => (surface === 'lsp' ? gates.lsp : gates.mcp) })

  // The composition root's chain: the policy write is the durable part, and
  // the hook is what reconciles the mounts against it.
  let pass: Promise<RuntimeDiagnostics> = Promise.resolve(emptyDiagnostics())
  let running = false
  const filters = new ResourceFilterService(dataRoot, '/workspace/perf', {
    onFiltersChanged: async () => {
      gates.mcp = filters.currentToggles().mcp
      running = true
      pass = reconciler.reconcile(suites)
      try {
        await pass
      } finally {
        running = false
      }
    }
  })
  await filters.reload()
  const routes = mountToggleRoutes(new SurfaceToggleService(filters))

  return {
    registry,
    reconciler,
    suites,
    servers,
    gates,
    toggles: gates,
    tools,
    dataRoot,
    startServer: async serverOptions => {
      const started = await startFakeStreamableMcpServer({ handshakeDelayMs: serverOptions?.handshakeDelayMs ?? HANDSHAKE_MS })
      servers.push(started)
      return started
    },
    spans: () => servers.flatMap(server => server.initializeSpans()),
    teardowns: () => [...teardowns],
    clearTeardowns: () => {
      teardowns.length = 0
    },
    passRunning: () => running,
    toggle: async (key, enabled) => {
      await postToggle(routes, { key, enabled })
    },
    passSettled: async () => await pass,
    close: async () => {
      await reconciler.dispose()
      for (const server of servers) await server.close()
    }
  }
}

/** A context whose dynamic mounts run the real bridge plugin. */
function mountContext(teardownDelayMs: number, teardowns: Span[]): { ctx: Context; tools: Map<string, unknown> } {
  const ctx = new Context()
  const tools = new Map<string, unknown>()
  ctx.provide('tools', {
    register: (definition: { name: string }) => {
      tools.set(definition.name, definition)
      return () => {
        tools.delete(definition.name)
      }
    }
  })
  const mount = ctx.plugin.bind(ctx)
  ;(ctx as unknown as Record<string, unknown>)['plugin'] = (plugin: unknown, config: Record<string, unknown>) => {
    const fiber = mount(plugin as Plugin, config)
    return {
      await: async () => {
        await fiber
      },
      dispose: async () => {
        const span: Span = { start: performance.now(), end: Number.POSITIVE_INFINITY }
        teardowns.push(span)
        if (teardownDelayMs > 0) await new Promise(resolve => setTimeout(resolve, teardownDelayMs))
        await fiber.dispose()
        span.end = performance.now()
      }
    }
  }
  return { ctx, tools }
}

function emptyDiagnostics(): RuntimeDiagnostics {
  return { mcp: [], commands: [], hooks: [], lsp: [], errors: [] }
}

function stubLsp(): LspMountPort {
  return {
    setPluginDataRoot: () => {},
    setDirectProvider: () => {},
    setDisabledProvider: () => {},
    setEntryFilter: () => {},
    setDemandedProviderIdsProvider: () => {},
    globalDisabledProviderIds: async () => new Set<string>(),
    providerOwnership: () => [],
    ownsTool: () => false,
    reconcile: async () => [],
    disposeAll: async () => {},
    disabledProviderIds: async () => new Set<string>(),
    providers: () => []
  } as unknown as LspMountPort
}

function streamableSuite(id: string, serverKey: string, url: string, startupTimeoutMs?: number): Suite {
  return {
    sourceId: 'perf',
    id,
    root: '/tmp/perf/' + id,
    manifest: { layout: 'agent-plugin-v1', path: '/tmp/perf/' + id + '/plugin.json', id, name: id },
    skills: [],
    mcp: {
      schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
      servers: { [serverKey]: { type: 'streamable-http', url, headers: {}, ...(startupTimeoutMs === undefined ? {} : { startupTimeoutMs }) } }
    },
    surfaces: { skills: 0, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 0 },
    dimension: 'user',
    enabled: true,
    activeSurfaces: effectiveSurfaces(undefined),
    errors: []
  }
}

/** One suite whose servers are the supplied loopback endpoints, keyed by declared server key. */
function multiServerSuite(urls: Record<string, string>): Suite {
  const servers = Object.fromEntries(Object.entries(urls).map(([key, url]) => [key, { type: 'streamable-http' as const, url, headers: {} }]))
  return { ...streamableSuite('a', 'x', urls['x'] ?? ''), mcp: { schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', servers } }
}

/** One stdio suite whose PLUGIN_DATA directory is created under the data root. */
function stdioSuite(id: string): Suite {
  return {
    ...streamableSuite(id, 'local', 'unused'),
    mcp: { schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json', servers: { local: { type: 'stdio', command: 'true' } } }
  }
}

type ToggleRoutes = Map<string, { handler: (request: unknown, response: unknown) => void }>

function mountToggleRoutes(service: SurfaceToggleService): ToggleRoutes {
  const routes: ToggleRoutes = new Map()
  const host = {
    webServer: {
      register(entry: { path: string; handler: (request: unknown, response: unknown) => void }): () => void {
        routes.set(entry.path, { handler: entry.handler })
        return () => routes.delete(entry.path)
      }
    }
  }
  mountSuiteRoutes(host, {} as never, undefined, service)
  return routes
}

/** Drive the registered POST handler the way the host does, then read its answer. */
async function postToggle(routes: ToggleRoutes, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const handler = routes.get('/api/agent-plugins/surface-toggles/set')?.handler
  if (handler === undefined) throw new Error('the surface-toggle route is not registered')
  let payload = ''
  const request = {
    method: 'POST',
    url: '/api/agent-plugins/surface-toggles/set',
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
    on: (event: string, listener: (chunk?: unknown) => void) => {
      if (event === 'data') listener(Buffer.from(JSON.stringify(body), 'utf8'))
      if (event === 'end') listener()
    },
    destroy: () => {}
  }
  const response = {
    writeHead: () => {},
    end: (value: string) => {
      payload = value
    }
  }
  handler(request, response)
  for (let attempt = 0; payload === '' && attempt < 8000; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5))
  if (payload === '') throw new Error('the surface-toggle route never answered')
  return JSON.parse(payload) as Record<string, unknown>
}
