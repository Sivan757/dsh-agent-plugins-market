import { describe, expect, it } from 'vitest'
import { redactMcpConfig, redactUrl, isSensitiveKey } from '../src/runtime/mcp-redaction.js'
import { credentialRefsInServer } from '../src/runtime/mcp-config.js'

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
    expect(redacted.headers['X-Auth']).toBe('[redacted]')
    // Unrelated headers survive so the config stays diagnosable.
    expect(redacted.headers['x-trace-id']).toBe('abc123')
  })

  it('preserves credential references so the UI can still name them', () => {
    const redacted = redactMcpConfig({ env: { API_TOKEN: '${API_TOKEN}' } }) as Record<string, Record<string, string>>
    expect(redacted.env.API_TOKEN).toBe('${API_TOKEN}')
  })

  it('redacts secret-bearing query values in an endpoint url', () => {
    expect(redactUrl('https://example.com/mcp?key=abc123&other=1')).toBe('https://example.com/mcp?key=[redacted]&other=1')
    // A placeholder in a URL is a reference, not a secret.
    expect(redactUrl('https://example.com/mcp?key=${TOKEN}')).toBe('https://example.com/mcp?key=${TOKEN}')
    expect(redactUrl('https://example.com/mcp')).toBe('https://example.com/mcp')
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
