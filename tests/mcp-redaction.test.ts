import { describe, expect, it } from 'vitest'
import { redactErrorMessage, redactMcpConfig, redactUrl, isSensitiveKey } from '../packages/market-contracts/src/redaction.js'
import { credentialRefsInServer } from '../packages/market-mcp/src/application/mcp/mcp-config.js'

describe('MCP config redaction', () => {
  it('keeps the OAuth opt-in block while redacting secret values inside it and beside it', () => {
    // `auth` names a structure, not a secret: redacting the whole block erased
    // the `enabled` flag before it reached the mount, so OAuth never armed.
    expect(redactMcpConfig({ type: 'streamable-http', url: 'https://x/mcp', auth: { enabled: true, scope: 'user' } })).toEqual({
      type: 'streamable-http',
      url: 'https://x/mcp',
      auth: { enabled: true, scope: 'user' }
    })
    expect(redactMcpConfig({ headers: { authorization: 'Bearer abc' }, auth: { enabled: true } })).toEqual({ headers: { authorization: '[redacted]' }, auth: { enabled: true } })
  })

  it('redacts non-obvious secret keys such as X-Auth', () => {
    const redacted = redactMcpConfig({ headers: { 'X-Auth': 'super-secret', 'x-trace-id': 'abc123' } }) as Record<string, Record<string, string>>
    const headers = redacted.headers
    if (headers === undefined) throw new Error('expected redaction to keep the headers block')
    expect(headers['X-Auth']).toBe('[redacted]')
    // Unrelated headers survive so the config stays diagnosable.
    expect(headers['x-trace-id']).toBe('abc123')
  })

  it('preserves every reference when several sensitive keys carry one', () => {
    // Each value is judged on its own: one placeholder must not hide the next.
    const redacted = redactMcpConfig({ env: { API_TOKEN: '${A}', OTHER_SECRET: '${B}', THIRD_KEY: '${C}' } }) as Record<string, Record<string, string>>
    expect(redacted.env).toEqual({ API_TOKEN: '${A}', OTHER_SECRET: '${B}', THIRD_KEY: '${C}' })
  })

  it('reads a reference as a braced name, not as any text between dollars and braces', () => {
    const judge = (value: string): unknown => redactMcpConfig({ env: { API_TOKEN: value } })
    const env = (value: string): unknown => (judge(value) as Record<string, Record<string, unknown>>).env
    // A name is required, so an empty or brace-terminated run is not a reference.
    expect(env('${}')).toEqual({ API_TOKEN: '[redacted]' })
    expect(env('${}}')).toEqual({ API_TOKEN: '[redacted]' })
    expect(env('${')).toEqual({ API_TOKEN: '[redacted]' })
    expect(env('$ {A}')).toEqual({ API_TOKEN: '[redacted]' })
    // The first braced name wins, and an empty pair before it does not hide it.
    expect(env('${A}')).toEqual({ API_TOKEN: '${A}' })
    expect(env('${A}${B}')).toEqual({ API_TOKEN: '${A}${B}' })
    expect(env('${}${A}')).toEqual({ API_TOKEN: '${}${A}' })
    expect(env('prefix-${A}-suffix')).toEqual({ API_TOKEN: 'prefix-${A}-suffix' })
  })

  it('scans a hostile value in one pass instead of retrying a pattern at every brace', () => {
    // `"${{"` repeated with no closing brace is the shape that made the former
    // regular expression quadratic; this completes in milliseconds.
    const hostile = '${{'.repeat(50_000)
    const redacted = redactMcpConfig({ env: { API_TOKEN: hostile } }) as Record<string, Record<string, unknown>>
    expect(redacted.env).toEqual({ API_TOKEN: '[redacted]' })
  })

  it('redacts secret-bearing query values in an endpoint url', () => {
    expect(redactUrl('https://example.com/mcp?key=abc123&other=1')).toBe('https://example.com/mcp?key=[redacted]&other=1')
    // A placeholder in a URL is a reference, not a secret.
    expect(redactUrl('https://example.com/mcp?key=${TOKEN}')).toBe('https://example.com/mcp?key=${TOKEN}')
    expect(redactUrl('https://example.com/mcp')).toBe('https://example.com/mcp')
  })

  it('redacts embedded urls inside an error message', () => {
    expect(redactErrorMessage('request failed for https://example.test/mcp?token=secret&trace=1')).toBe('request failed for https://example.test/mcp?token=[redacted]&trace=1')
    // Text around the url survives untouched; a message without a url is a no-op.
    expect(redactErrorMessage('loopback callback server failed: EADDRINUSE')).toBe('loopback callback server failed: EADDRINUSE')
  })

  it('preserves every reference in one url query', () => {
    // Three sensitive names, three references: none may be erased.
    expect(redactUrl('https://example.com/mcp?key=${A}&auth=${B}&token=${C}')).toBe('https://example.com/mcp?key=${A}&auth=${B}&token=${C}')
  })

  it('preserves references across the urls of several servers in one config', () => {
    // Redaction walks server entries in order: the second url is checked after
    // the first, and its reference must survive that.
    const redacted = redactMcpConfig({
      a: { url: 'https://a.example/mcp?key=${A}' },
      b: { url: 'https://b.example/mcp?auth=${B}' }
    }) as Record<string, { url: string }>
    const a = redacted.a
    const b = redacted.b
    if (a === undefined || b === undefined) throw new Error('expected redaction to keep both server entries')
    expect(a.url).toBe('https://a.example/mcp?key=${A}')
    expect(b.url).toBe('https://b.example/mcp?auth=${B}')
  })

  it('recognises the widened sensitive-key vocabulary', () => {
    for (const key of ['authorization', 'X-Auth', 'api_key', 'apiKey', 'ACCESS_KEY', 'cookie', 'private_key']) {
      expect(isSensitiveKey(key)).toBe(true)
    }
    expect(isSensitiveKey('trace-id')).toBe(false)
  })
})

describe('credential reference scanning', () => {
  it('finds references inside a streamable-http url, not only in headers', () => {
    const refs = credentialRefsInServer({ type: 'streamable-http', url: 'https://example.com/mcp?key=${MCP_TOKEN}' } as never)
    expect(refs).toEqual(['MCP_TOKEN'])
  })

  it('ignores built-in path placeholders', () => {
    const refs = credentialRefsInServer({ type: 'stdio', command: 'db', args: ['--root', '${PLUGIN_ROOT}'], env: { C: '${PLUGIN_DATA}/c' } } as never)
    expect(refs).toEqual([])
  })
})
