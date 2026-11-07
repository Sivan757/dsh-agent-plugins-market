/**
 * The request-trust fence every mutating route relies on.
 *
 * The fence exists for one attack: DNS rebinding turns a page on any site into a
 * same-origin client of this server, so comparing `Origin` with `Host` proves
 * nothing, because the attacker chooses both. These cases pin the three checks
 * that do prove something, plus the deployment trust list the `Host` check
 * reads: a name the deployment declares is served, a name it never declared is
 * the rebound case.
 * @module test/request-trust
 */
import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { isTrustedMutation, requestTrustOf } from '../../../../packages/market-bundle/src/request-trust.js'

/** Build the only part of a request the fence reads. */
const request = (headers: Record<string, string>): IncomingMessage => ({ headers }) as IncomingMessage

describe('isTrustedMutation', () => {
  it('accepts a request from the page this server serves', () => {
    expect(isTrustedMutation(request({ host: '127.0.0.1:54502', origin: 'http://127.0.0.1:54502' }))).toBe(true)
    expect(isTrustedMutation(request({ host: 'localhost:3080', origin: 'http://localhost:3080' }))).toBe(true)
  })

  it('accepts a non-browser client, which sends a loopback Host and no Origin', () => {
    // The Host fence already bound the request, so a missing Origin is not a gap.
    expect(isTrustedMutation(request({ host: '127.0.0.1:3080' }))).toBe(true)
  })

  it('refuses a rebound request whose Host is the attacker domain', () => {
    // This is the case the old Origin-equals-Host check allowed: both values are
    // the attacker's, so they match, and the socket still lands here.
    expect(isTrustedMutation(request({ host: 'evil.example:3080', origin: 'http://evil.example:3080' }))).toBe(false)
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

describe('isTrustedMutation under a deployment trust list', () => {
  it('accepts the domain a reverse-proxied deployment serves this port under', () => {
    // The proxy keeps the public Host, so a loopback-only fence would refuse the
    // page the server itself served; the declared name is what makes it ours.
    const trust = { trustedHosts: ['dsh.example.com'] }
    expect(isTrustedMutation(request({ host: 'dsh.example.com', origin: 'https://dsh.example.com' }), trust)).toBe(true)
  })

  it('still refuses a rebound page whose domain the deployment never declared', () => {
    const trust = { trustedHosts: ['dsh.example.com'] }
    expect(isTrustedMutation(request({ host: 'evil.example:3080', origin: 'http://evil.example:3080' }), trust)).toBe(false)
  })

  it('refuses a declared name when the Origin disagrees with it', () => {
    const trust = { trustedHosts: ['dsh.example.com'] }
    expect(isTrustedMutation(request({ host: 'dsh.example.com', origin: 'https://other.example' }), trust)).toBe(false)
    expect(isTrustedMutation(request({ host: 'dsh.example.com', origin: 'null' }), trust)).toBe(false)
    expect(isTrustedMutation(request({ host: 'dsh.example.com', origin: 'https://dsh.example.com', 'sec-fetch-site': 'cross-site' }), trust)).toBe(false)
  })

  it('matches an entry with a port exactly, and a port-less entry on any port', () => {
    const exact = { trustedHosts: ['dsh.example.com:8443'] }
    expect(isTrustedMutation(request({ host: 'dsh.example.com:8443' }), exact)).toBe(true)
    expect(isTrustedMutation(request({ host: 'dsh.example.com:9000' }), exact)).toBe(false)
    const loose = { trustedHosts: ['dsh.example.com'] }
    expect(isTrustedMutation(request({ host: 'dsh.example.com:9000' }), loose)).toBe(true)
  })

  it('accepts the listener bind address on any port, independent of the list', () => {
    const trust = { bindHost: '10.0.0.5' }
    expect(isTrustedMutation(request({ host: '10.0.0.5:3080', origin: 'http://10.0.0.5:3080' }), trust)).toBe(true)
    expect(isTrustedMutation(request({ host: '10.0.0.6:3080' }), trust)).toBe(false)
  })

  it('keeps loopback when the host exposes no trust at all', () => {
    // An older harness, or one with nothing configured, must behave as before.
    expect(isTrustedMutation(request({ host: 'dsh.example.com', origin: 'https://dsh.example.com' }), {})).toBe(false)
    expect(isTrustedMutation(request({ host: '127.0.0.1:3080' }), {})).toBe(true)
  })
})

describe('requestTrustOf', () => {
  it('reads the live list and bind address from the host services', () => {
    const connection = { trustedHosts: ['dsh.example.com'] }
    const ctx = {
      get: (name: string): unknown => (name === 'connection' ? connection : name === 'webServer' ? { host: '0.0.0.0' } : undefined)
    }
    expect(requestTrustOf(ctx)).toEqual({ trustedHosts: ['dsh.example.com'], bindHost: '0.0.0.0' })
    // The host appends while it runs, so a name registered after mount is served.
    connection.trustedHosts.push('second.example.com')
    expect(isTrustedMutation(request({ host: 'second.example.com' }), requestTrustOf(ctx))).toBe(true)
  })

  it('contributes nothing when the host has no services to ask', () => {
    expect(requestTrustOf(undefined)).toEqual({})
    expect(requestTrustOf({ get: () => undefined })).toEqual({})
  })
})
