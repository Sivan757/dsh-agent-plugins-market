/**
 * The plugin entry actually mounts the connection-health wiring.
 *
 * The unit tests own each link; this case owns the composition root, which is
 * the one place a feature can exist and never be switched on. It boots the real
 * apply() against a minimal host and checks that a published phase edge reaches
 * both surfaces: the prompt section and the session.
 *
 * @module test/mcp-health-plugin-apply
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../../../../packages/market-bundle/src/index.js'
import { forgetMcpConnection, recordMcpConnection } from '../../../../packages/market-mcp/src/runtime/mcp/mcp-connection-registry.js'
import type { McpConnectionObservation } from '../../../../packages/market-contracts/src/contracts/mcp-status.js'

const NOW = Date.now()

/** One published phase edge for the synthetic server. */
function observation(patch: Partial<McpConnectionObservation>): McpConnectionObservation {
  return { serverName: 'signoz', phase: 'reconnecting', since: NOW, attempt: 1, maxAttempts: 10, ...patch }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  forgetMcpConnection('signoz')
})

describe('MCP health is mounted by the plugin entry', () => {
  it('turns a published phase edge into a prompt section and a session notice', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-plugins-health-'))
    vi.stubEnv('DSH_HOME', root)
    vi.stubEnv('DSH_AGENTS_HOME', join(root, 'agents'))

    const sections: Array<{ name: string; text: () => string }> = []
    const prompt = {
      section(section: { name: string; order: number; interpolate?: boolean; text: () => string }) {
        sections.push(section)
        return () => {}
      },
      getSectionOrder: () => 3100
    }
    const messages: Array<{ content: readonly { text?: string }[]; source: Record<string, unknown> }> = []
    const agents = { list: () => [{ inject: (message: never) => messages.push(message) }] }
    const cleanups: Array<() => void> = []
    const state = { mcpEnhanced: true, feedbackEnabled: false, downloadRegion: 'auto' }
    const context = {
      skills: { registerProvider: () => {} },
      on: () => () => {},
      effect: (effect: () => () => void) => cleanups.push(effect()),
      get: (name: string) => (name === 'systemPrompt' ? prompt : name === 'agents' ? agents : undefined),
      inject: (services: string[], callback: (value: unknown) => void) => {
        // Only the two seams this feature mounts on; every other service stays
        // absent, exactly as a deployment without it would. The injected context
        // keeps the root's `effect`, which is what registers each mount.
        const child = { get: context.get, effect: context.effect, logger: context.logger }
        if (services.length === 1 && services[0] === 'systemPrompt') callback({ ...child, systemPrompt: prompt })
        if (services.length === 1 && services[0] === 'agents') callback({ ...child, agents })
      },
      logger: { info: () => {}, warn: () => {}, error: () => {} }
    }

    await apply(
      context as never,
      {
        mcpEnhanced: { get: () => state.mcpEnhanced },
        scanProjectLayouts: { get: () => true },
        downloadRegion: { get: () => state.downloadRegion },
        feedbackEnabled: { get: () => state.feedbackEnabled },
        autoUpdateSources: { get: () => false }
      } as never
    )

    const health = sections.find(section => section.name === 'market:mcp-health')
    expect(health).toBeDefined()
    expect(health?.text()).toBe('')

    recordMcpConnection(observation({ attempt: 2, retryAt: NOW + 2_000, error: 'socket hang up' }))

    expect(health?.text()).toContain('signoz')
    expect(health?.text()).toContain('reconnecting (attempt 2/10')
    expect(messages).toHaveLength(1)
    expect(messages[0]?.source).toMatchObject({ kind: 'plugin-market-mcp', form: 'notice' })

    recordMcpConnection(observation({ phase: 'connected', attempt: 0, retryAt: undefined }))
    expect(health?.text()).toBe('')
    expect(messages).toHaveLength(2)

    cleanups.forEach(cleanup => cleanup())
  })
})
