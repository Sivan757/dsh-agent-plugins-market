/**
 * The prompt section that tells a session which MCP servers cannot serve tools.
 *
 * A dead server used to be invisible to the model: its tools simply stopped
 * appearing in the next request. These cases pin the empty-when-healthy rule,
 * the attribution that names the suite behind each server, and the retry
 * countdown the section renders from the supervisor's next-attempt timestamp.
 *
 * @module test/mcp-health-section
 */
import { describe, expect, it } from 'vitest'
import { MCP_HEALTH_SECTION_NAME, mcpHealthSectionText, mountMcpHealthSection } from '../src/runtime/host/mcp-health-section.js'
import type { McpHealthProblem } from '../../market-contracts/src/contracts/mcp-health.js'
import type { McpConnectionObservation } from '../../market-contracts/src/contracts/mcp-status.js'

const NOW = 1_760_000_000_000

const owner = { suiteId: '@user-mcp/user-mcp', serverKey: 'signoz' }

type ProblemPatch = Omit<Partial<McpHealthProblem>, 'observation'> & { observation?: Partial<McpConnectionObservation> }

function problem(patch: ProblemPatch = {}): McpHealthProblem {
  const { observation: patchObservation, ...rest } = patch
  return {
    serverName: 'signoz',
    owner,
    observation: { serverName: 'signoz', phase: 'reconnecting', since: NOW - 5_000, attempt: 3, maxAttempts: 10, retryAt: NOW + 2_000, ...patchObservation },
    ...rest
  }
}

describe('MCP health prompt section', () => {
  it('renders nothing while every server is healthy', () => {
    expect(mcpHealthSectionText([], NOW)).toBe('')
  })

  it('names the suite, the retry countdown, and the last error of a reconnecting server', () => {
    const text = mcpHealthSectionText([problem({ observation: { error: 'Client network socket disconnected' } })], NOW)

    expect(text).toContain('## MCP servers not serving tools (dsh-agent-plugins-market)')
    expect(text).toContain('signoz')
    expect(text).toContain('(suite ')
    expect(text).toContain('@user-mcp/user-mcp')
    expect(text).toContain('server key ')
    expect(text).toContain('): reconnecting (attempt 3/10, next attempt in about 2s)')
    expect(text).toContain('calls to its tools fail until it returns')
    expect(text).toContain('Last error: Client network socket disconnected')
    expect(text).toContain('Do not assume those tools exist')
  })

  it('says a stopped server unregistered its tools', () => {
    // The supervisor publishes the attempt that ended the outage, one past the budget.
    const text = mcpHealthSectionText([problem({ observation: { phase: 'failed', attempt: 11, retryAt: undefined } })], NOW)

    expect(text).toContain('stopped after 10 failed attempts')
    expect(text).toContain('its tools were unregistered')
    expect(text).not.toContain('next attempt in about')
  })

  it('does not claim a spent budget when reconnecting is simply disabled', () => {
    const text = mcpHealthSectionText([problem({ observation: { phase: 'failed', attempt: 0, retryAt: undefined, reason: 'reconnect-disabled' } })], NOW)

    expect(text).toContain('stopped retrying')
    expect(text).not.toContain('stopped after 10 failed attempts')
  })

  it('omits the attribution when the registry forgot the owner', () => {
    const text = mcpHealthSectionText([{ ...problem(), owner: undefined }], NOW)

    expect(text).toContain('signoz')
    expect(text).not.toContain('(suite ')
  })

  it('registers one global section and reads the live list on every assembly', () => {
    let problems: McpHealthProblem[] = []
    const registered: Array<{ name: string; order: number; interpolate?: boolean; text: () => string }> = []
    const disposed: string[] = []
    const prompt = {
      section(section: { name: string; order: number; interpolate?: boolean; text: () => string }): () => void {
        registered.push(section)
        return () => disposed.push(section.name)
      },
      getSectionOrder: () => 3100
    }
    const ctx = { get: (name: string) => (name === 'systemPrompt' ? prompt : undefined) }

    const dispose = mountMcpHealthSection(
      ctx as never,
      () => problems,
      () => NOW
    )

    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({ name: MCP_HEALTH_SECTION_NAME, order: 3101, interpolate: false })
    expect(registered[0]?.text()).toBe('')

    problems = [problem()]
    expect(registered[0]?.text()).toContain('signoz')

    dispose()
    expect(disposed).toEqual([MCP_HEALTH_SECTION_NAME])
  })

  it('mounts nothing when the host serves no system-prompt service', () => {
    const dispose = mountMcpHealthSection({ get: () => undefined } as never, () => [problem()])
    expect(() => dispose()).not.toThrow()
  })
})
