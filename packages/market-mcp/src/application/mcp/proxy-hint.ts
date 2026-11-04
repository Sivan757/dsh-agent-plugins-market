/**
 * Whether a failed mount most likely died at a proxy that cannot reach the target.
 *
 * A machine can be fully online and still fail every intranet service: the HTTPS
 * proxy accepts the CONNECT, the tunnel never reaches a LAN address, and the client
 * reports a timeout or a handshake failure that looks like the service's fault. The
 * evidence is local and readable — a proxy variable is set, and the host is not
 * listed in NO_PROXY — so the panel can say it instead of leaving the reader to
 * discover it with curl.
 *
 * @module application/mcp/proxy-hint
 */

/** A proxy that is set for this process, and the host it would have to reach. */
export interface ProxyMismatch {
  /** The proxy URL, as the environment spells it. */
  proxy: string
  /** The host the failed endpoint names. */
  host: string
}

/** The codes a proxy can explain; a 401 or a bad config is not one of them. */
const PROXY_CODES = new Set(['timeout', 'tls', 'dns', 'refused', 'transport', 'mount-failed', 'reconnecting', 'reconnect-stopped'])

/**
 * The connection errors a proxy leaves behind, in the words the transports use.
 *
 * The row's own code is often mount-failed for a timeout, so the sentence the layer
 * wrote is the better signal: an SDK timeout, a refused connection, a DNS failure, a
 * TLS handshake that never finished.
 */
const PROXY_ERRORS = new RegExp('timed? out|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|handshake|socket hang up|certificate', 'i')

/**
 * Read one environment value whatever its casing.
 *
 * @param env - the process environment, or a stand-in in a test.
 * @param name - the variable's canonical upper-case name.
 * @returns the first non-empty value found.
 */
function envValue(env: Record<string, string | undefined>, name: string): string | undefined {
  for (const key of [name, name.toLowerCase()]) {
    const value = env[key]
    if (value !== undefined && value.trim() !== '') return value.trim()
  }
  return undefined
}

/**
 * Whether a NO_PROXY entry covers one host.
 *
 * @param entries - the comma-separated list, already split.
 * @param host - the host the endpoint names.
 * @returns true when the entry matches exactly, or as a suffix after a dot.
 */
function covers(entries: string[], host: string): boolean {
  const target = host.toLowerCase()
  return entries.some(raw => {
    const entry = raw
      .trim()
      .toLowerCase()
      .replace(/^\*?\./, '')
    if (entry === '' || entry === '*') return entry === '*'
    return target === entry || target.endsWith('.' + entry)
  })
}

/**
 * Decide whether a failure is explained by the proxy configuration.
 *
 * @param endpoint - the URL the row tried to reach, when it has one.
 * @param failureCode - the classified failure, if the row has one.
 * @param env - the environment the mounts run in.
 * @returns the proxy and host when the configuration explains the failure.
 */
export function proxyMismatchFor(
  endpoint: string | undefined,
  failure: { code?: string; reason?: string; causes?: readonly string[] },
  env: Record<string, string | undefined>
): ProxyMismatch | undefined {
  if (endpoint === undefined) return undefined
  const words = [failure.reason ?? '', ...(failure.causes ?? [])].join(' ')
  const connectionShaped = PROXY_ERRORS.test(words)
  if (!connectionShaped && (failure.code === undefined || !PROXY_CODES.has(failure.code))) return undefined
  let host: string
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    host = url.hostname
  } catch {
    return undefined
  }
  const proxy = envValue(env, 'HTTPS_PROXY') ?? envValue(env, 'HTTP_PROXY') ?? envValue(env, 'ALL_PROXY')
  if (proxy === undefined) return undefined
  const bypass = (envValue(env, 'NO_PROXY') ?? envValue(env, 'no_proxy') ?? '').split(',')
  if (covers(bypass, host)) return undefined
  return { proxy, host }
}
