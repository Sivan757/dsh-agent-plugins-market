/**
 * OAuth 2.1 authorization-code support for Streamable HTTP (and legacy SSE)
 * MCP servers that answer `401` with an OAuth challenge (`WWW-Authenticate:
 * Bearer resource_metadata="…"` — the MCP authorization spec's discovery
 * anchor).
 *
 * The SDK owns the protocol: its `auth()` helper performs RFC 9728 protected-
 * resource discovery, authorization-server metadata lookup, RFC 7591 dynamic
 * client registration, PKCE, token exchange, and refresh, and the HTTP
 * transports invoke it on the first `401` through the
 * {@link OAuthClientProvider} this module implements. This module owns the two
 * parts the SDK leaves to the application: durable storage of client and token
 * state, and the human leg of the flow — a loopback redirect that captures
 * the authorization code without caller-side wiring.
 *
 * Tokens and registered client information persist as a `grant` credential
 * record under `mcp-auth/<serverName>` through the harness credentials seam
 * when one is mounted, so they land in the managed `.credentials.yaml`
 * document (mode `0600`, file-locked, refresh-safe across processes) and are
 * visible to the same surface that manages every other credential. Without a
 * credentials service the provider still completes flows in memory; tokens
 * then last exactly as long as the process.
 *
 * Ported from the harness `dsh-mcp-client` OAuth implementation (upstream
 * commits archived at `docs/upstream-proposal/patches/`); the record format is
 * byte-compatible, so grants written by either implementation are interchangeable.
 *
 * @module runtime/mcp-client/oauth
 */

import { createServer, type IncomingMessage, type Server } from 'node:http'
import { type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformation,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import { credentialKey, scrubbedParentEnv, type CredentialKey, type CredentialRecordStore } from './host-seams.js'
import type { OAuthStorageConfig } from './config.js'

/** OAuth client identity presented during dynamic registration. */
const CLIENT_NAME = 'DeepSeek Harness (dsh-agent-plugins-market)'
/** Software id/version advertised in RFC 7591 registration metadata. */
const CLIENT_SOFTWARE_ID = 'dsh-agent-plugins-market'
const CLIENT_SOFTWARE_VERSION = '0.1.0'
/** Credential-record scope for MCP OAuth state; per-server ids follow it. */
export const MCP_AUTH_RECORD_SCOPE = 'mcp-auth'
/** Loopback callback budget: the browser must land within five minutes. */
const CALLBACK_TIMEOUT_MS = 5 * 60_000

/**
 * Fold a `serverName` into a credential-key id segment. Server names carry
 * `__` separators (e.g. `cloudflare__cloudflare-api`), and the key grammar
 * admits only `[a-z0-9-]`, so non-conforming characters collapse to `-` —
 * deterministic, so the same server always reads and writes one record. Two
 * servers colliding after the fold is impossible in practice (the separator
 * plus an existing `-` would have to differ); a collision would surface as
 * two servers sharing one token store, not as a crash.
 */
function credentialIdFor(serverName: string): string {
  const folded = serverName.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '')
  return folded === '' ? 'server' : folded
}

/** Credential record this module persists, when the store is available. */
interface McpAuthRecord {
  kind: 'grant'
  payload: {
    clientInformation?: OAuthClientInformation
    tokens?: OAuthTokens
  }
}

/** Full provider state: the durable payload plus the process-local PKCE verifier. */
interface ProviderState {
  clientInformation?: OAuthClientInformation
  tokens?: OAuthTokens
  /** PKCE verifier saved between the redirect and the callback; never persisted. */
  codeVerifier?: string
}

/** Narrow a stored record payload into this module's shape; anything else reads as absent. */
function asMcpAuthRecord(record: unknown): McpAuthRecord['payload'] | undefined {
  if (typeof record !== 'object' || record === null) return undefined
  const candidate = record as { kind?: unknown; payload?: unknown }
  if (candidate.kind !== 'grant' || typeof candidate.payload !== 'object' || candidate.payload === null) return undefined
  const payload = candidate.payload as { clientInformation?: unknown; tokens?: unknown }
  return {
    ...(payload.clientInformation === undefined ? {} : { clientInformation: payload.clientInformation as OAuthClientInformation }),
    ...(payload.tokens === undefined ? {} : { tokens: payload.tokens as OAuthTokens }),
  }
}

/**
 * Error thrown when the human leg fails or is abandoned: the browser never
 * returned, the callback carried an OAuth error, or no browser could open.
 * The transport surfaces it from `connect`; the supervisor's reconnect loop
 * re-enters the flow — which reopens the browser — on a later attempt.
 */
export class AuthorizationAbortedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AuthorizationAbortedError'
  }
}

/** Opens the platform browser; injected in tests to record the URL instead. */
export type BrowserOpener = (authorizationUrl: URL, serverName: string, log: (message: string) => void) => Promise<void>

/** The real opener: platform browser or default URL handler. */
export const platformBrowserOpener: BrowserOpener = async (authorizationUrl, serverName, log) => {
  const platform = process.platform
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', authorizationUrl.toString()] : [authorizationUrl.toString()]
  const { spawn } = await import('node:child_process')
  const child = spawn(command, args, {
    stdio: 'ignore',
    env: scrubbedParentEnv(),
    detached: platform !== 'win32',
  })
  child.once('error', (error) => {
    log(`${serverName}: could not open a browser automatically (${String(error)}); open this URL manually: ${authorizationUrl.toString()}`)
  })
  child.once('spawn', () => { child.unref() })
}

/**
 * {@link OAuthClientProvider} over the harness credentials seam (or process
 * memory when the seam is absent), with a loopback redirect that opens the
 * system browser.
 */
export class LoopbackOAuthClientProvider implements OAuthClientProvider {
  private readonly recordKey: CredentialKey
  /** Credential store mounted in this composition; absence means memory-only. */
  private readonly store: CredentialRecordStore | undefined
  /** In-memory fallback and cache over the store's durable state. */
  private providerState: ProviderState = {}
  /** The transport generation whose `finishAuth` completes the browser leg. */
  private activeTransport: { finishAuth(code: string): Promise<void> } | undefined
  /** Resolves `true` when the leg saved tokens, `false` when it failed; undefined while no leg is open. */
  private browserLegSettled: PromiseWithResolvers<boolean> | undefined
  private callbackServer: Server | undefined
  private callbackTimer: NodeJS.Timeout | undefined
  private boundPort: number | undefined
  /** Serializes store writes so a rapid refresh cannot interleave read-modify-writes. */
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly serverName: string,
    private readonly storage: OAuthStorageConfig,
    private readonly scope: string | undefined,
    private readonly log: (message: string) => void,
    store: unknown,
    private readonly opener: BrowserOpener = platformBrowserOpener,
  ) {
    this.recordKey = credentialKey(MCP_AUTH_RECORD_SCOPE, credentialIdFor(serverName))
    this.store = typeof (store as Partial<CredentialRecordStore> | undefined)?.modifyRecord === 'function'
      ? store as CredentialRecordStore
      : undefined
  }

  get redirectUrl(): string {
    // RFC 8252 §7.3: loopback redirects may vary the port per request, so the
    // bound port is filled in when the listener starts and registration
    // metadata always reflects the current attempt's URL.
    return `http://127.0.0.1:${this.boundPort ?? this.storage.callbackPort ?? 0}/callback`
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: CLIENT_NAME,
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      // Public client: PKCE carries the proof; no client secret exists.
      token_endpoint_auth_method: 'none',
      ...(this.scope === undefined ? {} : { scope: this.scope }),
      software_id: CLIENT_SOFTWARE_ID,
      software_version: CLIENT_SOFTWARE_VERSION,
    }
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.load()).clientInformation
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    await this.mutate((state) => { state.clientInformation = clientInformation })
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.load()).tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.mutate((state) => {
      state.tokens = tokens
      // The verifier is single-use by spec; the exchange consumed it.
      delete state.codeVerifier
    })
  }

  /**
   * Bind the loopback server, open the browser, and complete the code
   * exchange into the bound transport generation. Resolves only after tokens
   * are saved; an OAuth `error` redirect, a timeout, or a listener failure
   * rejects with {@link AuthorizationAbortedError}.
   */
  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    const transport = this.activeTransport
    if (transport === undefined) {
      throw new AuthorizationAbortedError(`${this.serverName}: no active transport to complete authorization into`)
    }
    this.browserLegSettled = Promise.withResolvers()
    let succeeded = false
    try {
      const code = await this.awaitCallback(authorizationUrl)
      await transport.finishAuth(code)
      succeeded = true
      return
    } finally {
      this.browserLegSettled?.resolve(succeeded)
      this.browserLegSettled = undefined
    }
  }

  /** Whether a browser leg is open and the code exchange is still pending. */
  get awaitingBrowser(): boolean {
    return this.browserLegSettled !== undefined
  }

  /**
   * Resolves once the pending browser leg finishes (tokens saved or the leg
   * failed); undefined while no leg is open. The supervisor holds the
   * connection generation — instead of timing out and respawning, which would
   * abandon the leg the user is mid-way through approving — until this
   * settles.
   */
  get browserLeg(): Promise<boolean> | undefined {
    return this.browserLegSettled?.promise
  }

  /**
   * Register the transport generation whose `finishAuth` completes the flow.
   * The transport calls `redirectToAuthorization` during `connect`; binding
   * it here keeps the code exchange inside the generation that owns the
   * connection, per the SDK's per-connection session model.
   */
  bindTransport(transport: { finishAuth(code: string): Promise<void> }): void {
    this.activeTransport = transport
  }

  /** Abandon any previously bound browser leg before a new one starts. */
  resetCallback(): void {
    if (this.callbackTimer !== undefined) {
      clearTimeout(this.callbackTimer)
      this.callbackTimer = undefined
    }
    this.callbackServer?.close(() => undefined)
    this.callbackServer = undefined
    this.boundPort = undefined
  }

  saveCodeVerifier(codeVerifier: string): Promise<void> {
    // The verifier only needs to survive the browser leg; keeping it out of
    // the durable record removes a secret that has no value after the exchange.
    this.providerState.codeVerifier = codeVerifier
    return Promise.resolve()
  }

  codeVerifier(): Promise<string> {
    const verifier = this.providerState.codeVerifier
    if (verifier === undefined) {
      return Promise.reject(new AuthorizationAbortedError(`${this.serverName}: no PKCE verifier is stored for this authorization attempt`))
    }
    return Promise.resolve(verifier)
  }

  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    // The SDK invalidates selectively on refresh failures; dropping the whole
    // record is always safe because discovery and registration re-run cheaply.
    if (scope === 'tokens') {
      await this.mutate((state) => { delete state.tokens })
      return
    }
    if (scope === 'verifier') {
      delete this.providerState.codeVerifier
      return
    }
    await this.mutate((state) => {
      if (scope === 'client') delete state.clientInformation
      if (scope === 'all') {
        delete state.tokens
        delete state.clientInformation
      }
      // `discovery` is not persisted by this provider; nothing to drop.
    })
  }

  // ---- Durable state through the credentials seam ----

  private async load(): Promise<ProviderState> {
    if (this.store === undefined) return this.providerState
    // `describeRecord` reads the store; the record payload itself comes from
    // the same store's read path, re-narrowed on every access so an external
    // edit (or a second process's refresh) is picked up immediately.
    const described = await this.store.describeRecord(this.recordKey)
    if (!described.configured) return this.providerState
    const record = await this.store.readRecord(this.recordKey)
    const payload = asMcpAuthRecord(record)
    if (payload === undefined) {
      // The record exists but is not ours anymore (a foreign overwrite): the
      // durable fields drop from the view rather than reading stale.
      this.providerState = { ...(this.providerState.codeVerifier === undefined ? {} : { codeVerifier: this.providerState.codeVerifier }) }
      return this.providerState
    }
    // The durable record is authoritative: the view is rebuilt from it, so an
    // external edit that replaced or dropped a field drops it from the view
    // too; the process-local PKCE verifier is the only non-durable field.
    const verifier = this.providerState.codeVerifier
    this.providerState = { ...payload, ...(verifier === undefined ? {} : { codeVerifier: verifier }) }
    return this.providerState
  }

  private async mutate(mutator: (state: ProviderState) => void): Promise<void> {
    const run = this.writeChain.then(async () => {
      await this.load()
      mutator(this.providerState)
      if (this.store === undefined) return
      const record: McpAuthRecord = {
        kind: 'grant',
        payload: {
          ...(this.providerState.clientInformation === undefined ? {} : { clientInformation: this.providerState.clientInformation }),
          ...(this.providerState.tokens === undefined ? {} : { tokens: this.providerState.tokens }),
        },
      }
      await this.store.modifyRecord(this.recordKey, () => Promise.resolve(record))
    })
    // A failed write must not poison the chain; the caller's rejection is the
    // signal, and the next write re-reads whatever is durable now.
    this.writeChain = run.catch(() => {})
    return run
  }

  // ---- Loopback callback leg ----

  /**
   * Bind a loopback listener, open the browser at `authorizationUrl` (its
   * `redirect_uri` is rewritten to the bound port), and resolve with the code
   * the user agent lands back with.
   */
  private awaitCallback(authorizationUrl: URL): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const server = createServer((request) => {
        this.handleCallbackRequest(request, server, resolve, reject)
      })
      server.on('error', (error) => {
        this.clearCallbackTimer()
        reject(new AuthorizationAbortedError(`${this.serverName}: loopback callback server failed: ${String(error)}`))
      })
      server.listen(this.storage.callbackPort ?? 0, '127.0.0.1', () => {
        const address = server.address()
        if (address === null || typeof address === 'string') {
          server.close(() => undefined)
          reject(new AuthorizationAbortedError(`${this.serverName}: loopback callback server did not bind a TCP port`))
          return
        }
        this.boundPort = address.port
        this.callbackServer = server
        authorizationUrl.searchParams.set('redirect_uri', this.redirectUrl)
        this.log(`${this.serverName}: opening the browser for MCP authorization — approve access in the page that opens`)
        void this.opener(authorizationUrl, this.serverName, this.log)
        this.callbackTimer = setTimeout(() => {
          this.resetCallback()
          reject(new AuthorizationAbortedError(
            `${this.serverName}: authorization was not completed within ${CALLBACK_TIMEOUT_MS / 60_000} minutes — open the server's page again or retry the mount`,
          ))
        }, CALLBACK_TIMEOUT_MS)
        this.callbackTimer.unref()
      })
    })
  }

  private handleCallbackRequest(
    request: IncomingMessage,
    server: Server,
    resolve: (code: string) => void,
    reject: (error: Error) => void,
  ): void {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const oauthError = url.searchParams.get('error')
    const code = url.searchParams.get('code')
    const respond = (status: number, message: string): void => {
      // Drain the request, then answer with a plain page the user can close.
      request.resume()
      request.socket.end(
        `HTTP/1.1 ${status} ${status === 200 ? 'OK' : 'Bad Request'}\r\n`
        + 'content-type: text/plain; charset=utf-8\r\nconnection: close\r\n\r\n'
        + `${message}\n`,
      )
      request.on('close', () => { server.close(() => undefined) })
    }
    this.clearCallbackTimer()
    this.callbackServer = undefined
    this.boundPort = undefined
    if (oauthError !== null) {
      const description = url.searchParams.get('error_description') ?? ''
      respond(400, `Authorization failed: ${oauthError}${description === '' ? '' : ` — ${description}`}`)
      reject(new AuthorizationAbortedError(
        `${this.serverName}: the authorization server returned "${oauthError}"${description === '' ? '' : ` (${description})`}`,
      ))
      return
    }
    if (code === null || code === '') {
      respond(400, 'Authorization callback arrived without a code.')
      reject(new AuthorizationAbortedError(`${this.serverName}: the authorization callback carried no code`))
      return
    }
    respond(200, 'Authorization received. You can close this page and return to DeepSeek Harness.')
    resolve(code)
  }

  private clearCallbackTimer(): void {
    if (this.callbackTimer !== undefined) {
      clearTimeout(this.callbackTimer)
      this.callbackTimer = undefined
    }
  }

}
