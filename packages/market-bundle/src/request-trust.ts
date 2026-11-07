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
 * The host applies this same rule to its own bridge, at
 * `packages/client/connection/src/api-request-trust.ts:121`. Three checks, in order:
 *
 * 1. `Host` must name an authority this deployment serves: loopback, the
 *    listener's own bind address, or an entry of the host's trust list. A
 *    rebound page carries the attacker's domain there even though the socket
 *    lands here, and that domain is in none of the three.
 * 2. `sec-fetch-site: cross-site` is refused outright. Modern browsers label
 *    the initiator on every fetch, and a cross-site marker is decisive.
 * 3. When `Origin` is present it must equal `Host`. An absent `Origin` is
 *    allowed because the `Host` fence already bound the request, and a
 *    non-browser client sends no `Origin`.
 *
 * A sandboxed iframe or a `file:` page sends the literal `null`, which is an
 * opaque origin from somewhere else, so it is refused rather than parsed.
 *
 * The trust list is the host's, not ours: a deployment that serves this port
 * under a domain name declares that name once, with `--trusted-host` or the
 * plugin that registers arriving hosts, and the host's own fence accepts it.
 * Reading the same list keeps the two fences in agreement instead of making
 * this one stricter than the deployment it runs inside. With no host trust
 * list available — an older harness, or none configured — the accepted set is
 * loopback and the bind address only, which is the rule this module always
 * applied.
 * @module request-trust
 */
import type { IncomingMessage } from 'node:http'

/** Hostnames that mean this machine. A rebound request cannot carry one of these. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

/**
 * The authorities this deployment serves, read from the host that owns the fence.
 *
 * Both halves are optional because the host may not expose either: a missing
 * `connection` service means no deployment trust list, and a host that does not
 * publish its bind address simply contributes none.
 */
export interface RequestTrust {
  /** Authorities the host trusts beyond loopback: an exact `host:port`, or a port-less `host` matching any port. */
  trustedHosts?: readonly string[]
  /** The listener's own bind address, accepted on any port independently of `trustedHosts`. */
  bindHost?: string
}

/**
 * Read the deployment's trust from the host services a route context carries.
 *
 * Both reads are lazy and repeated per call by the caller, because the host
 * appends to `trustedHosts` while it runs: a name registered after this plugin
 * mounted must be accepted without a restart. A context without `get` is a
 * host this module cannot ask, so it contributes no trust.
 * @param ctx - the route context; `get` is the host's own service lookup.
 * @returns the trust to hand to {@link isTrustedMutation}.
 */
export function requestTrustOf(ctx: { get?(name: string): unknown } | undefined): RequestTrust {
  const connection = ctx?.get?.('connection') as { trustedHosts?: readonly string[] } | undefined
  const server = ctx?.get?.('webServer') as { host?: string } | undefined
  return { trustedHosts: connection?.trustedHosts, bindHost: server?.host }
}

/**
 * Parse an authority the way `URL` does, keeping the port separate.
 *
 * `new URL()` needs a scheme, and a `Host` header has none, so the parse goes
 * through a fixed base and the result is only ever read for hostname and port.
 * @param authority - a `host` or `host:port` string.
 * @returns the parsed parts, or undefined when the text is not an authority.
 */
function parseAuthority(authority: string): { hostname: string; port: string } | undefined {
  try {
    const url = new URL('http://' + authority)
    return { hostname: url.hostname, port: url.port }
  } catch (error) {
    // Unparsable authority text is a request we cannot reason about, which is not
    // the same as a trusted one.
    if (error instanceof TypeError) return undefined
    throw error
  }
}

/**
 * Whether one `trustedHosts` entry names the request authority.
 *
 * An entry with a port matches that exact authority; a port-less entry matches
 * the hostname on any port. This is the host's own reading of its list, so the
 * two fences accept the same shapes.
 * @param authority - the parsed `Host`.
 * @param entry - one configured authority.
 * @returns true when the entry names the authority.
 */
function matchesTrustedAuthority(authority: { hostname: string; port: string }, entry: string): boolean {
  const parsed = parseAuthority(entry)
  if (parsed === undefined) return false
  if (parsed.hostname !== authority.hostname) return false
  return parsed.port === '' || parsed.port === authority.port
}

/**
 * Whether the authority names the listener's own bind address.
 *
 * A browser dialing that literal sends it as `Host`, which grants nothing
 * further: the Origin and cross-site checks still apply. Any `%zone` id is an
 * interface selector rather than address text, so it is dropped first.
 * @param hostname - the parsed `Host` hostname.
 * @param bindHost - the listener's bind address, when the host publishes one.
 * @returns true when the two name the same address.
 */
function isBindAddress(hostname: string, bindHost: string | undefined): boolean {
  if (bindHost === undefined) return false
  const zoneAt = bindHost.indexOf('%')
  const address = zoneAt === -1 ? bindHost : bindHost.slice(0, zoneAt)
  const parsed = parseAuthority(address.includes(':') ? `[${address}]` : address)
  return parsed !== undefined && parsed.hostname === hostname
}

/**
 * Whether the request authority is one this deployment serves.
 * @param authority - the parsed `Host`.
 * @param trust - the deployment trust; empty means loopback only.
 * @returns true when the authority is loopback, the bind address, or trusted.
 */
function isServedAuthority(authority: { hostname: string; port: string }, trust: RequestTrust): boolean {
  if (LOOPBACK_HOSTNAMES.has(authority.hostname)) return true
  if (isBindAddress(authority.hostname, trust.bindHost)) return true
  return trust.trustedHosts?.some(entry => matchesTrustedAuthority(authority, entry)) ?? false
}

/**
 * Decide whether one request may run a mutating route.
 *
 * @param request - the incoming request; its headers are the only evidence.
 * @param trust - the deployment trust; omit it to accept loopback only.
 * @returns true only when the request provably came from a page this deployment serves.
 */
export function isTrustedMutation(request: IncomingMessage, trust: RequestTrust = {}): boolean {
  const host = request.headers['host']
  if (host === undefined) return false
  const authority = parseAuthority(host)
  if (authority === undefined) return false
  // The `Host` fence. A name outside the deployment's trust list is either a
  // rebound page or a page we do not serve; neither may mutate this profile.
  if (!isServedAuthority(authority, trust)) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers['origin']
  if (origin === undefined) return true
  if (origin === 'null') return false
  const from = parseAuthority(stripScheme(origin))
  return from !== undefined && from.hostname === authority.hostname && from.port === authority.port
}

/**
 * Drop a scheme from an Origin value so it parses like a Host value.
 *
 * An Origin carries a scheme and never a path, so removing the scheme is enough
 * to compare it with Host. A value with a path is not an Origin this server
 * issued, and it fails to parse as an authority, which then refuses it.
 * @param origin - the Origin header value.
 * @returns the authority text, unchanged when it carries no scheme.
 */
function stripScheme(origin: string): string {
  const at = origin.indexOf('://')
  return at === -1 ? origin : origin.slice(at + 3)
}
