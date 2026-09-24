import { describe, expect, it } from 'vitest'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { deleteMcpAuthGrant, MCP_AUTH_RECORD_SCOPE, mcpAuthRecordId, mcpAuthRecordKey } from '../src/runtime/mcp/mcp-auth-record.js'

describe('MCP OAuth grant record addressing', () => {
  it('folds a server name into the credential-key id grammar', () => {
    expect(mcpAuthRecordId('cloudflare__cloudflare-api')).toBe('cloudflare-cloudflare-api')
    expect(mcpAuthRecordId('DeepSeek_Search')).toBe('deepseek-search')
    expect(mcpAuthRecordId('  a  b  ')).toBe('a-b')
    // Deterministic: the same server always folds to the same id.
    expect(mcpAuthRecordId('My_Server#2')).toBe(mcpAuthRecordId('My_Server#2'))
    expect(mcpAuthRecordId('a___b')).toBe('a-b')
  })

  it('falls back to a valid id when folding would empty the string', () => {
    expect(mcpAuthRecordId('___')).toBe('server')
    expect(mcpAuthRecordId('##')).toBe('server')
  })

  it('builds the record key with the real host credential grammar', () => {
    // credentialKey throws for segments outside its grammar, so this equality
    // also proves the folded id is a key the host accepts.
    expect(mcpAuthRecordKey('Cloudflare__API v2')).toBe(credentialKey(MCP_AUTH_RECORD_SCOPE, 'cloudflare-api-v2'))
    expect(mcpAuthRecordKey('weather')).toBe(credentialKey('mcp-auth', 'weather'))
  })
})

describe('dropping one MCP OAuth grant record', () => {
  it('throws when the credentials service is not mounted', async () => {
    await expect(deleteMcpAuthGrant(undefined, 'weather')).rejects.toThrow('credentials service is not mounted')
    await expect(deleteMcpAuthGrant({}, 'weather')).rejects.toThrow('credentials service is not mounted')
    await expect(deleteMcpAuthGrant({ deleteRecord: 'not a function' }, 'weather')).rejects.toThrow('credentials service is not mounted')
  })

  it('deletes exactly the folded record key', async () => {
    const deleted: string[] = []
    const store = {
      deleteRecord: async (key: string) => {
        deleted.push(key)
      }
    }
    await deleteMcpAuthGrant(store, 'Cloudflare__API')
    expect(deleted).toEqual([credentialKey('mcp-auth', 'cloudflare-api')])
  })

  it('propagates the store failure instead of reporting a silent success', async () => {
    const store = {
      deleteRecord: async () => {
        throw new Error('keychain is locked')
      }
    }
    await expect(deleteMcpAuthGrant(store, 'weather')).rejects.toThrow('keychain is locked')
  })
})
