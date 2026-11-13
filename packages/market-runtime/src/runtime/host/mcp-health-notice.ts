/**
 * Deliver MCP connection transitions to the sessions that lost the tools.
 *
 * A tool that quietly disappears is the failure this module exists for: the
 * supervisor unregisters a dead server's tools, the model's next request simply
 * carries fewer of them, and nothing in the conversation says why. Each
 * transition becomes one user-role message with a one-line `notice` summary, so
 * the reader sees what happened without opening a panel and the model reads the
 * same event with the suite it came from.
 *
 * Delivery uses `inject`, never `followup`: a connection change is never a
 * reason to start a turn. An idle session carries the notice until its next
 * request, which is exactly when the missing tools would have been used.
 *
 * @module runtime/host/mcp-health-notice
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { McpHealthEvent, McpHealthOwner, McpHealthProblem } from '../../../../market-contracts/src/contracts/mcp-health.js'
import { pluginMarketHealthSource } from '../../../../market-contracts/src/host/plugin-message-source.js'
import { bindHostLocale, type HostTranslate } from './host-locale.js'

/** The body and the collapsed one-liner of one notice. */
export interface McpHealthNoticeCopy {
  /** The model- and reader-facing account. */
  text: string
  /** The one-line account the client shows without expanding the row. */
  summary: string
}

/** Where the notices read from and who receives them. */
export interface McpHealthNoticeOptions {
  /** The interface language the notice is written in; `undefined` reads as zh. */
  locale: () => string | undefined
  /**
   * Restrict delivery to some live agents; omitted reaches every one of them.
   * @param agent - the candidate session.
   * @returns false to skip it.
   */
  eligible?: (agent: Agent) => boolean
  /** Clock, injected so a copy is reproducible. */
  now?: () => number
}

/** The source this module subscribes to: the monitor, seen through its own seam. */
export interface McpHealthEventSource {
  subscribe(listener: (event: McpHealthEvent) => void): () => void
}

/** The owning suite and key, as the localized parenthetical. */
function originOf(owner: McpHealthOwner | undefined, translate: HostTranslate): string {
  return owner === undefined ? '' : translate('mcpServerOrigin', { suite: owner.suiteId, key: owner.serverKey })
}

/** The trailing "last error" clause, or nothing when the supervisor recorded none. */
function failureOf(problem: McpHealthProblem, translate: HostTranslate): string {
  const error = problem.observation.error
  return error === undefined ? '' : translate('mcpServerFailureClause', { error })
}

/**
 * Render one transition in the reader's language.
 * @param event - the transition to describe.
 * @param translate - the host copy resolver.
 * @param now - epoch ms the copy is built at, for the retry countdown.
 * @returns the message body and its collapsed summary.
 */
export function mcpHealthNoticeCopy(event: McpHealthEvent, translate: HostTranslate, now: number): McpHealthNoticeCopy {
  if (event.kind === 'recovered') {
    return {
      text: translate('mcpServerRecovered', { server: event.serverName }),
      summary: translate('mcpServerRecoveredSummary', { server: event.serverName })
    }
  }
  const { problem } = event
  const params = {
    server: problem.serverName,
    origin: originOf(problem.owner, translate),
    attempt: String(problem.observation.attempt),
    max: String(problem.observation.maxAttempts)
  }
  if (event.kind === 'stopped') {
    return {
      text: translate('mcpServerStopped', { ...params, failure: failureOf(problem, translate) }),
      summary: translate('mcpServerStoppedSummary', params)
    }
  }
  const retryAt = problem.observation.retryAt ?? now
  return {
    text: translate('mcpServerDegraded', {
      ...params,
      delay: String(Math.max(1, Math.round((retryAt - now) / 1000))),
      failure: failureOf(problem, translate)
    }),
    summary: translate('mcpServerDegradedSummary', params)
  }
}

/**
 * Hand one notice to every eligible live session.
 * @param ctx - context carrying the host agent registry.
 * @param copy - the rendered notice.
 * @param eligible - per-agent delivery filter, when the caller restricts it.
 */
function deliver(ctx: Context, copy: McpHealthNoticeCopy, eligible: ((agent: Agent) => boolean) | undefined): void {
  const registry = (ctx as Context & { agents?: { list?: () => readonly Agent[] } }).agents
  if (registry?.list === undefined) return
  let agents: readonly Agent[]
  try {
    agents = registry.list()
  } catch {
    return
  }
  for (const agent of agents) {
    if (eligible?.(agent) === false) continue
    try {
      agent.inject(
        createUserMessage({
          content: [{ type: 'text', text: copy.text }],
          source: pluginMarketHealthSource(copy.summary)
        })
      )
    } catch {
      // A session disposing under us cannot take the notice; the others still can.
    }
  }
}

/**
 * Mount the notice delivery on one connection-health source.
 * @param ctx - context carrying the host agent registry.
 * @param events - the transitions to deliver; the monitor's own subscription seam.
 * @param options - language, optional targeting, and clock.
 * @returns the disposer ending the subscription.
 */
export function mountMcpHealthNotices(ctx: Context, events: McpHealthEventSource, options: McpHealthNoticeOptions): () => void {
  const now = options.now ?? Date.now
  return events.subscribe(event => {
    deliver(ctx, mcpHealthNoticeCopy(event, bindHostLocale(options.locale()), now()), options.eligible)
  })
}
