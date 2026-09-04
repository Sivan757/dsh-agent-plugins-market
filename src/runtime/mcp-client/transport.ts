/**
 * Transport factory: creates the appropriate MCP transport based on the
 * bridge's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL; legacy SSE connects to a
 * URL with the pre-Streamable-HTTP protocol pairing. Both HTTP transports
 * carry OAuth 2.1 authorization by default, activated by the server's first
 * `401` challenge.
 *
 * @module runtime/mcp-client/transport
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { scrubbedParentEnv } from './host-seams.js'
import { LoopbackOAuthClientProvider } from './oauth.js'
import type { Config, SseConfig, StreamableHttpConfig } from './config.js'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/** A transport that can complete an OAuth browser leg inside its own generation. */
type AuthCapableTransport = Transport & { finishAuth(code: string): Promise<void> }

/** Whether the headers carry a static `Authorization` (a token flow, not OAuth). */
function hasStaticAuthorization(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(key => key.toLowerCase() === 'authorization')
}

/**
 * Build the OAuth provider for one HTTP-based generation when the flow is
 * active. OAuth attempts silently by default: the provider only activates on
 * the server's 401 challenge, so servers without auth are unaffected. Skipped
 * when the config opts out or the headers already carry a static
 * Authorization.
 */
function buildOAuthProvider(config: StreamableHttpConfig | SseConfig, credentials: unknown, log: (message: string) => void): LoopbackOAuthClientProvider | undefined {
  const auth = config.auth
  if (auth?.enabled === false || hasStaticAuthorization(config.headers)) return undefined
  return new LoopbackOAuthClientProvider(config.serverName, auth?.storage ?? {}, auth?.scope, log, credentials)
}

/**
 * Create an MCP transport from the resolved bridge config.
 *
 * With OAuth active (the default), the Streamable HTTP and SSE transports
 * carry an {@link OAuthClientProvider}: the first `401` from the server
 * starts discovery, dynamic registration, and a loopback browser
 * authorization, and granted tokens persist through the credentials service
 * for later processes. Transport generation identity stays with the caller —
 * the provider binds whichever transport it hands out, so a reconnect builds
 * a fresh generation on the same durable state.
 *
 * @param config - Resolved bridge config discriminated on `transport`.
 * @param credentials - The composition's credential store, when mounted; OAuth
 *   state persists only when it is.
 * @param log - Diagnostic sink for the human leg of the flow.
 * @returns The transport plus its OAuth provider, when active — the
 *   supervisor queries the provider to hold the generation open while a
 *   browser leg is pending.
 */
export function createTransport(
  config: Config,
  credentials?: unknown,
  log: (message: string) => void = () => {}
): { transport: Transport; oauthProvider: LoopbackOAuthClientProvider | undefined } {
  switch (config.transport) {
    case 'stdio':
      return {
        transport: new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: buildChildEnv(config.env),
          cwd: config.cwd
        }),
        oauthProvider: undefined
      }
    case 'streamable-http': {
      const oauthProvider = buildOAuthProvider(config, credentials, log)
      // The MCP SDK's StreamableHTTPClientTransport has optional callback
      // properties typed without `| undefined` (exactOptionalPropertyTypes
      // mismatch with the Transport interface); the SDK constructed the
      // object, so the cast records only that widening. `finishAuth` is
      // public on the SDK class and completes the browser leg's code
      // exchange inside this transport generation.
      const transport = new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
        ...(oauthProvider === undefined ? {} : { authProvider: oauthProvider })
      }) as AuthCapableTransport
      oauthProvider?.bindTransport(transport)
      return { transport, oauthProvider }
    }
    case 'sse': {
      const oauthProvider = buildOAuthProvider(config, credentials, log)
      // The legacy SSE transport negotiates a separate endpoint POST channel.
      // The SDK applies `requestInit.headers` to both the stream request and
      // every endpoint POST (its `_commonHeaders` merge), so no separate
      // `eventSourceInit` headers wiring is needed — and omitting it keeps
      // the SDK's automatic Authorization injection on 401 retries intact.
      const transport = new SSEClientTransport(new URL(config.url), {
        requestInit: { headers: config.headers },
        ...(oauthProvider === undefined ? {} : { authProvider: oauthProvider })
      }) as AuthCapableTransport
      oauthProvider?.bindTransport(transport)
      return { transport, oauthProvider }
    }
  }
}
