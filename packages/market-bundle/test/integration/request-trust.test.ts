/**
 * The request-trust fence every mutating route relies on.
 *
 * The fence exists for one attack: DNS rebinding turns a page on any site into a
 * same-origin client of this server, so comparing `Origin` with `Host` proves
 * nothing, because the attacker chooses both. These cases pin the three checks
 * that do prove something, and the host-declared authorities the first check
 * accepts beyond loopback.
 * @module test/request-trust
 */
import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { isTrustedMutation, requestTrustAuthoritiesOf, type RequestTrustAuthorities } from '../../../../packages/market-bundle/src/request-trust.js'

/** Build the only part of a request the fence reads. */
const request = (headers: Record<string, string>): IncomingMessage => ({ headers }) as IncomingMessage

/** Authorities as a mounted route would resolve them: declared entries, optional bind address. */
const declared = (trustedHosts: string[], bindHost?: string): RequestTrustAuthorities => ({
  trustedHosts,
  ...(bindHost === undefined ? {} : { bindHost })
})

describe('isTrustedMutation', () => {
  it('accepts a request from the page this server serves', () => {
    expect(isTrustedMutation(request({ host: '127.0.0.1:54502', origin: 'http://127.0.0.1:54502' }))).toBe(true)
    expect(isTrustedMutation(request({ host: 'localhost:3080', origin: 'http://localhost:3080' }))).toBe(true)
  })

  it('accepts a non-browser client, which sends a loopback Host and no Origin', () => {
    // The Host fence already bound the request, so a missing Origin is not a gap.
    expect(isTrustedMutation(request({ host: '127.0.0.1:3080' }))).toBe(true)
  })

  it('accepts the whole 127/8 range, mirroring the harness classifier', () => {
    // The host /api fence accepts 127.0.0.2, so the plugin may not disagree: the old
    // hand-rolled set did, and that was the same misalignment this fence fixes for
    // trustedHosts.
    expect(isTrustedMutation(request({ host: '127.0.0.2:3080' }))).toBe(true)
    expect(isTrustedMutation(request({ host: '127.0.0.2:3080', origin: 'http://127.0.0.2:3080' }), declared(['dsh.example.com']))).toBe(true)
  })

  it('classifies 0.0.0.0 like the host: not loopback, admitted only through the bind address', () => {
    expect(isTrustedMutation(request({ host: '0.0.0.0:3080' }))).toBe(false)
    // The listener bound to 0.0.0.0 admits that Host literal through the bind-address
    // path, exactly as the harness fence does.
    expect(isTrustedMutation(request({ host: '0.0.0.0:3080' }), declared([], '0.0.0.0'))).toBe(true)
  })

  it('refuses near-loopback names the harness classifier refuses', () => {
    expect(isTrustedMutation(request({ host: '128.1.2.3:3080' }))).toBe(false)
    // One dotted part is not a 127/8 address.
    expect(isTrustedMutation(request({ host: '127' }))).toBe(false)
  })

  it('refuses a rebound request whose Host is the attacker domain', () => {
    // This is the case the old Origin-equals-Host check allowed: both values are
    // the attacker's, so they match, and the socket still lands here.
    expect(isTrustedMutation(request({ host: 'evil.example:3080', origin: 'http://evil.example:3080' }))).toBe(false)
    // An undeclared name stays refused even with self-consistent headers: whatever
    // the deployment never declared to the host gains nothing here (#156).
    expect(isTrustedMutation(request({ host: 'evil.example:3080', origin: 'http://evil.example:3080' }), declared(['dsh.example.com']))).toBe(false)
  })

  it('refuses a cross-site fetch even when Host is ours', () => {
    expect(isTrustedMutation(request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'cross-site' }))).toBe(false)
    // A same-origin marker from a page we serve is fine.
    expect(isTrustedMutation(request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080', 'sec-fetch-site': 'same-origin' }))).toBe(true)
  })

  it('refuses an opaque origin', () => {
    // A sandboxed iframe and a file: page both send the literal null, which is an
    // origin from somewhere this server does not control.
    expect(isTrustedMutation(request({ host: '127.0.0.1:3080', origin: 'null' }))).toBe(false)
  })

  it('refuses an Origin that disagrees with Host, or a different port', () => {
    expect(isTrustedMutation(request({ host: '127.0.0.1:3080', origin: 'http://127.0.0.1:9999' }))).toBe(false)
    expect(isTrustedMutation(request({ host: '127.0.0.1:3080', origin: 'http://localhst:3080' }))).toBe(false)
  })

  it('refuses a request with no usable Host', () => {
    expect(isTrustedMutation(request({}))).toBe(false)
    expect(isTrustedMutation(request({ host: 'not an authority' }))).toBe(false)
  })
})

describe('isTrustedMutation with the host-declared authorities', () => {
  it('accepts a trusted entry, which is the reverse-proxied deployment this fence serves', () => {
    // The proxy keeps the public Host and the browser sends its https Origin; the
    // deployment declared the name to the host, so the plugin must not disagree.
    expect(isTrustedMutation(request({ host: 'dsh.example.com', origin: 'https://dsh.example.com' }), declared(['dsh.example.com']))).toBe(true)
  })

  it('matches a port-less entry on any port', () => {
    expect(isTrustedMutation(request({ host: 'dsh.example.com:8443', origin: 'https://dsh.example.com:8443' }), declared(['dsh.example.com']))).toBe(true)
  })

  it('matches an explicit-port entry exactly', () => {
    const authorities = declared(['tls.example:443'])
    expect(isTrustedMutation(request({ host: 'tls.example:443', origin: 'https://tls.example:443' }), authorities)).toBe(true)
    expect(isTrustedMutation(request({ host: 'tls.example:8443', origin: 'https://tls.example:8443' }), authorities)).toBe(false)
    // A browser drops the default port from the Host header, and that shape is refused too:
    // an exact grant does not quietly become a hostname-wide one.
    expect(isTrustedMutation(request({ host: 'tls.example', origin: 'https://tls.example' }), authorities)).toBe(false)
  })

  it('normalizes case through WHATWG parsing', () => {
    expect(isTrustedMutation(request({ host: 'APP.EXAMPLE.COM:3080', origin: 'https://app.example.com:3080' }), declared(['App.Example.com']))).toBe(true)
  })

  it('reads a scheme-default port as the listener default, on both sides of the wire', () => {
    // ':80' is the http parser's default port, so the entry carries the hostname plus the
    // listener's own default port, and WHATWG strips that port from Host alike.
    expect(isTrustedMutation(request({ host: 'plain.example' }), declared(['plain.example:80']))).toBe(true)
    expect(isTrustedMutation(request({ host: 'plain.example:80' }), declared(['plain.example:80']))).toBe(true)
    // Any other port is outside the entry.
    expect(isTrustedMutation(request({ host: 'plain.example:8080' }), declared(['plain.example:80']))).toBe(false)
  })

  it('grants a TLS-default entry to the markerless Host, and refuses other ports, on an https listener', () => {
    // Row for row with the harness spec's own pin: under protocol https:, ':443' is
    // scheme-default and stripped, so the entry 'tls.example:443' reads as port-less and
    // admits the markerless Host, while ':80' stays explicit for 'plain.example'. The
    // harness spec answers 401 where this fence answers true, 403 where false.
    const tls: RequestTrustAuthorities = { trustedHosts: ['tls.example:443', 'plain.example:80'], protocol: 'https:' }
    expect(isTrustedMutation(request({ host: 'tls.example' }), tls)).toBe(true)
    expect(isTrustedMutation(request({ host: 'tls.example:444' }), tls)).toBe(false)
    expect(isTrustedMutation(request({ host: 'plain.example' }), tls)).toBe(false)
  })

  it('reads a malformed entry as its embedded hostname, exactly like the harness fence', () => {
    // The parse drops the path silently, so the runtime reading of 'harness.internal/path'
    // is hostname 'harness.internal' — the same reading the harness fence produces. Upstream
    // assertTrustedAuthority refuses such entries at plugin load, so only validated entries
    // arrive here; this pins the aligned runtime reading, not an accepted deployment shape.
    expect(isTrustedMutation(request({ host: 'harness.internal' }), declared(['harness.internal/path']))).toBe(true)
  })

  it('accepts the listener bind address on any port', () => {
    // A browser dialing the bind literal sends it as Host, and the literal is no rebinding target.
    expect(isTrustedMutation(request({ host: '192.168.1.5:9999' }), declared([], '192.168.1.5'))).toBe(true)
    expect(isTrustedMutation(request({ host: '192.168.1.6:9999' }), declared([], '192.168.1.5'))).toBe(false)
    // A zone id selects an interface; the address text is what names the machine.
    expect(isTrustedMutation(request({ host: '[fe80::1]:3080' }), declared([], 'fe80::1%en0'))).toBe(true)
  })

  it('still applies the cross-site and Origin checks to a trusted host', () => {
    const authorities = declared(['dsh.example.com'])
    expect(isTrustedMutation(request({ host: 'dsh.example.com', origin: 'https://dsh.example.com', 'sec-fetch-site': 'cross-site' }), authorities)).toBe(false)
    expect(isTrustedMutation(request({ host: 'dsh.example.com', origin: 'https://other.example' }), authorities)).toBe(false)
    expect(isTrustedMutation(request({ host: 'dsh.example.com', origin: 'null' }), authorities)).toBe(false)
    expect(isTrustedMutation(request({ host: 'dsh.example.com:3080', origin: 'https://dsh.example.com:9999' }), authorities)).toBe(false)
  })

  it('degrades to loopback-only when the host declares nothing', () => {
    // An older harness or a hand-built test host: exactly yesterday's behavior.
    expect(isTrustedMutation(request({ host: 'dsh.example.com' }))).toBe(false)
    expect(isTrustedMutation(request({ host: 'dsh.example.com', origin: 'https://dsh.example.com' }), undefined)).toBe(false)
    expect(isTrustedMutation(request({ host: '127.0.0.1:3080' }), undefined)).toBe(true)
  })
})

describe('requestTrustAuthoritiesOf', () => {
  /** A stand-in for the host context a mount receives. */
  const contextWith = (services: Record<string, unknown>): { get(name: string): unknown } => ({
    get: name => services[name]
  })

  it('reads the connection and web-server services structurally', () => {
    const host = contextWith({ connection: { trustedHosts: ['dsh.example.com'] }, webServer: { host: '0.0.0.0', protocol: 'https:' } })
    expect(requestTrustAuthoritiesOf(host)).toEqual({ trustedHosts: ['dsh.example.com'], bindHost: '0.0.0.0', protocol: 'https:' })
  })

  it('carries the bind address beside empty entries', () => {
    const host = contextWith({ webServer: { host: '192.168.1.5' } })
    expect(requestTrustAuthoritiesOf(host)).toEqual({ trustedHosts: [], bindHost: '192.168.1.5' })
  })

  it('yields undefined when the host declares nothing or exposes no service reads', () => {
    expect(requestTrustAuthoritiesOf(contextWith({}))).toBeUndefined()
    expect(requestTrustAuthoritiesOf({ webServer: {} })).toBeUndefined()
    expect(requestTrustAuthoritiesOf(undefined)).toBeUndefined()
  })

  it('reads a shapeless trustedHosts as nothing, never as trust', () => {
    const host = contextWith({ connection: { trustedHosts: 'dsh.example.com' } })
    expect(requestTrustAuthoritiesOf(host)).toBeUndefined()
  })
})
