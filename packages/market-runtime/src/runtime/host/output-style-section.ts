/**
 * The one system-prompt section an output style contributes, per agent.
 *
 * Registration is per agent scope, never global. A selection belongs to a
 * workspace, each agent runs in one workspace, and a child agent can run in a
 * different one, so a global section would hand a child its parent's style.
 *
 * The section's text provider is synchronous because the host assembles a prompt
 * without awaiting disk reads, so the provider reads the service's cache. That
 * cache is refreshed at mount, on every mutation, on every page read, and each
 * time an agent is created, which is the points at which the selection or the
 * suites behind it can have moved.
 * @module runtime/host/output-style-section
 */
import type { Context } from '@deepseek-ai/cordis'
import { OUTPUT_STYLE_SECTION_NAME, OUTPUT_STYLE_SECTION_ORDER } from '../../../../market-contracts/src/contracts/output-styles.js'
import type { OutputStyleService } from './output-style-service.js'

/** The slice of a live Agent this module reads. */
interface AgentLike {
  ctx: Context & { get?: (name: string) => unknown }
  session?: { header?: { cwd?: string } }
}

/** The slice of the host system-prompt service this module uses. */
interface PromptHost {
  section(section: { name: string; order: number; interpolate?: boolean; text: () => string }): () => void
}

/**
 * Mount the per-agent output-style section.
 *
 * A workspace-less agent gets no section: it has no selection document to read,
 * and inventing one would apply another workspace's style.
 * @param ctx - the context whose `agent/created` and `agent/disposed` events are observed.
 * @param service - the live selection owner.
 * @returns the disposer releasing the subscription and every registration.
 */
export function mountOutputStyleSection(ctx: Context, service: OutputStyleService): () => void {
  const sections = new Map<AgentLike, () => void>()
  const workspaceOf = (agent: AgentLike): string | undefined => {
    const cwd = agent.session?.header?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  }
  const install = (agent: AgentLike): void => {
    if (sections.has(agent)) return
    const workspace = workspaceOf(agent)
    if (workspace === undefined) return
    const prompt = agent.ctx.get?.('systemPrompt') as PromptHost | undefined
    if (prompt === undefined || typeof prompt.section !== 'function') return
    // `interpolate: false` because a style is authored text: the host would
    // otherwise resolve `{{...}}` inside it and fail assembly on a name it does
    // not know, which a style quoting a prompt variable would trigger.
    sections.set(
      agent,
      prompt.section({
        name: OUTPUT_STYLE_SECTION_NAME,
        order: OUTPUT_STYLE_SECTION_ORDER,
        interpolate: false,
        text: () => service.sectionText(workspace)
      })
    )
  }
  const offCreated = ctx.on('agent/created', async ({ agent }) => {
    const workspace = workspaceOf(agent)
    if (workspace === undefined) return
    try {
      await service.refresh(workspace)
    } catch (error) {
      // A selection that cannot be read leaves the prompt without a style. The
      // page reports the failure; a session must still start.
      ctx.logger?.warn?.('[dsh-agent-plugins-market] output style read failed: ' + (error instanceof Error ? error.message : String(error)))
    }
    install(agent)
  })
  const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
    const disposer = sections.get(agent)
    if (disposer === undefined) return
    sections.delete(agent)
    disposer()
  })
  return () => {
    offCreated()
    offDisposed()
    for (const disposer of sections.values()) disposer()
    sections.clear()
  }
}
