/**
 * Which delegation surface a deployment runs.
 *
 * Team messaging addresses Team members, not standalone children created through
 * `ctx.subagents`. Deployments can expose both creation paths. Host tool
 * activation belongs to the local DSH profile, not this plugin.
 *
 * Two delegation surfaces in one session therefore compete for the same work
 * and disagree about how to name a child. This module keeps one of them: the
 * standalone role surface stays mounted only while Agent Teams is absent.
 * Team deployments mount the role-aware teammate entry through a separate inject.
 * @module runtime/agents/agent-teams-seat
 */
import type { Context } from '@deepseek-ai/cordis'
import { optionalService } from '../core/context.js'

/** The host service Agent Teams publishes; its presence is the activation signal. */
const AGENT_TEAMS_SERVICE = 'agentTeams'

/**
 * Whether this context's deployment activated Agent Teams.
 *
 * Presence of the service is the signal rather than a tool lookup: the service
 * is what the Team tools are installed from, so a deployment cannot run them
 * without it, and it is readable from any scope through `ctx.get`.
 * @param ctx - any host context; the read tolerates strict mode and absence.
 * @returns true when Agent Teams owns delegation in this deployment.
 */
export function agentTeamsActive(ctx: unknown): boolean {
  return optionalService(ctx, AGENT_TEAMS_SERVICE) !== undefined
}

/**
 * Keep one model-facing surface mounted only while Agent Teams is absent.
 *
 * Presence can change after this plugin mounts: the deployment loads its
 * bundles independently, so the Team service may register from a sibling fiber
 * at any point in the boot. The registration event re-evaluates the seat, so a
 * surface that was already published is withdrawn rather than left to compete.
 *
 * Withdrawal removes the tool and its catalog listener. Guidance already
 * delivered earlier in a session is part of that session's history and stays
 * there. The Team catalog publishes replacement guidance when its enhanced
 * entry is ready; neither registration rewrites earlier session history.
 * @param ctx - host context carrying the tools registry and the event bus.
 * @param mount - mounts the surface and returns its disposer.
 * @returns the disposer that unsubscribes and withdraws a mounted surface.
 */
export function mountUnlessAgentTeams(ctx: Context, mount: () => () => void): () => void {
  let dispose: (() => void) | undefined
  const sync = (): void => {
    if (agentTeamsActive(ctx)) {
      if (dispose === undefined) return
      dispose()
      dispose = undefined
      ctx.logger?.info?.('[dsh-agent-plugins-market] subagent_role stands down: this deployment runs Agent Teams, which owns delegation')
      return
    }
    if (dispose === undefined) dispose = mount()
  }
  sync()
  // The event fires for every service registration, so the seat re-reads only
  // for the one it cares about; that read is what makes a late mount visible.
  const off = ctx.on(
    'internal/service',
    (name: string) => {
      if (name === AGENT_TEAMS_SERVICE) sync()
    },
    { global: true }
  )
  return () => {
    off()
    dispose?.()
    dispose = undefined
  }
}
