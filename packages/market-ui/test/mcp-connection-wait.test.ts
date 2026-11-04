/**
 * What the MCP panel knows about a connection that is waiting to retry.
 *
 * The supervisor names its own next attempt, so the panel can sleep until then
 * instead of polling, and it can say how long the wait is. Both facts come from
 * the same field, so one test file covers the sentence and the schedule.
 */
import { describe, expect, it } from 'vitest'
import type { McpStatusEntry } from '../src/api.js'
import type { Translate } from '../src/i18n.js'
import { zh } from '../src/locales.js'
import { CONNECTION_READ_CEILING_MS, CONNECTION_READ_FALLBACK_MS, CONNECTION_READ_FLOOR_MS, nextConnectionRead } from '../src/features/mcp/mcp-status-view-model.js'
import { mcpConnectionNote } from '../src/features/mcp/state-helpers.js'

/** The zh dictionary with its placeholders filled, so a tested sentence is the rendered one. */
const t = ((key: string, params?: Record<string, string>) => {
  const template = (zh as Record<string, string>)[key] ?? key
  return params === undefined ? template : template.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
}) as Translate

type Connection = NonNullable<McpStatusEntry['connection']>

/** One row, with the observation fields the supervisor always sets. */
function row(connection: Partial<Connection> | undefined, id = 'demo:one'): McpStatusEntry {
  return {
    id,
    name: 'one',
    kind: 'plugin',
    state: connection === undefined || connection.phase === 'connected' ? 'connected' : 'degraded',
    transport: 'stdio',
    tools: [],
    ...(connection === undefined ? {} : { connection: { serverName: id, since: 0, ...connection } as Connection })
  }
}

describe('the wait a reconnecting row announces', () => {
  it("counts the seconds down from the supervisor's own next attempt", () => {
    const note = mcpConnectionNote(t, row({ phase: 'reconnecting', attempt: 2, maxAttempts: 5, retryAt: 45_000 }), 0)
    expect(note).toContain('正在重连')
    expect(note).toContain('45 秒后重试')
  })

  it('drops the countdown once the attempt is due, rather than showing a negative wait', () => {
    const note = mcpConnectionNote(t, row({ phase: 'reconnecting', attempt: 2, maxAttempts: 5, retryAt: 1_000 }), 5_000)
    expect(note).not.toContain('秒后重试')
  })

  it('says how long the row has been down, in seconds and then in minutes', () => {
    // The attempt count answers "how often", the countdown answers "how soon", and this
    // answers "how long already" — the half of "why is this taking so long" nobody could
    // see before.
    expect(mcpConnectionNote(t, row({ phase: 'reconnecting', attempt: 2, maxAttempts: 5, since: 1_000 }), 47_000)).toContain('已断开 46 秒')
    expect(mcpConnectionNote(t, row({ phase: 'reconnecting', attempt: 9, maxAttempts: 10, since: 0 }), 180_000)).toContain('已断开 3 分钟')
  })

  it('keeps the error and the stop verdict in the same sentence', () => {
    const stopped = mcpConnectionNote(t, row({ phase: 'failed', attempt: 5, maxAttempts: 5, error: 'spawn ENOENT' }), 0)
    expect(stopped).toContain('重连已停止')
    expect(stopped).toContain('spawn ENOENT')
  })
})

describe('when the panel reads the status again by itself', () => {
  it('does not read a payload where nothing moves', () => {
    expect(nextConnectionRead({ entries: [row(undefined)] }, 0)).toBeUndefined()
    expect(nextConnectionRead({ entries: [] }, 0)).toBeUndefined()
  })

  it('waits for the named attempt instead of polling on a fixed interval', () => {
    expect(nextConnectionRead({ entries: [row({ phase: 'reconnecting', attempt: 3, maxAttempts: 5, retryAt: 9_000 })] }, 0)).toBe(9_250)
  })

  it('takes the earliest attempt when several rows are waiting', () => {
    const payload = {
      entries: [row({ phase: 'reconnecting', attempt: 1, maxAttempts: 5, retryAt: 40_000 }, 'a'), row({ phase: 'reconnecting', attempt: 1, maxAttempts: 5, retryAt: 9_000 }, 'b')]
    }
    expect(nextConnectionRead(payload, 0)).toBe(9_250)
  })

  it('keeps polling a connection that names no attempt, and bounds the wait either way', () => {
    expect(nextConnectionRead({ entries: [row({ phase: 'connecting', attempt: 0, maxAttempts: 5 })] }, 0)).toBe(CONNECTION_READ_FALLBACK_MS)
    // A due attempt still gets a moment, so the read sees the attempt's outcome.
    expect(nextConnectionRead({ entries: [row({ phase: 'reconnecting', attempt: 1, maxAttempts: 5, retryAt: 0 })] }, 10_000)).toBe(CONNECTION_READ_FLOOR_MS)
    // A very long backoff still wakes the panel now and then, so a change made
    // in another surface shows up.
    expect(nextConnectionRead({ entries: [row({ phase: 'reconnecting', attempt: 4, maxAttempts: 5, retryAt: 120_000 })] }, 0)).toBe(CONNECTION_READ_CEILING_MS)
  })
})
