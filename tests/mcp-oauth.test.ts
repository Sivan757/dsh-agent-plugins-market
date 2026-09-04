/**
 * Tests for the OAuth loopback provider: the durable-state contract over the
 * credentials seam (and its memory fallback), the redirect metadata the SDK
 * reads, and the loopback callback leg. The SDK's `auth()` protocol itself is
 * SDK-owned and covered upstream; these tests pin the provider half.
 *
 * Ported from the harness `dsh-mcp-client` oauth.spec (archived patch series
 * `docs/upstream-proposal/patches/`), adapted to the market's self-built
 * bridge modules.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { LoopbackOAuthClientProvider, type BrowserOpener } from '../src/runtime/mcp-client/oauth.js'
import { credentialKey } from '../src/runtime/mcp-client/host-seams.js'

/**
 * No-op opener: tests must NEVER open a real browser — every provider in this
 * file passes this stub, because the default is the platform opener and would
 * launch the developer's browser at the fake auth URL. Callback-leg tests
 * drive the loopback endpoint themselves.
 */
const openerStub: BrowserOpener = async () => {}

// ---- Credential store fake: mirrors CredentialProvider's record surface ----

interface StoreCalls {
  modified: Array<{ key: string; kind: string }>
}

function createRecordStore(initial: Map<string, unknown> = new Map()): {
  describeRecord: (key: string) => Promise<{ configured: boolean; writable: boolean }>
  readRecord: (key: string) => Promise<unknown>
  modifyRecord: (key: string, mutate: (current: unknown) => Promise<unknown>) => Promise<unknown>
  calls: StoreCalls
} {
  const records = initial
  const calls: StoreCalls = { modified: [] }
  return {
    describeRecord: async key => ({
      configured: records.has(key),
      writable: true
    }),
    readRecord: async key => records.get(key),
    modifyRecord: async (key, mutate) => {
      const next = await mutate(records.get(key))
      records.set(key, next)
      calls.modified.push({ key, kind: (next as { kind?: string } | undefined)?.kind ?? 'none' })
      return next
    },
    calls
  }
}

const TOKENS = {
  access_token: 'at-1',
  token_type: 'Bearer',
  refresh_token: 'rt-1'
}

afterEach(async () => {
  vi.restoreAllMocks()
})

describe('LoopbackOAuthClientProvider record addressing', () => {
  it('folds a __-separated serverName into a valid credential key segment', async () => {
    // Regression: `credentialKey` threw on `cloudflare__cloudflare-api`
    // (double underscore fails the key grammar), which crashed the provider
    // constructor before any auth flow could start.
    const store = createRecordStore()
    const provider = new LoopbackOAuthClientProvider('cloudflare__cloudflare-api', {}, undefined, () => {}, store, openerStub)
    await provider.saveTokens({ ...TOKENS })
    const key = String(credentialKey('mcp-auth', 'cloudflare-cloudflare-api'))
    expect((await store.readRecord(key)) as { payload: { tokens?: unknown } }).toMatchObject({
      kind: 'grant',
      payload: { tokens: { access_token: 'at-1' } }
    })
  })
})

describe('LoopbackOAuthClientProvider state', () => {
  it('persists tokens as a grant record under mcp-auth/<serverName>', async () => {
    const store = createRecordStore()
    const provider = new LoopbackOAuthClientProvider('cloudflare-api', {}, 'scope-a', () => {}, store, openerStub)
    await provider.saveTokens({ ...TOKENS })

    const key = String(credentialKey('mcp-auth', 'cloudflare-api'))
    expect(store.calls.modified).toEqual([{ key, kind: 'grant' }])
    const stored = (await store.readRecord(key)) as { kind: string; payload: { tokens?: unknown } }
    expect(stored.kind).toBe('grant')
    expect(stored.payload.tokens).toMatchObject({ access_token: 'at-1' })
    // A fresh provider over the same store reads the tokens back.
    const second = new LoopbackOAuthClientProvider('cloudflare-api', {}, undefined, () => {}, store, openerStub)
    await expect(second.tokens()).resolves.toMatchObject({ access_token: 'at-1' })
  })

  it('keeps the PKCE verifier process-local and clears it on saveTokens', async () => {
    const store = createRecordStore()
    const provider = new LoopbackOAuthClientProvider('srv', {}, undefined, () => {}, store, openerStub)
    await provider.saveCodeVerifier('verifier-1')
    await expect(provider.codeVerifier()).resolves.toBe('verifier-1')
    await provider.saveTokens({ ...TOKENS })
    await expect(provider.codeVerifier()).rejects.toThrow(/no PKCE verifier/)
    // The verifier never reaches the durable record.
    const key = String(credentialKey('mcp-auth', 'srv'))
    const stored = (await store.readRecord(key)) as { payload: Record<string, unknown> }
    expect(stored.payload).not.toHaveProperty('codeVerifier')
  })

  it('round-trips client information through the record store', async () => {
    const store = createRecordStore()
    const provider = new LoopbackOAuthClientProvider('srv', {}, undefined, () => {}, store, openerStub)
    await provider.saveClientInformation({ client_id: 'cid-1' })
    await expect(provider.clientInformation()).resolves.toMatchObject({ client_id: 'cid-1' })
  })

  it('falls back to process memory when no store is mounted', async () => {
    const provider = new LoopbackOAuthClientProvider('srv', {}, undefined, () => {}, undefined, openerStub)
    await provider.saveTokens({ ...TOKENS })
    await expect(provider.tokens()).resolves.toMatchObject({ access_token: 'at-1' })
  })

  it('invalidateCredentials("all") drops the whole record; "tokens" keeps the client', async () => {
    const store = createRecordStore()
    const provider = new LoopbackOAuthClientProvider('srv', {}, undefined, () => {}, store, openerStub)
    await provider.saveClientInformation({ client_id: 'cid-1' })
    await provider.saveTokens({ ...TOKENS })

    await provider.invalidateCredentials('tokens')
    await expect(provider.tokens()).resolves.toBeUndefined()
    await expect(provider.clientInformation()).resolves.toMatchObject({ client_id: 'cid-1' })

    await provider.invalidateCredentials('all')
    await expect(provider.clientInformation()).resolves.toBeUndefined()
  })

  it('reads through to the store on every access so external edits are visible', async () => {
    const key = String(credentialKey('mcp-auth', 'srv'))
    const records = new Map<string, unknown>()
    const store = createRecordStore(records)
    const provider = new LoopbackOAuthClientProvider('srv', {}, undefined, () => {}, store, openerStub)
    await expect(provider.tokens()).resolves.toBeUndefined()

    // Another process refreshes the record behind our back.
    records.set(key, { kind: 'grant', payload: { tokens: { ...TOKENS } } })
    await expect(provider.tokens()).resolves.toMatchObject({ access_token: 'at-1' })

    // A foreign overwrite of the whole record (kind no longer ours) reads as
    // absent, never as a crash.
    records.set(key, { kind: 'api-key', key: 'x' })
    await expect(provider.tokens()).resolves.toBeUndefined()
    await expect(provider.clientInformation()).resolves.toBeUndefined()
  })

  it('treats a store without the record surface as absent', async () => {
    const provider = new LoopbackOAuthClientProvider('srv', {}, undefined, () => {}, { nope: true }, openerStub)
    await provider.saveTokens({ ...TOKENS })
    await expect(provider.tokens()).resolves.toMatchObject({ access_token: 'at-1' })
  })
})

describe('LoopbackOAuthClientProvider redirect metadata', () => {
  it('advertises loopback redirect and public-client metadata with the scope', () => {
    const provider = new LoopbackOAuthClientProvider('srv', { callbackPort: 49_152 }, 'read:files', () => {}, undefined, openerStub)
    expect(provider.redirectUrl).toBe('http://127.0.0.1:49152/callback')
    expect(provider.clientMetadata).toMatchObject({
      client_name: 'DeepSeek Harness (dsh-agent-plugins-market)',
      redirect_uris: ['http://127.0.0.1:49152/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'read:files'
    })
  })

  it('omits scope metadata when none is configured', () => {
    const provider = new LoopbackOAuthClientProvider('srv', {}, undefined, () => {}, undefined, openerStub)
    expect(provider.clientMetadata).not.toHaveProperty('scope')
  })
})

describe('LoopbackOAuthClientProvider callback leg', () => {
  /** Bind a throwaway HTTP listener to learn a free port before the provider takes one. */
  function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const probe: Server = createServer()
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address()
        if (address === null || typeof address === 'string') {
          probe.close(() => {
            reject(new Error('no port'))
          })
          return
        }
        probe.close(() => {
          resolve(address.port)
        })
      })
      probe.on('error', reject)
    })
  }

  it('opens the gate while the leg pends, resolves true on success, false on leg failure', async () => {
    const port = await freePort()
    const provider = new LoopbackOAuthClientProvider('srv', { callbackPort: port }, undefined, () => {}, undefined, openerStub)
    provider.bindTransport({ finishAuth: async () => {} })
    const redirect = provider.redirectToAuthorization(new URL('https://auth.example/authorize'))
    // While waiting for the user agent the supervisor must hold the generation.
    expect(provider.awaitingBrowser).toBe(true)
    const response = await fetch(`http://127.0.0.1:${port}/callback?code=abc`)
    expect(response.status).toBe(200)
    await expect(redirect).resolves.toBeUndefined()
    expect(provider.awaitingBrowser).toBe(false)
  }, 15_000)

  it('resolves the gate false when the authorization server returns an error', async () => {
    const port = await freePort()
    const provider = new LoopbackOAuthClientProvider('srv', { callbackPort: port }, undefined, () => {}, undefined, openerStub)
    provider.bindTransport({ finishAuth: async () => {} })
    const redirect = provider.redirectToAuthorization(new URL('https://auth.example/authorize'))
    // Attach the rejection assertion before the callback lands, so the
    // rejection is never observably unhandled.
    const rejection = expect(redirect).rejects.toThrow(/access_denied/)
    await vi.waitFor(() => {
      expect(provider.awaitingBrowser).toBe(true)
    })
    await fetch(`http://127.0.0.1:${port}/callback?error=access_denied`)
    await rejection
    expect(provider.awaitingBrowser).toBe(false)
  }, 15_000)

  it('completes the flow when the browser returns a code, then rejects a second leg', async () => {
    const port = await freePort()
    const provider = new LoopbackOAuthClientProvider('srv', { callbackPort: port }, undefined, () => {}, undefined, openerStub)
    const finished: Array<string> = []
    provider.bindTransport({
      finishAuth: async code => {
        finished.push(code)
      }
    })

    const redirect = provider.redirectToAuthorization(new URL('https://auth.example/authorize'))
    // While the leg is open, the getter reports the bound loopback URL the
    // SDK embedded into the authorization request.
    await vi.waitFor(() => {
      expect(provider.redirectUrl).toBe(`http://127.0.0.1:${port}/callback`)
    })

    // Simulate the user agent landing back with a code.
    const response = await fetch(`http://127.0.0.1:${port}/callback?code=abc&state=s1`)
    expect(response.status).toBe(200)
    await expect(redirect).resolves.toBeUndefined()
    expect(finished).toEqual(['abc'])

    // The listener is one-use: the socket no longer answers.
    await expect(fetch(`http://127.0.0.1:${port}/callback?code=abc`)).rejects.toThrow()
  }, 15_000)

  it('rejects when the authorization server redirects with an OAuth error', async () => {
    const port = await freePort()
    const provider = new LoopbackOAuthClientProvider('srv', { callbackPort: port }, undefined, () => {}, undefined, openerStub)
    provider.bindTransport({ finishAuth: async () => {} })
    const redirect = provider.redirectToAuthorization(new URL('https://auth.example/authorize'))
    const rejection = expect(redirect).rejects.toThrow(/access_denied/)
    await vi.waitFor(() => {
      expect(provider.redirectUrl).toBe(`http://127.0.0.1:${port}/callback`)
    })

    const response = await fetch(`http://127.0.0.1:${port}/callback?error=access_denied&error_description=nope`)
    expect(response.status).toBe(400)
    await rejection
  }, 15_000)

  it('rejects when no transport generation is bound', async () => {
    const provider = new LoopbackOAuthClientProvider('srv', { callbackPort: await freePort() }, undefined, () => {}, undefined, openerStub)
    await expect(provider.redirectToAuthorization(new URL('https://auth.example/authorize'))).rejects.toThrow(/no active transport/)
  })

  it('keeps the leg open for a late callback regardless of the browser helper', async () => {
    const port = await freePort()
    const logs: Array<string> = []
    const finished: Array<string> = []
    const provider = new LoopbackOAuthClientProvider(
      'srv',
      { callbackPort: port },
      undefined,
      message => {
        logs.push(message)
      },
      undefined,
      openerStub
    )
    provider.bindTransport({
      finishAuth: async code => {
        finished.push(code)
      }
    })
    const redirect = provider.redirectToAuthorization(new URL('https://auth.example/authorize'))
    // The announce line fires in the listen callback; the leg does not depend
    // on whether the platform helper managed to open a browser.
    await vi.waitFor(() => {
      expect(logs.some(line => /opening the browser/.test(line))).toBe(true)
    })
    // A late user agent (slower than the helper's fate) still completes it.
    await new Promise(resolve => setTimeout(resolve, 100))
    const response = await fetch(`http://127.0.0.1:${port}/callback?code=late`)
    expect(response.status).toBe(200)
    await expect(redirect).resolves.toBeUndefined()
    expect(finished).toEqual(['late'])
  }, 15_000)
})
