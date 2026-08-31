import { describe, expect, it } from 'vitest'
import { buildSuiteDetail } from '../src/application/details.js'
import type { Suite } from '../src/model/types.js'

function suite(): Suite {
  return {
    sourceId: 'demo',
    id: 'demo',
    root: '/tmp/demo',
    manifest: { layout: 'agent-plugin-v1', path: '/tmp/demo/plugin.json', id: 'demo', name: 'demo' },
    skills: [],
    mcp: {
      schema: 'native-client',
      servers: {
        service: {
          type: 'stdio',
          command: 'node',
          env: { API_TOKEN: '${API_TOKEN}' },
          args: ['--token', 'literal-secret']
        }
      }
    },
    surfaces: { skills: 0, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 0 },
    dimension: 'user',
    enabled: true,
    errors: []
  }
}

describe('suite detail MCP redaction', () => {
  it('redacts literal credentials and exposes only placeholder references', async () => {
    const detail = await buildSuiteDetail(suite(), undefined, [], {
      service: { env: { API_TOKEN: '${API_TOKEN}' } }
    })
    const server = detail.mcpServers[0]!

    expect(server.credentialRefs).toEqual(['API_TOKEN'])
    expect(JSON.stringify(detail)).not.toContain('literal-secret')
    expect(JSON.stringify(detail)).toContain('${API_TOKEN}')
    expect(server.env).toEqual({ API_TOKEN: '${API_TOKEN}' })
  })
})
