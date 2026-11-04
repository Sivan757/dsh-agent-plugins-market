/**
 * The request-trust fence every mutating route relies on.
 *
 * The fence exists for one attack: DNS rebinding turns a page on any site into a
 * same-origin client of this server, so comparing `Origin` with `Host` proves
 * nothing, because the attacker chooses both. These cases pin the three checks
 * that do prove something.
 * @module test/request-trust
 */
import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import { isTrustedMutation } from '../../../../packages/market-bundle/src/request-trust.js'

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
