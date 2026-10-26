/**
 * A real Streamable HTTP MCP server on loopback, for latency measurement.
 *
 * It runs the MCP SDK's own server and transport rather than a hand-written
 * JSON-RPC stub, so the market bridge exercises the same handshake it runs
 * against a deployed server. The handshake delay models a remote endpoint:
 * the owner's three servers are network Streamable HTTP, where per-server
 * latency dominates a mount pass.
 *
 * Each `initialize` is recorded as a span, so a test can ask whether two
 * handshakes ran at the same time as a data question instead of comparing
 * wall-clock durations against a threshold.
 *
 * @module test/helpers/fake-streamable-mcp
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'

/** One `initialize` request as the endpoint lived it, on the `performance.now()` clock. */
export interface Span {
  /** When the request arrived. */
  start: number
  /** When the endpoint finished answering it. */
  end: number
}

/**
 * How many spans were open at the same moment.
 *
 * A data answer to "did these run at the same time", so a test never has to
 * compare wall-clock durations against a threshold. Serial work peaks at one.
 * @param spans - the recorded spans.
 * @returns the peak number of spans open at once.
 */
export function peakOverlap(spans: readonly Span[]): number {
  const edges = spans.flatMap(span => [
    { at: span.start, delta: 1 },
    { at: span.end, delta: -1 }
  ])
  // An end sorts before a start at the same instant, so touching spans do not
  // count as overlapping.
  edges.sort((left, right) => left.at - right.at || left.delta - right.delta)
  let open = 0
  let peak = 0
  for (const edge of edges) {
    open += edge.delta
    peak = Math.max(peak, open)
  }
  return peak
}

/** One loopback MCP endpoint and what it observed. */
export interface FakeStreamableMcpServer {
  /** Endpoint URL a bridge config points at. */
  url: string
  /** How many `initialize` requests the endpoint received. */
  initializes(): number
  /** Arrival time of each `initialize` request, as `performance.now()` reads it. */
  initializeTimes(): number[]
  /** Arrival and answer time of each `initialize` request. */
  initializeSpans(): Span[]
  /** Stop listening and drop every open socket. */
  close(): Promise<void>
}

export interface FakeStreamableMcpServerOptions {
  /** Delay before the endpoint answers `initialize`, in milliseconds. */
  handshakeDelayMs?: number
  /** Tool names the endpoint advertises. */
  tools?: string[]
  /**
   * Accept `initialize` and never answer it, modelling a server that burns its
   * whole startup budget. The socket stays open so the client's own startup
   * timeout is what ends the attempt.
   */
  hangHandshake?: boolean
}

/**
 * Start one endpoint on an ephemeral loopback port.
 * @param options - handshake delay, advertised tools, and the hang mode.
 * @returns the endpoint URL, its observation log, and a closer.
 */
export async function startFakeStreamableMcpServer(options: FakeStreamableMcpServerOptions = {}): Promise<FakeStreamableMcpServer> {
  const handshakeDelayMs = options.handshakeDelayMs ?? 0
  const tools = options.tools ?? ['probe']
  const spans: Span[] = []
  const sockets = new Set<import('node:net').Socket>()

  const server: Server = createServer((request, response) => {
    handle(request, response).catch(() => {
      // A fixture request that fails after its response closed is not a test
      // signal; the assertion that matters is what the client observed.
    })
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let body: unknown
    if (request.method === 'POST') body = await readJson(request)
    const method = (body as { method?: string } | undefined)?.method
    if (method === 'initialize') {
      // A hanging handshake stays open to its budget, so its end is unknowable
      // here. `Number.POSITIVE_INFINITY` keeps the span counting as open.
      const span: Span = { start: performance.now(), end: Number.POSITIVE_INFINITY }
      spans.push(span)
      if (options.hangHandshake === true) return
      if (handshakeDelayMs > 0) await new Promise(resolve => setTimeout(resolve, handshakeDelayMs))
      span.end = performance.now()
    }
    // Stateless mode: one server and transport per request, which is what the
    // SDK documents for `sessionIdGenerator: undefined`.
    const mcp = new McpServer({ name: 'latency-fixture', version: '1.0.0' })
    for (const name of tools) {
      mcp.registerTool(name, { description: 'fixture tool ' + name, inputSchema: {} }, async () => ({ content: [{ type: 'text', text: name }] }))
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    response.on('close', () => {
      // Teardown runs after the client already has its answer, so a failure
      // here has no observer left to report to.
      transport.close().catch(() => {})
      mcp.close().catch(() => {})
    })
    await mcp.connect(transport)
    await transport.handleRequest(request, response, body)
  }

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the fixture server did not bind a port')
  return {
    url: 'http://127.0.0.1:' + String(address.port) + '/mcp',
    initializes: () => spans.length,
    initializeTimes: () => spans.map(span => span.start),
    initializeSpans: () => spans.map(span => ({ ...span })),
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>(resolve => {
        server.close(() => resolve())
      })
    }
  }
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(undefined)
      }
    })
    request.on('error', () => resolve(undefined))
  })
}
