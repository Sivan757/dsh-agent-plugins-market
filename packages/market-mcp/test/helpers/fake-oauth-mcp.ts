/**
 * Functional harness for the MCP OAuth browser leg: a loopback authorization
 * server that enforces the same redirect-URI rules as Cloudflare's
 * `@cloudflare/workers-oauth-provider`, the MCP resource endpoint it protects,
 * an in-memory credential record store, and a browser opener that drives the
 * authorization endpoint instead of launching a real browser.
 *
 * The redirect-URI rules are the point of the fixture. A loopback redirect may
 * vary its port per attempt (RFC 8252 §7.3), so the server accepts any port for
 * a registered loopback URI — but the token request must repeat the exact URI
 * the authorization request used (RFC 6749 §4.1.3). `workers-oauth-provider`
 * checks that after the code, client, and PKCE proofs match, and answers
 * `invalid_grant: redirect_uri does not match the authorization request`.
 *
 * @module test/helpers/fake-oauth-mcp
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { BrowserOpener } from '../../../../packages/market-mcp/src/runtime/mcp/bridge/oauth.js'

/** One registered OAuth client (RFC 7591 dynamic registration). */
interface FakeClient {
  redirectUris: string[]
}

/** One authorization grant, keyed by the code it hands out. */
interface FakeGrant {
  clientId: string
  redirectUri: string
  codeChallenge: string
  codeChallengeMethod: string
  used: boolean
}

/** What one `/authorize` request carried. */
export interface FakeAuthorization {
  clientId: string
  redirectUri: string
  state: string | null
  scope: string | null
}

/** What one `/token` request carried, and why it failed when it did. */
export interface FakeTokenRequest {
  grantType: string | null
  code: string | null
  redirectUri: string | null
  error?: string
}

/** The loopback authorization server and MCP resource server. */
export interface FakeOAuthMcpServer {
  /** Shared origin of the authorization server and the MCP endpoint, as `mcp.cloudflare.com` is. */
  origin: string
  /** Streamable HTTP MCP endpoint that answers `401` until a token is presented. */
  mcpUrl: string
  authorizations: FakeAuthorization[]
  tokenRequests: FakeTokenRequest[]
  registrations: Array<{ clientId: string; redirectUris: string[] }>
  /** Drop every issued access token so the next request challenges again. */
  revokeAccessTokens(): void
  close(): Promise<void>
}

/** In-memory credential record store, the shape the OAuth provider narrows at runtime. */
export interface MemoryCredentialStore {
  records: Map<string, unknown>
  describeRecord(key: string): Promise<{ configured: boolean; writable: boolean }>
  readRecord(key: string): Promise<unknown>
  modifyRecord(key: string, mutate: (current: unknown) => Promise<unknown>): Promise<unknown>
  deleteRecord(key: string): Promise<void>
}

/** A credential store that keeps OAuth grants for the lifetime of one test. */
export function createMemoryCredentialStore(): MemoryCredentialStore {
  const records = new Map<string, unknown>()
  return {
    records,
    describeRecord: async key => ({ configured: records.has(key), writable: true }),
    readRecord: async key => records.get(key),
    modifyRecord: async (key, mutate) => {
      const next = await mutate(records.get(key))
      records.set(key, next)
      return next
    },
    deleteRecord: async key => {
      records.delete(key)
    }
  }
}

/** RFC 8252 §7.3: only a loopback URI may swap its port. */
function isLoopback(url: URL): boolean {
  return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === 'localhost')
}

/** Whether `requestUri` is registered, allowing a loopback URI to vary its port. */
function redirectUriAllowed(requestUri: string, registered: readonly string[]): boolean {
  let requested: URL
  try {
    requested = new URL(requestUri)
  } catch {
    return false
  }
  return registered.some(candidate => {
    if (!isLoopback(requested)) return requestUri === candidate
    let known: URL
    try {
      known = new URL(candidate)
    } catch {
      return false
    }
    if (!isLoopback(known)) return false
    return requested.protocol === known.protocol && requested.hostname === known.hostname && requested.pathname === known.pathname && requested.search === known.search
  })
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function respondJson(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers })
  response.end(body)
}

/** One MCP tool the protected endpoint advertises. */
const ADVERTISED_TOOLS = [
  {
    name: 'api_read',
    description: 'Read one account resource',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  }
]

/**
 * Start the fake authorization server and MCP endpoint on one loopback port.
 * @returns The live server; close it when the test ends.
 */
export async function startFakeOAuthMcpServer(): Promise<FakeOAuthMcpServer> {
  const clients = new Map<string, FakeClient>()
  const grants = new Map<string, FakeGrant>()
  const accessTokens = new Set<string>()
  const authorizations: FakeAuthorization[] = []
  const tokenRequests: FakeTokenRequest[] = []
  const registrations: Array<{ clientId: string; redirectUris: string[] }> = []
  let origin = ''

  const server = createServer((request, response) => {
    void handle(request, response).catch((error: unknown) => {
      respondJson(response, 500, { error: 'server_error', error_description: String(error) })
    })
  })

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', origin)
    const path = url.pathname

    if (path.startsWith('/.well-known/oauth-protected-resource')) {
      respondJson(response, 200, {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ['user:read', 'account:read'],
        resource_name: 'Fake Cloudflare MCP Server'
      })
      return
    }
    if (path.startsWith('/.well-known/oauth-authorization-server')) {
      respondJson(response, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        scopes_supported: ['user:read', 'account:read']
      })
      return
    }
    if (path === '/register' && request.method === 'POST') {
      const metadata = JSON.parse(await readBody(request)) as { redirect_uris?: unknown }
      const redirectUris = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris.filter((uri): uri is string => typeof uri === 'string') : []
      if (redirectUris.length === 0) {
        respondJson(response, 400, { error: 'invalid_client_metadata', error_description: 'redirect_uris is required and must not be empty' })
        return
      }
      const clientId = randomUUID()
      clients.set(clientId, { redirectUris })
      registrations.push({ clientId, redirectUris })
      respondJson(response, 201, {
        client_id: clientId,
        redirect_uris: redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code']
      })
      return
    }
    if (path === '/authorize' && request.method === 'GET') {
      const clientId = url.searchParams.get('client_id') ?? ''
      const redirectUri = url.searchParams.get('redirect_uri') ?? ''
      const client = clients.get(clientId)
      if (client === undefined) {
        respondJson(response, 400, { error: 'invalid_client', error_description: 'unknown client_id' })
        return
      }
      if (!redirectUriAllowed(redirectUri, client.redirectUris)) {
        respondJson(response, 400, { error: 'invalid_request', error_description: 'Invalid redirect_uri' })
        return
      }
      const state = url.searchParams.get('state')
      if (url.searchParams.get('deny') === '1') {
        // The user clicked "Deny": the server answers the redirect with an OAuth error.
        authorizations.push({ clientId, redirectUri, state, scope: url.searchParams.get('scope') })
        const denied = new URL(redirectUri)
        denied.searchParams.set('error', 'access_denied')
        denied.searchParams.set('error_description', 'The user denied the request')
        if (state !== null) denied.searchParams.set('state', state)
        response.writeHead(302, { location: denied.toString() })
        response.end()
        return
      }
      const code = ['fake-user', randomUUID(), randomBytes(8).toString('hex')].join(':')
      grants.set(code, {
        clientId,
        redirectUri,
        codeChallenge: url.searchParams.get('code_challenge') ?? '',
        codeChallengeMethod: url.searchParams.get('code_challenge_method') ?? 'S256',
        used: false
      })
      authorizations.push({ clientId, redirectUri, state, scope: url.searchParams.get('scope') })
      const location = new URL(redirectUri)
      location.searchParams.set('code', code)
      if (state !== null) location.searchParams.set('state', state)
      response.writeHead(302, { location: location.toString() })
      response.end()
      return
    }
    if (path === '/token' && request.method === 'POST') {
      const form = new URLSearchParams(await readBody(request))
      const grantType = form.get('grant_type')
      const redirectUri = form.get('redirect_uri')
      const code = form.get('code')
      const record: FakeTokenRequest = { grantType, code, redirectUri }
      tokenRequests.push(record)
      const fail = (description: string): void => {
        record.error = description
        respondJson(response, 400, { error: 'invalid_grant', error_description: description })
      }
      if (grantType === 'refresh_token') {
        const refreshToken = form.get('refresh_token') ?? ''
        if (!refreshToken.startsWith('refresh-')) {
          fail('Invalid refresh token')
          return
        }
        const accessToken = randomBytes(24).toString('base64url')
        accessTokens.add(accessToken)
        respondJson(response, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: refreshToken, scope: 'user:read' })
        return
      }
      if (grantType !== 'authorization_code') {
        record.error = 'unsupported_grant_type'
        respondJson(response, 400, { error: 'unsupported_grant_type', error_description: `unsupported grant type ${String(grantType)}` })
        return
      }
      if ((code ?? '').split(':').length !== 3) {
        fail('Invalid authorization code format')
        return
      }
      const grant = grants.get(code ?? '')
      if (grant === undefined) {
        fail('Grant not found or authorization code expired')
        return
      }
      if (grant.clientId !== (form.get('client_id') ?? '')) {
        fail('Client ID mismatch')
        return
      }
      if (grant.used) {
        fail('Authorization code already used')
        return
      }
      if (redirectUri !== null && !redirectUriAllowed(redirectUri, clients.get(grant.clientId)?.redirectUris ?? [])) {
        fail('Invalid redirect URI')
        return
      }
      // The rule that broke the bridge: the token request repeats the exact
      // redirect_uri of the authorization request (RFC 6749 §4.1.3).
      if (redirectUri !== null && redirectUri !== grant.redirectUri) {
        fail('redirect_uri does not match the authorization request')
        return
      }
      const verifier = form.get('code_verifier')
      if (verifier === null) {
        fail('code_verifier is required for PKCE')
        return
      }
      if (createHash('sha256').update(verifier).digest('base64url') !== grant.codeChallenge) {
        fail('Invalid PKCE code_verifier')
        return
      }
      grant.used = true
      const accessToken = randomBytes(24).toString('base64url')
      accessTokens.add(accessToken)
      respondJson(response, 200, { access_token: accessToken, token_type: 'Bearer', expires_in: 3600, refresh_token: `refresh-${grant.clientId}`, scope: 'user:read' })
      return
    }
    if (path === '/mcp' && request.method === 'POST') {
      const authorization = request.headers['authorization']
      if (typeof authorization !== 'string' || !accessTokens.has(authorization.replace(/^Bearer /i, ''))) {
        response.writeHead(401, {
          'content-type': 'application/json',
          'www-authenticate': `Bearer realm="OAuth", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="user:read"`
        })
        response.end()
        return
      }
      const message = JSON.parse(await readBody(request)) as { id?: number | string; method?: string }
      if (message.id === undefined) {
        response.writeHead(202)
        response.end()
        return
      }
      if (message.method === 'initialize') {
        respondJson(
          response,
          200,
          {
            jsonrpc: '2.0',
            id: message.id,
            result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-cloudflare', version: '1.0.0' } }
          },
          { 'mcp-session-id': 'fake-session' }
        )
        return
      }
      if (message.method === 'tools/list') {
        respondJson(response, 200, { jsonrpc: '2.0', id: message.id, result: { tools: ADVERTISED_TOOLS } })
        return
      }
      respondJson(response, 200, { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Method not found: ${String(message.method)}` } })
      return
    }
    // No server-initiated SSE stream: the transport treats 405 as the expected answer.
    if (path === '/mcp') {
      response.writeHead(405)
      response.end()
      return
    }
    respondJson(response, 404, { error: 'not_found' })
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('the fake OAuth server did not bind a TCP port'))
        return
      }
      origin = `http://127.0.0.1:${address.port}`
      resolve()
    })
  })

  return {
    origin,
    mcpUrl: `${origin}/mcp`,
    authorizations,
    tokenRequests,
    registrations,
    revokeAccessTokens: () => accessTokens.clear(),
    close: async () => {
      server.closeAllConnections?.()
      await new Promise<void>(resolve => {
        server.close(() => {
          resolve()
        })
      })
    }
  }
}

/** Bind a throwaway listener to learn a free port, then release it. */
export function reserveFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe: Server = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => {
          reject(new Error('no free port'))
        })
        return
      }
      probe.close(() => {
        resolve(address.port)
      })
    })
  })
}

/**
 * The "user agent" for tests: it requests the authorization endpoint and
 * follows the redirect to the loopback callback, failing loudly with the
 * server's own words when the flow does not complete.
 *
 * @param options - `delayMs` models a human who approves after the initialize timeout.
 * @returns A browser opener the provider accepts.
 */
export function fakeBrowserOpener(options: { delayMs?: number } = {}): BrowserOpener {
  return async authorizationUrl => {
    if (options.delayMs !== undefined) await new Promise(resolve => setTimeout(resolve, options.delayMs))
    const authorize = await fetch(authorizationUrl, { redirect: 'manual' })
    const location = authorize.headers.get('location')
    if (authorize.status !== 302 || location === null) {
      throw new Error(`the fake browser got ${authorize.status} from /authorize: ${(await authorize.text()).slice(0, 200)}`)
    }
    const callback = await fetch(location)
    const body = await callback.text()
    if (callback.status !== 200) throw new Error(`the fake browser got ${callback.status} from the loopback callback: ${body.trim()}`)
  }
}
