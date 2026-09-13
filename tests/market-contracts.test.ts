import { describe, expect, it } from 'vitest'
import { MARKET_API_PREFIX, MARKET_ROUTES, skillRoute, suiteRoute, type OverviewPayload } from '../src/contracts/market.js'
import type { McpStatusPayload } from '../src/contracts/mcp-status.js'

describe('market transport contracts', () => {
  it('keeps the host and client route paths in one declaration', () => {
    expect(MARKET_API_PREFIX).toBe('/api/agent-plugins/')
    expect(MARKET_ROUTES.overview).toBe('/api/agent-plugins/overview')
    expect(MARKET_ROUTES.mcpStatus).toBe('/api/agent-plugins/mcp-status')
    expect(MARKET_ROUTES.addSource).toBe('/api/agent-plugins/sources/add')
    expect(MARKET_ROUTES.setEnabled).toBe('/api/agent-plugins/set-enabled')
  })

  it('encodes suite and skill query identifiers at the contract seam', () => {
    expect(suiteRoute('source one', 'suite/two')).toBe('/api/agent-plugins/suite?sourceId=source%20one&suiteId=suite%2Ftwo')
    expect(skillRoute('source one', 'suite/two', 'skill#three')).toBe('/api/agent-plugins/skill?sourceId=source%20one&suiteId=suite%2Ftwo&skill=skill%23three')
  })

  it('represents remote overview cards and MCP status as shared records', () => {
    const overview: OverviewPayload = {
      sources: [],
      suites: [
        {
          sourceId: 'market',
          suiteId: 'remote-suite',
          name: 'Remote suite',
          keywords: [],
          surfaces: { skills: 0, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: 0 },
          enabled: false,
          installed: false,
          dimension: 'user',
          layout: 'remote',
          remoteUrl: 'https://example.test/plugin.git',
          errors: []
        }
      ],
      totals: { all: 1, installed: 0, enabled: 0 },
      roots: { user: '/user', data: '/data' }
    }
    const status: McpStatusPayload = {
      entries: [],
      observedAt: '2026-01-01T00:00:00.000Z',
      totals: { all: 0, connected: 0, degraded: 0, failed: 0, needsCredentials: 0, orphaned: 0, disabled: 0, foreign: 0 },
      directObservationOnly: true
    }

    expect(overview.suites[0]?.remoteUrl).toBe('https://example.test/plugin.git')
    expect(status.directObservationOnly).toBe(true)
  })
})
