/**
 * The one system-prompt section that says which MCP servers are not serving
 * their tools right now.
 *
 * The section is registered once, globally: MCP mounts belong to the process,
 * not to a workspace, so every agent reads the same health. Its text is empty
 * while everything is healthy, which keeps a working session's prompt free of
 * health noise.
 *
 * The text is fixed English, like the harness's own MCP sections and tool
 * descriptions: it is a contract read beside them, not an interface string. The
 * one-line notices a session receives are the user-facing copy and are
 * localized.
 *
 * @module runtime/host/mcp-health-section
 */
import type { Context } from '@deepseek-ai/cordis'
import type { McpHealthProblem } from '../../../../market-contracts/src/contracts/mcp-health.js'

/** The section name; unique across the assembled prompt. */
export const MCP_HEALTH_SECTION_NAME = 'market:mcp-health'

/** The slice of the host system-prompt service this module uses. */
export interface PromptHost {
  section(section: { name: string; order: number; interpolate?: boolean; text: () => string }): () => void
  getSectionOrder(name: 'MCP_SERVERS'): number
}

/**
 * Render one problem as the prompt's single line.
 * @param problem - the unavailable server.
 * @param now - epoch ms the render happens at, for the retry countdown.
 * @returns one line, without a leading marker.
 */
function absentLine(problem: McpHealthProblem, now: number): string {
  const { observation, owner } = problem
  const origin = owner === undefined ? '' : ` (suite \`${owner.suiteId}\`, server key \`${owner.serverKey}\`)`
  const error = observation.error === undefined ? '' : ` Last error: ${observation.error}`
  if (observation.phase === 'failed') {
    // The supervisor publishes the attempt that ended the outage, one past the
    // budget it spent; a disabled policy stops before that budget is reached.
    const stop = observation.attempt > observation.maxAttempts ? `stopped after ${observation.maxAttempts} failed attempts` : 'stopped retrying'
    return `\`${problem.serverName}\`${origin}: ${stop}, so its tools were unregistered and stay unavailable until the mount is retried.${error}`
  }
  const retry = observation.retryAt === undefined ? '' : `, next attempt in about ${Math.max(1, Math.round((observation.retryAt - now) / 1000))}s`
  return `\`${problem.serverName}\`${origin}: reconnecting (attempt ${observation.attempt}/${observation.maxAttempts}${retry}) — calls to its tools fail until it returns.${error}`
}

/**
 * Render the whole section text.
 * @param problems - every server that cannot serve its tools; already sorted by name.
 * @param now - epoch ms the render happens at.
 * @returns the section body, or an empty string while every server is healthy.
 */
export function mcpHealthSectionText(problems: readonly McpHealthProblem[], now: number): string {
  if (problems.length === 0) return ''
  return [
    '## MCP servers not serving tools (dsh-agent-plugins-market)',
    '',
    'These MCP servers are unavailable right now, so the tools the suites below declare are missing or failing:',
    ...problems.map(problem => `- ${absentLine(problem, now)}`),
    '',
    'Do not assume those tools exist. Name the missing capability to the user before proposing a workaround.'
  ].join('\n')
}

/**
 * Mount the health section on the host system-prompt service.
 *
 * @param ctx - context whose `systemPrompt` service the section registers on.
 * @param problems - reads the current unavailable servers; called at every assembly.
 * @param now - clock, injected so a render is reproducible.
 * @returns the disposer releasing the registration.
 */
export function mountMcpHealthSection(ctx: Context, problems: () => readonly McpHealthProblem[], now: () => number = Date.now): () => void {
  const prompt = (ctx as unknown as { get?: (name: string) => unknown }).get?.('systemPrompt') as PromptHost | undefined
  if (prompt === undefined || typeof prompt.section !== 'function') return () => {}
  return prompt.section({
    name: MCP_HEALTH_SECTION_NAME,
    order: prompt.getSectionOrder('MCP_SERVERS') + 1,
    // Authored text, not a template: a suite id containing braces must reach
    // the model as written instead of failing assembly on an unknown variable.
    interpolate: false,
    text: () => mcpHealthSectionText(problems(), now())
  })
}
