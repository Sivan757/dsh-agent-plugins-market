/**
 * Functional verification of MCP OAuth 2.1 over Streamable HTTP: a real MCP
 * SDK client, the bridge's real transport, the real loopback provider, and a
 * real HTTP authorization server that enforces the redirect-URI rules
 * Cloudflare's provider enforces. Nothing here stubs the SDK or the provider —
 * the browser leg is the only seam a test owns.
 *
 * The regression these tests pin: the token request must repeat the exact
 * `redirect_uri` of the authorization request (RFC 6749 §4.1.3) even when the
 * loopback listener picked its port per attempt (RFC 8252 §7.3). Publishing
 * port `0` instead made Cloudflare answer `invalid_grant: redirect_uri does
 * not match the authorization request`, which stored no token and re-opened a
 * browser window on every reconnect attempt.
 *
 * @module test/mcp-oauth-flow
 */
import { afterEach, describe, expect, it } from 'vitest'
import { resolveReconnectPolicy, startConnection } from '../../../packages/market-mcp/src/runtime/mcp/bridge/connection.js'
import type { ConnectionHandle } from '../../../packages/market-mcp/src/runtime/mcp/bridge/connection.js'
import { credentialKey } from '../../../packages/market-mcp/src/runtime/mcp/bridge/host-seams.js'
import type { BrowserOpener } from '../../../packages/market-mcp/src/runtime/mcp/bridge/oauth.js'
import type { ToolDefinition, ToolHost } from '../../../packages/market-mcp/src/runtime/mcp/bridge/host-contract.js'
import type { StreamableHttpConfig } from '../../../packages/market-mcp/src/application/mcp/mcp-bridge-config.js'
import {
  createMemoryCredentialStore,
  fakeBrowserOpener,
  reserveFreePort,
  startFakeOAuthMcpServer,
  type FakeOAuthMcpServer,
  type MemoryCredentialStore
} from './helpers/fake-oauth-mcp.js'

const RECONNECT = resolveReconnectPolicy({ initialDelayMs: 50, maxDelayMs: 200, maxAttempts: 2 }, 'test.reconnect')
const GRANT_KEY = String(credentialKey('mcp-auth', 'cloudflare-cloudflare'))
const PUBLIC_TOOL = 'mcp__cloudflare__cloudflare__api_read'
const SERVER_NAME = 'cloudflare__cloudflare'

/** Everything a test opened; closed in reverse order when the test ends. */
const open: Array<{ close(): Promise<void> }> = []

afterEach(async () => {
  while (open.length > 0) {
    const item = open.pop()
    if (item !== undefined) await item.close()
  }
})

interface Harness {
  server: FakeOAuthMcpServer
  store: MemoryCredentialStore
  host: ToolHost
  registered: Map<string, ToolDefinition>
  logs: string[]
  /** Start one supervised bridge; `overrides` patches the Streamable HTTP config. */
  start(overrides?: Partial<StreamableHttpConfig>, opener?: BrowserOpener): ConnectionHandle
}

async function harness(): Promise<Harness> {
  const server = await startFakeOAuthMcpServer()
  open.push(server)
  const store = createMemoryCredentialStore()
  const registered = new Map<string, ToolDefinition>()
  const logs: string[] = []
  const host: ToolHost = {
    logger: {
      error: message => logs.push(`error ${message}`),
      warn: message => logs.push(`warn ${message}`),
      info: message => logs.push(`info ${message}`)
    },
    tools: {
      register: definition => {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      }
    }
  }
  const start = (overrides: Partial<StreamableHttpConfig> = {}, opener?: BrowserOpener): ConnectionHandle => {
    const config: StreamableHttpConfig = {
      transport: 'streamable-http',
      serverName: SERVER_NAME,
      url: server.mcpUrl,
      headers: {},
      toolCallTimeoutMs: 5_000,
      failOnStartupError: false,
      startupTimeoutMs: 5_000,
      ...overrides
    }
    const handle = startConnection(host, config, RECONNECT, store, opener)
    open.push({ close: () => handle.dispose() })
    return handle
  }
  return { server, store, host, registered, logs, start }
}

/** The stored grant record's token fields, before any shape validation. */
function storedTokenFields(store: MemoryCredentialStore): { access_token?: unknown; refresh_token?: unknown } | undefined {
  const record = store.records.get(GRANT_KEY) as { payload?: { tokens?: { access_token?: unknown; refresh_token?: unknown } } } | undefined
  return record?.payload?.tokens
}

/** A browser that clicks "Deny": the authorization server redirects back with an OAuth error. */
function denyingBrowser(): BrowserOpener {
  return async authorizationUrl => {
    const denied = new URL(authorizationUrl)
    denied.searchParams.set('deny', '1')
    const authorize = await fetch(denied, { redirect: 'manual' })
    const location = authorize.headers.get('location')
    if (location === null) throw new Error(`denial did not redirect: ${authorize.status}`)
    const callback = await fetch(location)
    await callback.text()
  }
}

describe('Streamable HTTP OAuth over a real authorization server', () => {
  it('connects and lists tools after one authorization on the default ephemeral port', async () => {
    const h = await harness()
    const outcome = await h.start({}, fakeBrowserOpener()).ready

    expect(outcome.error).toBeUndefined()
    expect(h.registered.has(PUBLIC_TOOL)).toBe(true)
    // Registration advertises the port-0 placeholder; the authorization
    // request and the token exchange carry the port the listener actually got.
    expect(h.server.registrations[0]?.redirectUris).toEqual(['http://127.0.0.1:0/callback'])
    expect(h.server.authorizations[0]?.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(h.server.authorizations).toHaveLength(1)
    expect(h.server.tokenRequests).toHaveLength(1)
    expect(h.server.tokenRequests[0]?.error).toBeUndefined()
    expect(h.server.tokenRequests[0]?.redirectUri).toBe(h.server.authorizations[0]?.redirectUri)
    expect(storedTokenFields(h.store)?.access_token).toBeTypeOf('string')
    expect(storedTokenFields(h.store)?.refresh_token).toBeTypeOf('string')
    expect(h.logs.filter(line => /opening the browser/.test(line))).toHaveLength(1)
  }, 20_000)

  it('holds the attempt through a slow approval that outlives the initialize timeout', async () => {
    const h = await harness()
    const outcome = await h.start({ startupTimeoutMs: 300 }, fakeBrowserOpener({ delayMs: 700 })).ready

    expect(outcome.error).toBeUndefined()
    expect(h.registered.has(PUBLIC_TOOL)).toBe(true)
    expect(h.server.authorizations).toHaveLength(1)
    expect(h.server.tokenRequests[0]?.redirectUri).toBe(h.server.authorizations[0]?.redirectUri)
    expect(storedTokenFields(h.store)?.access_token).toBeTypeOf('string')
    expect(h.logs.some(line => /waiting for browser authorization/.test(line))).toBe(true)
  }, 20_000)

  it('stores no token when the user denies, then connects on a later attempt that approves', async () => {
    const h = await harness()
    const denied = h.start({ startupTimeoutMs: 2_000 }, denyingBrowser())
    const deniedOutcome = await denied.ready

    expect(deniedOutcome.error).toBeDefined()
    expect(storedTokenFields(h.store)).toBeUndefined()
    expect(h.registered.has(PUBLIC_TOOL)).toBe(false)
    expect(h.server.tokenRequests.filter(request => request.error === undefined)).toHaveLength(0)
    expect(h.logs.some(line => /authorization server returned "access_denied"/.test(line))).toBe(true)

    // Stop the failing supervisor before the recovering one starts, so the two
    // bridges cannot interleave their attempts against one authorization server.
    await denied.dispose()
    const recovered = await h.start({}, fakeBrowserOpener()).ready
    expect(recovered.error).toBeUndefined()
    expect(storedTokenFields(h.store)?.access_token).toBeTypeOf('string')
    expect(h.server.tokenRequests.filter(request => request.error === undefined)).toHaveLength(1)
    expect(h.registered.has(PUBLIC_TOOL)).toBe(true)
  }, 20_000)

  it('refreshes the stored grant instead of opening a second authorization window', async () => {
    const h = await harness()
    await h.start({}, fakeBrowserOpener()).ready
    expect(h.server.authorizations).toHaveLength(1)

    // The access token is no longer accepted, but the grant's refresh token is.
    h.server.revokeAccessTokens()
    const reconnected = await h.start({}, fakeBrowserOpener()).ready

    expect(reconnected.error).toBeUndefined()
    expect(h.server.authorizations).toHaveLength(1)
    expect(h.server.tokenRequests.filter(request => request.grantType === 'refresh_token').length).toBeGreaterThan(0)
    expect(h.registered.has(PUBLIC_TOOL)).toBe(true)
  }, 20_000)

  it('adopts one configured callback port for registration, authorization, and the exchange', async () => {
    const port = await reserveFreePort()
    const h = await harness()
    const callbackUrl = `http://127.0.0.1:${port}/callback`
    const outcome = await h.start({ auth: { storage: { callbackPort: port } } }, fakeBrowserOpener()).ready

    expect(outcome.error).toBeUndefined()
    expect(h.server.registrations[0]?.redirectUris).toEqual([callbackUrl])
    expect(h.server.authorizations[0]?.redirectUri).toBe(callbackUrl)
    expect(h.server.tokenRequests[0]?.redirectUri).toBe(callbackUrl)
  }, 20_000)
})
