// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { deriveMarketViewModel } from '../../../../packages/market-ui/src/features/market/market-view-model.js'
import { matchesMcpFilter, type McpStatusFilter } from '../../../../packages/market-ui/src/features/mcp/mcp-status-view-model.js'
import type { OverviewData } from '../../../../packages/market-ui/src/api.js'
import type { McpStatusPayload } from '../../../../packages/market-contracts/src/contracts/mcp-status.js'

const overview: OverviewData = {
  sources: [],
  suites: [
    {
      sourceId: 'alpha',
      suiteId: 'one',
      name: 'Alpha One',
      description: 'Searchable',
      keywords: ['first'],
      surfaces: { skills: 1, mcp: 0, hooks: 0, commands: 0, agents: 0, lsp: 0 },
      enabled: true,
      installed: true,
      dimension: 'user',
      layout: 'universal',
      errors: []
    },
    {
      sourceId: 'alpha',
      suiteId: 'two',
      name: 'Alpha Two',
      description: 'Other',
      keywords: [],
      surfaces: { skills: 0, mcp: 1, hooks: 0, commands: 0, agents: 0, lsp: 0 },
      enabled: false,
      installed: false,
      dimension: 'user',
      layout: 'universal',
      errors: []
    },
    {
      sourceId: 'beta',
      suiteId: 'three',
      name: 'Beta Three',
      description: 'Third',
      keywords: [],
      surfaces: { skills: 0, mcp: 0, hooks: 0, commands: 1, agents: 0, lsp: 0 },
      enabled: false,
      installed: true,
      dimension: 'user',
      layout: 'universal',
      errors: []
    }
  ],
  totals: { all: 3, installed: 2, enabled: 1 },
  roots: { user: '/user', data: '/data' }
}

const mcpStatus: McpStatusPayload = {
  entries: [
    { id: 'plugin:one', name: 'one', kind: 'plugin', state: 'connected', transport: 'stdio', tools: [] },
    { id: 'direct:two', name: 'two', kind: 'direct', state: 'failed', transport: 'observed', tools: [], endpoint: 'https://two' },
    { id: 'disabled:three', name: 'three', kind: 'plugin', state: 'disabled', transport: 'stdio', tools: [] }
  ],
  observedAt: '',
  totals: { all: 3, connected: 1, degraded: 0, failed: 1, needsCredentials: 0, orphaned: 0, disabled: 1, foreign: 0 },
  directObservationOnly: true
}

describe('client catalog view models', () => {
  it('derives scoped counts and searchable visible suites', () => {
    const result = deriveMarketViewModel(overview, 'searchable', 'all', 'alpha')
    expect(result.scopeTotals).toEqual({ all: 2, installed: 1, enabled: 1 })
    expect(result.filtered.map(suite => suite.suiteId)).toEqual(['one'])
  })

  it('filters MCP rows by scope, keeping switched-off rows reachable', () => {
    // The shared renderer counts each tab through this one predicate, so the
    // number on a tab is exactly the rows clicking it shows.
    const ids = (filter: McpStatusFilter): string[] => mcpStatus.entries.filter(entry => matchesMcpFilter(entry, filter)).map(entry => entry.id)
    expect(ids('all')).toEqual(['plugin:one', 'direct:two', 'disabled:three'])
    expect(ids('direct')).toEqual(['direct:two'])
    // A switched-off row keeps its own scope as well as the switched-off tab.
    expect(ids('plugin')).toEqual(['plugin:one', 'disabled:three'])
    expect(ids('disabled')).toEqual(['disabled:three'])
  })

  it('records a repeat-filtering baseline for a 5,000-card payload', () => {
    const { suites } = overview
    const large: OverviewData = {
      ...overview,
      suites: Array.from({ length: 5_000 }, (_, index) => {
        const template = suites[index % suites.length]
        if (template === undefined) throw new Error('expected the overview fixture to carry at least one suite')
        return { ...template, suiteId: `suite-${index}`, name: `Suite ${index}` }
      })
    }
    const started = performance.now()
    let visible = 0
    for (let round = 0; round < 20; round++) visible += deriveMarketViewModel(large, 'suite 4', 'all', 'all').filtered.length
    const elapsedMs = performance.now() - started
    console.info(`[client-view-model] 5,000 cards × 20 searches: ${elapsedMs.toFixed(2)}ms; visible=${visible}`)
    expect(visible).toBeGreaterThan(0)
  })
})
