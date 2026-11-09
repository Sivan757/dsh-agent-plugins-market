/**
 * The one request-trust fence for every mutating route this plugin serves.
 *
 * A browser cannot read a cross-origin response, so a page on another site cannot
 * use our JSON API directly. DNS rebinding defeats that: the attacker's page is
 * served from a hostname that later resolves to 127.0.0.1, so the request is
 * same-origin for the browser and carries the attacker's hostname in `Host` and
 * `Origin` alike. Comparing the two is therefore not a fence: both are
 * attacker-chosen.
 *
 * The host applies this same rule to its own `/api` bridge, at
 * `packages/client/connection/src/api-request-trust.ts:121`. Three checks, in order:
 *
 * 1. `Host` must name this machine: a loopback hostname (`localhost`, `[::1]`, or
 *    any 127/8 address — the harness's own classifier, mirrored below), an entry
 *    of the host connection service's `trustedHosts` (an exact `host:port`, or a
 *    port-less `host` on any port), or the listener's bind address. A reverse proxy keeps
 *    the public `Host`, so a deployment that declared its name to the host must
 *    not be refused by a plugin mounted inside that same host, while a name it
 *    never declared is still refused (the #156 rebinding defense).
 * 2. `sec-fetch-site: cross-site` is refused outright. Modern browsers label
 *    the initiator on every fetch, and a cross-site marker is decisive.
 * 3. When `Origin` is present it must equal `Host`. An absent `Origin` is
 *    allowed because the `Host` fence already bound the request, and a
 *    non-browser client sends no `Origin`.
 *
 * The trusted entries and the bind address arrive through
 * {@link requestTrustAuthoritiesOf}, read from the host services per request.
 * Without a connection service — an older harness, a hand-built test context —
 * the accepted set degrades to loopback only, which is everything this fence
 * used to accept.
 *
 * A sandboxed iframe or a `file:` page sends the literal `null`, which is an
 * opaque origin from somewhere else, so it is refused rather than parsed.
 * @module request-trust
 */
import type { IncomingMessage } from 'node:http'

/**
 * Whether a WHATWG hostname names the local loopback authority.
 *
 * A byte-for-byte mirror of the harness classifier `isLoopbackHostname`
 * (`packages/client/connection/src/loopback-hostname.ts:12`): localhost, the
 * bracketed IPv6 loopback, or any IPv4 address in 127/8. Keeping the two fences
 * on one classifier is the same alignment as the trusted entries below — the
 * host accepts `127.0.0.2`, so a plugin inside that host may not refuse it —
 * and `0.0.0.0` is not loopback here either: a listener bound to it admits that
 * Host through the bind-address path, exactly like the host fence.
 * @param hostname - the parsed request hostname (IPv6 literals retain brackets).
 */
function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** The authorities a host deployment declares beyond loopback. */
export interface RequestTrustAuthorities {
  /** Entries of the host connection service's `trustedHosts`: exact `host:port`, or port-less `host` on any port. */
  trustedHosts: readonly string[]
  /** The listener's own bind address; matched by hostname on any port. */
  bindHost?: string
  /** The listener scheme, used to normalize default ports; HTTP when unknown. */
  protocol?: string
}

/** The one service read a host context exposes; read structurally, like every host port this plugin touches. */
type HostServiceGet = (name: string) => unknown

/**
 * Read the host's declared authorities out of the context a route mount already holds.
 *
 * The connection service keeps `trustedHosts` TypeScript-private and the web server
 * service carries the bind address, so both ride structural reads: there is no host
 * package dependency to import types from, mirroring the local `WebHost` precedent.
 * The services resolve at call time because they can provision after this plugin's
 * apply, and a context without them yields undefined, which the fence reads as
 * loopback-only.
 * @param host - the host context a route mount received, verbatim.
 * @returns the declared authorities, or undefined when the host declares none.
 */
export function requestTrustAuthoritiesOf(host: unknown): RequestTrustAuthorities | undefined {
  const get = (host as { get?: HostServiceGet } | null | undefined)?.get
  if (get === undefined) return undefined
  const connection = get.call(host, 'connection') as { trustedHosts?: readonly string[] } | undefined
  const webServer = get.call(host, 'webServer') as { host?: string; protocol?: string } | undefined
  const trustedHosts = Array.isArray(connection?.trustedHosts) ? connection.trustedHosts : []
  const bindHost = typeof webServer?.host === 'string' && webServer.host !== '' ? webServer.host : undefined
  if (trustedHosts.length === 0 && bindHost === undefined) return undefined
  return {
    trustedHosts,
    ...(bindHost === undefined ? {} : { bindHost }),
    ...(webServer?.protocol === undefined ? {} : { protocol: webServer.protocol })
  }
}

/**
 * Decide whether one request may run a mutating route.
 *
 * @param request - the incoming request; its headers are the only evidence of who sent it.
 * @param authorities - the host's declared authorities beyond loopback; undefined means loopback-only.
 * @returns true only when the request provably came from a source the deployment serves.
 */
export function isTrustedMutation(request: IncomingMessage, authorities?: RequestTrustAuthorities): boolean {
  const host = request.headers['host']
  if (host === undefined) return false
  // Host parses under the listener's scheme, like the host fence: that is what makes an
  // explicit default-port entry exact instead of a wildcard.
  const protocol = authorities?.protocol === 'https:' ? 'https:' : 'http:'
  const hostUrl = parseAuthority(host, protocol)
  if (hostUrl === undefined) return false
  // Loopback per the harness classifier. A non-loopback Host passes only when the host
  // deployment declared it: a `trustedHosts` entry or the listener's own bind address.
  // Everything else is still refused, so a rebound page's attacker domain gains nothing here.
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, authorities?.trustedHosts ?? [], protocol) && !isBindAddressAuthority(hostUrl, authorities?.bindHost))
    return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers['origin']
  if (origin === undefined) return true
  if (origin === 'null') return false
  // The Origin comparison keeps its own parse under plain HTTP: it weighs the browser's two
  // headers against each other, not the configured authorities, and is unchanged by the
  // accepted set above.
  const from = parseAuthority(stripScheme(origin))
  const authority = parseAuthority(host)
  return from !== undefined && authority !== undefined && from.hostname === authority.hostname && from.port === authority.port
}

/**
 * Parse an authority the way `URL` does.
 *
 * `new URL()` needs a scheme, and a `Host` header has none, so the parse goes through a
 * fixed special scheme and only the hostname and port are ever read.
 * @param authority - a `host` or `host:port` string.
 * @param scheme - the special scheme to parse under; its default port is the one stripped.
 * @returns the parsed URL, or undefined when the text is not an authority.
 */
function parseAuthority(authority: string, scheme: 'http:' | 'https:' = 'http:'): URL | undefined {
  try {
    return new URL(`${scheme}//${authority}`)
  } catch (error) {
    // Unparsable authority text is a request we cannot reason about, which is not
    // the same as a trusted one.
    if (error instanceof TypeError) return undefined
    throw error
  }
}

/**
 * Whether the request authority matches one of the host's `trustedHosts` entries.
 *
 * A mirror of the host fence's own matcher: an entry with an explicit port matches that
 * exact authority, a port-less entry matches the hostname on any port, and both sides
 * compare through WHATWG normalization, so case and a redundant scheme-default port never
 * decide trust. Explicitness is judged from parses under both special schemes, because
 * `:80` and `:443` are explicit ports that their own scheme's parser silently strips.
 * Whether an entry is well-formed is the host's load-time concern: the connection service
 * refuses malformed entries when it provisions, so only validated ones arrive here.
 * @param hostUrl - the parsed request authority.
 * @param trustedHosts - the entries as the host holds them.
 * @param protocol - the listener scheme, for default-port normalization.
 */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[], protocol: 'http:' | 'https:'): boolean {
  return trustedHosts.some(entry => {
    const entryUrl = parseAuthority(entry, protocol)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname ? entryUrl.hostname === hostUrl.hostname : entryUrl.host === hostUrl.host
  })
}

/**
 * Canonical form of a parsed configured entry: `hostname` when no port was written, else
 * `hostname:port`. The port is judged from parses under both special schemes, never from
 * the raw string, where WHATWG trimming would misread shapes like `host:port `.
 */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  const port = entryUrl.port !== '' ? entryUrl.port : (parseAuthority(entry, entryUrl.protocol === 'http:' ? 'https:' : 'http:')?.port ?? '')
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/**
 * Whether the request authority names the listener's own bind address, matched by hostname
 * on any port, like a port-less entry. A browser dialing that literal sends it as `Host`,
 * and accepting it grants nothing further: the literal is no rebinding target, and the
 * Origin and cross-site checks still apply. Any `%zone` id is an interface selector, not
 * address text, and is dropped first.
 */
function isBindAddressAuthority(hostUrl: URL, bindHost: string | undefined): boolean {
  if (bindHost === undefined) return false
  const zoneAt = bindHost.indexOf('%')
  const address = zoneAt === -1 ? bindHost : bindHost.slice(0, zoneAt)
  const bindUrl = parseAuthority(address.includes(':') ? `[${address}]` : address)
  return bindUrl !== undefined && bindUrl.hostname === hostUrl.hostname
}

/**
 * Drop a scheme from an Origin value so it parses like a Host value.
 *
 * An Origin carries a scheme and never a path, so removing the scheme is enough
 * to compare it with Host. A value carrying a path is not an Origin this server
 * issued, but the URL constructor drops the path silently instead of failing, so
 * such a value is compared on its hostname like any other; a genuine browser
 * Origin never carries one, so the comparison never sees this shape in practice.
 * @param origin - the Origin header value.
 * @returns the authority text, unchanged when it carries no scheme.
 */
function stripScheme(origin: string): string {
  const at = origin.indexOf('://')
  return at === -1 ? origin : origin.slice(at + 3)
}
