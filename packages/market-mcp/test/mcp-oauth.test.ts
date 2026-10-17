/**
 * Provider-level contract tests for the OAuth loopback client: durable state
 * over the credentials seam, the redirect metadata the MCP SDK reads, and the
 * admission rules of the loopback callback leg.
 *
 * The end-to-end flow lives in [mcp-oauth-flow.test.ts](mcp-oauth-flow.test.ts);
 * these tests pin the provider half in isolation. Every callback-leg case here
 * runs on the default ephemeral port: a fixed \`callbackPort\` pins one URL for
 * registration, authorization, and the exchange, which hides the port
 * continuity the functional suite exists to protect.
 *
 * @module test/mcp-oauth
 */
import { describe, expect, it } from 'vitest'
import { LoopbackOAuthClientProvider, type BrowserOpener } from '../../../packages/market-mcp/src/runtime/mcp/bridge/oauth.js'
import { credentialKey } from '../../../packages/market-mcp/src/runtime/mcp/bridge/host-seams.js'
import type { OAuthStorageConfig } from '../../../packages/market-mcp/src/application/mcp/mcp-bridge-config.js'

/** No-op opener: tests must NEVER open a real browser. Callback-leg tests drive the loopback endpoint themselves. */
const openerStub: BrowserOpener = async () => {}

const TOKENS = {
  access_token: 'at-1',
  token_type: 'Bearer',
  refresh_token: 'rt-1'
}

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
    describeRecord: async key => ({ configured: records.has(key), writable: true }),
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

/** One browser leg driven on the provider's own ephemeral port. */
interface DrivenLeg {
  provider: LoopbackOAuthClientProvider
  /** State the provider issued for this leg. */
  state: string
  /** Resolves once the opener saw the authorization URL, with the port the listener bound. */
  started: Promise<{ authorizationUrl: string; redirectUri: string; port: string }>
  /** Settles when the leg finishes (tokens saved) or fails. */
  leg: Promise<void>
}

/**
 * Bind a provider, start one leg, and report the loopback URL the SDK embedded
 * into the authorization request. The opener is the only seam.
 *
 * @param options - Storage overrides, a record store, and a `finishAuth` observer.
 * @returns The provider, the issued state, the announced URL, and the leg promise.
 */
function startLeg(options: { storage?: OAuthStorageConfig; store?: unknown; onFinishAuth?: (provider: LoopbackOAuthClientProvider) => void } = {}): DrivenLeg {
  let announce: (value: { authorizationUrl: string; redirectUri: string; port: string }) => void = () => {}
  const started = new Promise<{ authorizationUrl: string; redirectUri: string; port: string }>(resolve => {
    announce = resolve
  })
  const provider = new LoopbackOAuthClientProvider(
    'srv',
    options.storage ?? {},
    undefined,
    () => {},
    options.store,
    async url => {
      const redirectUri = url.searchParams.get('redirect_uri') ?? ''
      announce({ authorizationUrl: url.toString(), redirectUri, port: new URL(redirectUri).port })
    }
  )
  provider.bindTransport({
    finishAuth: async () => {
      options.onFinishAuth?.(provider)
    }
  })
  const state = provider.state()
  const authorizationUrl = new URL('https://auth.example/authorize')
  authorizationUrl.searchParams.set('state', state)
  return { provider, state, started, leg: provider.redirectToAuthorization(authorizationUrl) }
}

describe('LoopbackOAuthClientProvider record state', () => {
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

  it('keeps a concurrent process token refresh instead of clobbering it', async () => {
    const key = String(credentialKey('mcp-auth', 'srv'))
    const records = new Map<string, unknown>()
    const store = createRecordStore(records)
    const provider = new LoopbackOAuthClientProvider('srv', {}, undefined, () => {}, store, openerStub)
    await provider.saveTokens({ ...TOKENS })

    // A refresh running in another process replaces the token behind our back
    // between our load and our write.
    const refreshed = { ...TOKENS, access_token: 'at-2', refresh_token: 'rt-2' }
    const inner = store.modifyRecord.bind(store)
    store.modifyRecord = async (k, mutate) => {
      if (k === key) records.set(k, { kind: 'grant', payload: { tokens: refreshed } })
      return inner(k, mutate)
    }
    try {
      await provider.saveClientInformation({ client_id: 'cid-1' })
    } finally {
      delete (store as { modifyRecord?: unknown }).modifyRecord
    }
    const stored = (await store.readRecord(key)) as { payload: { tokens?: { access_token?: string }; clientInformation?: { client_id?: string } } }
    expect(stored.payload.tokens?.access_token).toBe('at-2')
    expect(stored.payload.clientInformation).toMatchObject({ client_id: 'cid-1' })
  })

  it('never replaces a foreign record kind it raced', async () => {
    const key = String(credentialKey('mcp-auth', 'srv'))
    const records = new Map<string, unknown>([[key, { kind: 'api-key', key: 'k' }]])
    const store = createRecordStore(records)
    const provider = new LoopbackOAuthClientProvider('srv', {}, undefined, () => {}, store, openerStub)
    await provider.saveTokens({ ...TOKENS })
    expect((await store.readRecord(key)) as { kind: string }).toMatchObject({ kind: 'api-key' })
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
  it('advertises the configured loopback port, and the port-0 placeholder without one', () => {
    const configured = new LoopbackOAuthClientProvider('srv', { callbackPort: 49_152 }, 'read:files', () => {}, undefined, openerStub)
    expect(configured.redirectUrl).toBe('http://127.0.0.1:49152/callback')
    expect(configured.clientMetadata).toMatchObject({
      client_name: 'DeepSeek Harness (dsh-agent-plugins-market)',
      redirect_uris: ['http://127.0.0.1:49152/callback'],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'read:files'
    })

    // Without a configured port, registration carries the placeholder and the
    // authorization request rewrites it to the bound port (RFC 8252 §7.3). The
    // callback-leg tests below pin that rewrite.
    const ephemeral = new LoopbackOAuthClientProvider('srv', {}, undefined, () => {}, undefined, openerStub)
    expect(ephemeral.redirectUrl).toBe('http://127.0.0.1:0/callback')
    expect(ephemeral.clientMetadata).not.toHaveProperty('scope')
  })
})

describe('LoopbackOAuthClientProvider callback leg', () => {
  it('publishes the authorization redirect_uri through the code exchange, then releases it', async () => {
    let exchangeRedirectUri: string | undefined
    const driven = startLeg({
      onFinishAuth: provider => {
        exchangeRedirectUri = provider.redirectUrl
      }
    })
    const announced = await driven.started
    expect(announced.redirectUri).toBe(`http://127.0.0.1:${announced.port}/callback`)

    const response = await fetch(`http://127.0.0.1:${announced.port}/callback?code=abc&state=${encodeURIComponent(driven.state)}`)
    expect(response.status).toBe(200)
    await expect(driven.leg).resolves.toBeUndefined()

    // The regression: the token request repeats the redirect_uri of the
    // authorization request, and the port is released only afterwards.
    expect(exchangeRedirectUri).toBe(announced.redirectUri)
    expect(driven.provider.redirectUrl).toBe('http://127.0.0.1:0/callback')
    expect(driven.provider.lastBrowserLegOutcome).toBe(true)
  }, 20_000)

  it('rejects a forged callback state and still completes the real callback', async () => {
    const driven = startLeg()
    const announced = await driven.started
    const forged = await fetch(`http://127.0.0.1:${announced.port}/callback?code=attacker&state=wrong`)
    expect(forged.status).toBe(400)
    expect(driven.provider.awaitingBrowser).toBe(true)

    const legitimate = await fetch(`http://127.0.0.1:${announced.port}/callback?code=real&state=${encodeURIComponent(driven.state)}`)
    expect(legitimate.status).toBe(200)
    await expect(driven.leg).resolves.toBeUndefined()
  }, 20_000)

  it('keeps the listener open for a callback on a foreign path', async () => {
    const driven = startLeg()
    const announced = await driven.started
    const stray = await fetch(`http://127.0.0.1:${announced.port}/elsewhere?code=x&state=${encodeURIComponent(driven.state)}`)
    expect(stray.status).toBe(404)
    expect(driven.provider.awaitingBrowser).toBe(true)

    const legitimate = await fetch(`http://127.0.0.1:${announced.port}/callback?code=real&state=${encodeURIComponent(driven.state)}`)
    expect(legitimate.status).toBe(200)
    await expect(driven.leg).resolves.toBeUndefined()
  }, 20_000)

  it('fails the leg when the authorization server redirects with an OAuth error', async () => {
    const driven = startLeg()
    const announced = await driven.started
    const rejection = expect(driven.leg).rejects.toThrow(/access_denied/)
    const response = await fetch(`http://127.0.0.1:${announced.port}/callback?error=access_denied&error_description=nope&state=${encodeURIComponent(driven.state)}`)
    expect(response.status).toBe(400)

    await rejection
    expect(driven.provider.awaitingBrowser).toBe(false)
    expect(driven.provider.lastBrowserLegOutcome).toBe(false)
    expect(driven.provider.redirectUrl).toBe('http://127.0.0.1:0/callback')
  }, 20_000)

  it('rejects when no transport generation is bound', async () => {
    const provider = new LoopbackOAuthClientProvider('srv', {}, undefined, () => {}, undefined, openerStub)
    await expect(provider.redirectToAuthorization(new URL('https://auth.example/authorize'))).rejects.toThrow(/no active transport/)
  })
})
