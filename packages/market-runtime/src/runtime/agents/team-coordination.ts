/** Role-aware Team workflow, independent of whether any specialty roles are installed. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TeamService } from '@deepseek-ai/dsh-experimental-agent-team'
import type { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'

const LEAD_GUIDANCE = [
  'You are the Team Lead. Own clarification of user intent, scope and trade-offs, shared interfaces, direction changes, integration and final acceptance.',
  'Once the user has authorized Agent Teams, proactively delegate suitable self-contained research, broad exploration, investigation, scoped implementation and independent verification within that authorization. Keep trivial work local and preserve any additional approval requirements for risky actions or expanded scope.',
  'Delegate independent units together when safe. A research brief may ask explicit unknown questions; do not finish the research yourself before assigning it. State the goal and why it matters, known evidence, open questions, working directory, read/write boundaries, dependencies, expected deliverable and stopping criteria.',
  'If the "subagent-catalog" message and spawn_teammate_role are available, check for a matching specialty before creating a member. Use the enhanced entry for a match; otherwise, including an absent catalog or a required fork, use native spawn_teammate. Never choose a mismatched role merely to obtain model parameters. Reuse an existing member for related follow-up work.',
  'While members work, continue useful independent work and user clarification without redoing their assignments or writing in their owned scopes. When the user changes direction, update the shared task and message affected existing members with what changed and what remains valid. Stop obsolete work and confirm handoff before assigning overlapping work elsewhere.',
  'Do not poll status or use wait_agent merely to collect a completion. The host delivers member messages and settlement notices. Give a progress update or return control for further user input when appropriate; this is not a final completion claim. Before declaring the whole task complete, collect required member results, verify their evidence and the combined changes, and report unresolved issues honestly.'
].join('\n')

const MEMBER_GUIDANCE = [
  'Work on the assigned execution or research unit within its boundaries; the Lead owns user clarification and cross-task decisions. Send important findings, conflicts and blockers early rather than narrating every tool call.',
  'Ask the Lead for the smallest decision needed, with evidence and a proposed option. Continue independent parts while waiting for direction, but pause blocked or conflicting writes instead of inventing requirements or expanding scope. A change of direction updates the current assignment; it is not permission to start unrelated work.',
  'Before finishing, report the outcome, changed files or research findings, verification evidence and remaining risks or blockers to the Lead. Sending a message does not end your turn. A task is complete only when its acceptance criteria are met; mark its shared task accordingly. Keep commit, publish and other external actions within the explicit assignment permissions.',
  'Do not poll for instructions or call wait_agent merely to stay alive. The Lead can send follow-up work to this member; finish with a clear checkpoint when no independent work remains.'
].join('\n')

/**
 * Resolve the current Agent from each assembly, not from a retained parent scope.
 * Native and role-created members share this section; missing/stale/non-Team scopes
 * render nothing. Cordis owns registration cleanup through the returned disposer.
 */
export function mountTeamCoordination(ctx: Context): () => void {
  const agents = ctx.get('agents') as Context['agents']
  const teams = ctx.get('agentTeams') as TeamService
  const prompt = ctx.get('systemPrompt') as SystemPrompt
  return prompt.section({
    name: 'market:team-coordination',
    order: prompt.getSectionOrder('TEAM_POLICY') + 1,
    interpolate: false,
    text({ scope }) {
      if (scope === undefined || scope === null || typeof scope !== 'object' || !('id' in scope) || typeof scope.id !== 'string') return ''
      const candidate = scope as Agent
      if (agents.get(candidate.id) !== candidate) return ''
      const membership = teams.tryMembership(candidate)
      if (membership === undefined) return ''
      const identity =
        membership.role === 'lead'
          ? LEAD_GUIDANCE
          : [
              `You are teammate ${JSON.stringify(membership.name)}. Your Team Lead is addressed as "lead".`,
              'Use send_message({ target: "lead", message: "..." }) for Lead communication. Use list_agents({}) to identify peers, and their returned targets for peer messages.',
              MEMBER_GUIDANCE
            ].join('\n')
      return [
        '## Team coordination',
        'Follow the host Team authorization, tool contracts, workspace safety and permission rules. This guidance does not authorize creating members on its own.',
        identity
      ].join('\n')
    }
  })
}
