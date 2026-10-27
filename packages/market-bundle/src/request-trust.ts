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
 * 1. `Host` must name this machine. A rebound page carries the attacker's
 *    domain there even though the socket lands here.
 * 2. `sec-fetch-site: cross-site` is refused outright. Modern browsers label
 *    the initiator on every fetch, and a cross-site marker is decisive.
 * 3. When `Origin` is present it must equal `Host`. An absent `Origin` is
 *    allowed because the `Host` fence already bound the request, and a
 *    non-browser client sends no `Origin`.
 *
 * A sandboxed iframe or a `file:` page sends the literal `null`, which is an
 * opaque origin from somewhere else, so it is refused rather than parsed.
 * @module request-trust
 */
import type { IncomingMessage } from 'node:http'

/** Hostnames that mean this machine. A rebound request cannot carry one of these. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0'])

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
 * Decide whether one request may run a mutating route.
 *
 * @param request - the incoming request; its headers are the only evidence.
 * @returns true only when the request provably came from this machine.
 */
export function isTrustedMutation(request: IncomingMessage): boolean {
  const host = request.headers['host']
  if (host === undefined) return false
  const authority = parseAuthority(host)
  if (authority === undefined) return false
  // Loopback only. A deployment that exposes this port under another name needs a
  // configured allow-list, and the plugin has none, so a non-loopback Host means
  // the request did not come from a page we serve.
  if (!LOOPBACK_HOSTNAMES.has(authority.hostname)) return false
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
