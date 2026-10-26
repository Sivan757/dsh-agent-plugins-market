/**
 * Behavior and latency of the MCP surface switch, through the real code.
 *
 * The owner's MCP servers are remote Streamable HTTP endpoints, so one mount
 * pass pays one network handshake per server. This file drives the real mount
 * registry, the real reconciler gates, and the real surface-toggle route
 * against loopback endpoints that delay `initialize`, and states what the
 * switch must guarantee while it does so:
 *
 * - one pass mounts every server at the same time and never mounts one twice,
 * - a server that spends its whole startup budget does not hold the switch,
 * - flipping one surface leaves another surface's healthy mounts alone,
 * - a failed server is reported and leaves no mount behind.
 *
 * The endpoint delay is `MARKET_MCP_PERF_HANDSHAKE_MS` (default 300), so the
 * measured numbers reproduce on a slower or faster machine. Every measured
 * value is printed once at the end of the run.
 *
 * @module test/mcp-toggle-latency
 */
import { afterAll, describe, expect, it } from 'vitest'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import { mkdtemp } from 'node:fs/promises'
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
import { startFakeStreamableMcpServer, type FakeStreamableMcpServer } from './helpers/fake-streamable-mcp.js'

const HANDSHAKE_MS = Number(process.env['MARKET_MCP_PERF_HANDSHAKE_MS'] ?? 300)
const SERVER_COUNT = 3
/** Teardown a fixture bridge spends before its disposer returns. */
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
  it('mounts every server of one pass exactly once', async () => {
    const harness = await createHarness()
    try {
      const started = performance.now()
      const diagnostics = await harness.reconciler.reconcile(harness.suites)
      const passMs = record('one pass, mount ' + String(SERVER_COUNT) + ' servers', started)

      expect(diagnostics.mcp).toEqual([])
      expect(harness.tools.size).toBe(SERVER_COUNT)
      for (const server of harness.servers) expect(server.initializes()).toBe(1)

      void passMs

      // A repeat pass over the same suites must not touch a live mount.
      const again = performance.now()
      await harness.reconciler.reconcile(harness.suites)
      record('one pass, nothing to do', again)
      for (const server of harness.servers) expect(server.initializes()).toBe(1)
    } finally {
      await harness.close()
    }
  })

  it('unmounts every server when the suites go away', async () => {
    const harness = await createHarness({ teardownDelayMs: TEARDOWN_MS })
    try {
      await harness.reconciler.reconcile(harness.suites)
      expect(harness.tools.size).toBe(SERVER_COUNT)

      const started = performance.now()
      await harness.reconciler.reconcile([])
      const passMs = record('one pass, unmount ' + String(SERVER_COUNT) + ' servers, ' + String(TEARDOWN_MS) + 'ms teardown each', started)

      expect(harness.tools.size).toBe(0)
      expect(harness.registry.toolOwnership()).toEqual([])
      void passMs
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

  it('skips a duplicate serverName that arrives in the same pass, in wanted order', async () => {
    const harness = await createHarness()
    try {
      // Two sources shipping the same suite/server pair derive ONE serverName.
      // Both arrive in this single pass, so the winner must not depend on
      // which handshake finishes first.
      const duplicate = { ...harness.suites[0]!, sourceId: 'other' }
      const diagnostics = await harness.reconciler.reconcile([harness.suites[0]!, duplicate, ...harness.suites.slice(1)])

      expect(diagnostics.mcp).toContainEqual(expect.objectContaining({ suiteId: 'other/suite0', code: 'duplicate-mount' }))
      expect(harness.registry.serverOwner('suite0__remote')).toEqual({ suiteId: 'perf/suite0', serverKey: 'remote' })
      // One server per derived name, and the first arrival kept it.
      expect(harness.servers[0]?.initializes()).toBe(1)
      expect(harness.tools.size).toBe(SERVER_COUNT)
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
  /** Accept `initialize` on the last server and never answer it. */
  hanging?: boolean
  /** Declared per-server startup timeout, which bounds the hanging handshake. */
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
  /** Flip one surface switch through the registered route handler. */
  toggle(key: 'mcp', enabled: boolean): Promise<void>
  /** Wait for the pass the last switch scheduled, and return its diagnostics. */
  passSettled(): Promise<RuntimeDiagnostics>
  close(): Promise<void>
}

async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const servers: FakeStreamableMcpServer[] = []
  for (let index = 0; index < SERVER_COUNT; index += 1) {
    const hangs = options.hanging === true && index === SERVER_COUNT - 1
    servers.push(await startFakeStreamableMcpServer({ handshakeDelayMs: HANDSHAKE_MS, ...(hangs ? { hangHandshake: true } : {}) }))
  }

  const { ctx, tools } = mountContext(options.teardownDelayMs ?? 0)
  const dataRoot = await mkdtemp(join(tmpdir(), 'mcp-toggle-latency-'))
  const registry = createSharedMcpMount(ctx, dataRoot)
  const reconciler = new RuntimeReconciler(ctx, dataRoot, { mcp: registry, lsp: stubLsp() })

  const suites = servers.map((server, index) => streamableSuite('suite' + String(index), 'remote', server.url, options.startupTimeoutMs))
  const gates = { mcp: true, lsp: true }
  reconciler.setSurfaceGates({ allows: surface => (surface === 'lsp' ? gates.lsp : gates.mcp) })

  // The composition root's chain: the policy write is the durable part, and
  // the hook is what reconciles the mounts against it.
  let pass: Promise<RuntimeDiagnostics> = Promise.resolve(emptyDiagnostics())
  const filters = new ResourceFilterService(dataRoot, '/workspace/perf', {
    onFiltersChanged: async () => {
      gates.mcp = filters.currentToggles().mcp
      pass = reconciler.reconcile(suites)
      await pass
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
function mountContext(teardownDelayMs: number): { ctx: Context; tools: Map<string, unknown> } {
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
        if (teardownDelayMs > 0) await new Promise(resolve => setTimeout(resolve, teardownDelayMs))
        await fiber.dispose()
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
