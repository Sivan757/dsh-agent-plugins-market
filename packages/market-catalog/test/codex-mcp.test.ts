/**
 * Codex ignores unknown keys in `[mcp_servers.*]` tables, and real configs
 * carry a redundant `type` key that Codex's own schema never declared. The
 * importer accepts the key and checks it against the transport the table's
 * fields imply instead of dropping the whole server.
 */
import { describe, expect, it } from 'vitest'

import type { McpServer } from '../../market-contracts/src/model/types.js'
import { normalizeCodexMcp } from '../src/scanning/codex-mcp.js'

/** One normalize pass over a server table, collecting the per-server errors. */
function normalize(raw: Record<string, unknown>): { servers: Record<string, McpServer>; errors: string[] } {
  const errors: string[] = []
  return { servers: normalizeCodexMcp(raw, errors), errors }
}

describe('normalizeCodexMcp', () => {
  it('accepts type = "http" on a url server, as real Codex configs carry', () => {
    const { servers, errors } = normalize({ finnhub: { type: 'http', url: 'https://mcp.finnhub.io/mcp' } })
    expect(errors).toEqual([])
    expect(servers.finnhub).toEqual({ type: 'streamable-http', url: 'https://mcp.finnhub.io/mcp', headers: {} })
  })

  it('accepts the streamable-http spellings and sse on a url server', () => {
    for (const type of ['streamable-http', 'streamable_http', 'sse']) {
      const { servers, errors } = normalize({ web: { type, url: 'https://mcp.example.com/mcp' } })
      expect(errors).toEqual([])
      expect(servers.web).toEqual({ type: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: {} })
    }
  })

  it('accepts type = "stdio" on a command server', () => {
    const { servers, errors } = normalize({ local: { type: 'stdio', command: 'npx', args: ['-y', 'server'] } })
    expect(errors).toEqual([])
    expect(servers.local).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'server'], env: {} })
  })

  it('rejects type = "stdio" on a url server', () => {
    const { servers, errors } = normalize({ web: { type: 'stdio', url: 'https://mcp.example.com/mcp' } })
    expect(servers.web).toBeUndefined()
    expect(errors).toEqual(['Codex MCP server "web": type "stdio" cannot be combined with an HTTP endpoint'])
  })

  it('rejects an http type on a command server', () => {
    const { servers, errors } = normalize({ local: { type: 'http', command: 'npx' } })
    expect(servers.local).toBeUndefined()
    expect(errors).toEqual(['Codex MCP server "local": type "http" cannot be combined with a stdio command'])
  })

  it('rejects a type value outside the known set', () => {
    const { servers, errors } = normalize({ web: { type: 'websocket', url: 'https://mcp.example.com/mcp' } })
    expect(servers.web).toBeUndefined()
    expect(errors).toEqual(['Codex MCP server "web": type must be one of stdio, http, sse, streamable-http, streamable_http'])
  })

  it('rejects a non-string type', () => {
    const { servers, errors } = normalize({ web: { type: 123, url: 'https://mcp.example.com/mcp' } })
    expect(servers.web).toBeUndefined()
    expect(errors).toEqual(['Codex MCP server "web": type must be a non-empty string'])
  })

  it('keeps servers without a type exactly as before', () => {
    const { servers, errors } = normalize({
      local: { command: 'npx', args: ['-y', 'server'], env: { KEY: 'value' } },
      web: { url: 'https://mcp.example.com/mcp', http_headers: { 'X-Key': 'k' } }
    })
    expect(errors).toEqual([])
    expect(servers.local).toEqual({ type: 'stdio', command: 'npx', args: ['-y', 'server'], env: { KEY: 'value' } })
    expect(servers.web).toEqual({ type: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: { 'X-Key': 'k' } })
  })

  it('still rejects fields outside the allow-list with the same message', () => {
    const { servers, errors } = normalize({ web: { url: 'https://mcp.example.com/mcp', experimental: true } })
    expect(servers.web).toBeUndefined()
    expect(errors).toEqual(['Codex MCP server "web": unsupported fields: experimental'])
  })

  it('keeps the HTTP-options diagnostic ahead of the type check', () => {
    const { errors } = normalize({ mixed: { type: 'http', command: 'npx', url: 'https://mcp.example.com/mcp' } })
    expect(errors).toEqual(['Codex MCP server "mixed": HTTP options cannot be combined with a stdio command'])
  })

  it('keeps the stdio-options diagnostic ahead of the type check', () => {
    const { errors } = normalize({ mixed: { type: 'stdio', url: 'https://mcp.example.com/mcp', args: ['x'] } })
    expect(errors).toEqual(['Codex MCP server "mixed": stdio options cannot be combined with an HTTP endpoint'])
  })

  it('drops only the server whose type is unusable', () => {
    const { servers, errors } = normalize({
      broken: { type: 'websocket', url: 'https://mcp.example.com/mcp' },
      healthy: { type: 'http', url: 'https://mcp.finnhub.io/mcp' }
    })
    expect(servers.healthy).toEqual({ type: 'streamable-http', url: 'https://mcp.finnhub.io/mcp', headers: {} })
    expect(Object.keys(servers)).toEqual(['healthy'])
    expect(errors).toEqual(['Codex MCP server "broken": type must be one of stdio, http, sse, streamable-http, streamable_http'])
  })
})
