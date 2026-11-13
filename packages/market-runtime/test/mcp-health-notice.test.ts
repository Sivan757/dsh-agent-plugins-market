/**
 * The notices a session receives when an MCP server stops serving tools.
 *
 * The supervisor keeps a dead server's tools registered while it retries and
 * unregisters them when it gives up; either way the conversation said nothing.
 * These cases pin what a reader sees (one line, in the interface language) and
 * what the model reads (the same event plus the suite behind it), and that
 * delivery never starts a turn.
 *
 * @module test/mcp-health-notice
 */
import { describe, expect, it } from 'vitest'
import { bindHostLocale } from '../src/runtime/host/host-locale.js'
import { mcpHealthNoticeCopy, mountMcpHealthNotices, type McpHealthEventSource } from '../src/runtime/host/mcp-health-notice.js'
import type { McpHealthEvent } from '../../market-contracts/src/contracts/mcp-health.js'

const NOW = 1_760_000_000_000

const owner = { suiteId: '@user-mcp/user-mcp', serverKey: 'signoz' }

const problem = {
  serverName: 'signoz',
  owner,
  observation: {
    serverName: 'signoz',
    phase: 'reconnecting' as const,
    since: NOW - 5_000,
    attempt: 3,
    maxAttempts: 10,
    retryAt: NOW + 2_000,
    error: 'socket hang up'
  }
}

/** The message shape this module injects. */
interface InjectedMessage {
  content: readonly { type: string; text?: string }[]
  source: Record<string, unknown>
}

/** A source that lets a test publish one transition. */
function sourceOf(): { source: McpHealthEventSource; publish: (event: McpHealthEvent) => void; subscribers: () => number } {
  const listeners = new Set<(event: McpHealthEvent) => void>()
  return {
    source: {
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    },
    publish: event => {
      for (const listener of [...listeners]) listener(event)
    },
    subscribers: () => listeners.size
  }
}

/** An agent stub that records what it was handed. */
function agentOf(messages: InjectedMessage[], fail = false): { inject(message: InjectedMessage): void } {
  return {
    inject(message) {
      if (fail) throw new Error('session closed')
      messages.push(message)
    }
  }
}

describe('MCP health notices', () => {
  it('writes a degraded notice in the interface language', () => {
    const zh = mcpHealthNoticeCopy({ kind: 'degraded', problem }, bindHostLocale('zh'), NOW)
    expect(zh.text).toContain('MCP 服务器 signoz')
    expect(zh.text).toContain('套件 @user-mcp/user-mcp')
    expect(zh.text).toContain('第 3/10 次')
    expect(zh.text).toContain('约 2 秒后重试')
    expect(zh.text).toContain('socket hang up')
    expect(zh.summary).toBe('signoz 连接断开，重连中 3/10')

    const en = mcpHealthNoticeCopy({ kind: 'degraded', problem }, bindHostLocale('en'), NOW)
    expect(en.text).toContain('MCP server signoz')
    expect(en.text).toContain('(suite @user-mcp/user-mcp, server key signoz)')
    expect(en.text).toContain('attempt 3/10')
    expect(en.text).toContain('retrying in about 2s')
    expect(en.summary).toBe('signoz disconnected, retrying 3/10')
  })

  it('says a stopped server unregistered its tools, without a countdown', () => {
    const stopped = { ...problem, observation: { ...problem.observation, phase: 'failed' as const, attempt: 10, retryAt: undefined } }
    const zh = mcpHealthNoticeCopy({ kind: 'stopped', problem: stopped }, bindHostLocale('zh'), NOW)
    expect(zh.text).toContain('已停止重连')
    expect(zh.text).toContain('重新挂载前不可用')
    expect(zh.text).not.toContain('秒后重试')
    expect(zh.summary).toBe('signoz 已停止重连，工具不可用')
  })

  it('writes the recovery in the interface language', () => {
    const zh = mcpHealthNoticeCopy({ kind: 'recovered', serverName: 'signoz', owner }, bindHostLocale('zh'), NOW)
    expect(zh.text).toContain('已恢复连接')
    expect(zh.summary).toBe('signoz 已恢复连接')
  })

  it('delivers one notice to every live session, as a notice and never as a wake', () => {
    const { source, publish, subscribers } = sourceOf()
    const first: InjectedMessage[] = []
    const second: InjectedMessage[] = []
    const ctx = { agents: { list: () => [agentOf(first), agentOf(second)] } }

    const dispose = mountMcpHealthNotices(ctx as never, source, { locale: () => 'en', now: () => NOW })
    expect(subscribers()).toBe(1)

    publish({ kind: 'degraded', problem })

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(1)
    expect(first[0]?.source).toMatchObject({ kind: 'plugin-market-mcp', form: 'notice', summary: 'signoz disconnected, retrying 3/10' })
    expect(first[0]?.content[0]?.text).toContain('MCP server signoz')
    // One message per session: the identity is never shared across inboxes.
    expect(first[0]).not.toBe(second[0])

    dispose()
    expect(subscribers()).toBe(0)
  })

  it('skips the sessions a filter excludes', () => {
    const { source, publish } = sourceOf()
    const kept: InjectedMessage[] = []
    const skipped: InjectedMessage[] = []
    const visible = agentOf(kept)
    const hidden = agentOf(skipped)
    const ctx = { agents: { list: () => [visible, hidden] } }

    mountMcpHealthNotices(ctx as never, source, {
      locale: () => 'en',
      now: () => NOW,
      eligible: agent => agent === (visible as never)
    })
    publish({ kind: 'recovered', serverName: 'signoz', owner })

    expect(kept).toHaveLength(1)
    expect(skipped).toHaveLength(0)
  })

  it('keeps delivering after one session refuses the message', () => {
    const { source, publish } = sourceOf()
    const delivered: InjectedMessage[] = []
    const ctx = { agents: { list: () => [agentOf([], true), agentOf(delivered)] } }

    mountMcpHealthNotices(ctx as never, source, { locale: () => 'zh', now: () => NOW })
    expect(() => publish({ kind: 'stopped', problem })).not.toThrow()
    expect(delivered).toHaveLength(1)
  })

  it('does nothing when the host serves no agent registry', () => {
    const { source, publish } = sourceOf()
    const dispose = mountMcpHealthNotices({} as never, source, { locale: () => 'zh', now: () => NOW })
    expect(() => publish({ kind: 'degraded', problem })).not.toThrow()
    dispose()
  })
})
