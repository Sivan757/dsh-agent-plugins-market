/** Role-aware creation is an additional Team entry point, not another member manager. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { resolveChildAgentOptions } from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { agentRoleCatalog, resolveAgentOptions, resolveRolePolicy, sessionCwd, type AgentRoleEntry } from './agent-role-router.js'
import { mountSubagentCatalog } from './subagent-catalog.js'
import { TeammateRoleRuntime } from './teammate-role-runtime.js'

export const TEAMMATE_ROLE_TOOL_NAME = 'spawn_teammate_role'

/** Install the enhanced tool after its replay listener is ready; teardown drains owned role creations. */
export async function mountTeammateRoleTool(ctx: Context, listRoles: (parent?: unknown) => Promise<AgentRoleEntry[]>): Promise<() => Promise<void>> {
  const runtime = new TeammateRoleRuntime(ctx)
  const cleanups: Array<() => void> = []
  try {
    await runtime.restore()
    const tool = defineTool({
      name: TEAMMATE_ROLE_TOOL_NAME,
      description:
        'Create a named Team member using a role from the current role catalog. Use only when the user explicitly requests Agent Teams or teammates; only the Team Lead can create members. The role instructions and configured model apply; the member starts without this conversation. Returns a Team target, not a subagent or job id. Use native Team tools to message, interrupt, list and assign tasks to it; reuse an existing member for follow-up work. Without a matching role, use spawn_teammate.',
      parameters: {
        agent: { type: 'string', required: true, description: 'Exact role name from the current role catalog.' },
        name: { type: 'string', required: true, description: 'Unique lower-kebab-case Team member name, distinct from the reusable role name.' },
        description: { type: 'string', required: true, description: 'Short description of this member responsibility.' },
        prompt: {
          type: 'string',
          required: true,
          description: 'Complete standalone task, context, expected result and write boundaries. The member does not inherit this conversation.'
        },
        provider: { type: 'string', description: 'LLM provider, paired with model to override the role route. This is not the Team transport provider.' },
        model: { type: 'string', description: 'Exact model id, paired with provider. Omit both to use the role route or inherit the Lead route.' },
        reasoning_effort: { type: 'string', description: 'Optional adapter-owned reasoning effort. An explicit call route without effort uses that model default.' }
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            target: { type: 'string', required: true },
            roleId: { type: 'string', required: true },
            provider: { type: 'string', required: true },
            model: { type: 'string', required: true },
            reasoningEffort: { type: 'string' }
          }
        },
        render: (_args, value) => [{ type: 'text', text: `created role teammate ${value.target} on ${value.provider}/${value.model}` }]
      },
      isConcurrencySafe: () => true,
      async execute(args, exec) {
        const parent = exec.agent
        if (!parent) throw new Error('spawn_teammate_role requires a calling agent')
        exec.signal.throwIfAborted()
        if (ctx.agentTeams.membership(parent).role !== 'lead') throw new Error('only the Team Lead can create role teammates')
        const { entry, policy } = await resolveRolePolicy(listRoles, args.agent, parent)
        const options = await resolveAgentOptions(
          policy,
          {
            ...(args.provider === undefined ? {} : { provider: args.provider }),
            ...(args.model === undefined ? {} : { model: args.model }),
            ...(args.reasoning_effort === undefined ? {} : { reasoningEffort: args.reasoning_effort })
          },
          parent,
          ctx.llm,
          exec.signal,
          args.agent,
          message => ctx.logger.warn(message)
        )
        // The role resolver validates effort with the live adapter; brand it only at this host boundary.
        const effective = resolveChildAgentOptions(parent, options as AgentOptions | undefined, parent.session.header.delegationDepth ?? 0)
        if (!effective.provider || !effective.model) throw new Error('role teammate requires an effective provider and model')
        return runtime.spawn(
          parent,
          args,
          {
            roleId: entry.name,
            persona: policy.content,
            route: {
              provider: effective.provider,
              model: effective.model,
              ...(effective.reasoningEffort === undefined ? {} : { reasoningEffort: effective.reasoningEffort })
            }
          },
          exec.signal
        )
      }
    })
    cleanups.push(ctx.tools.register(tool))
    cleanups.push(
      mountSubagentCatalog(
        ctx,
        tool,
        async (agent, signal) =>
          ctx.agentTeams.tryMembership(agent as Agent)?.role === 'lead'
            ? agentRoleCatalog(await listRoles(agent), signal, message => ctx.logger.warn(message), sessionCwd(agent))
            : [],
        'spawn_teammate_role'
      )
    )
    return async () => {
      for (const off of cleanups.splice(0).reverse()) off()
      await runtime.dispose()
    }
  } catch (error) {
    for (const off of cleanups.reverse()) off()
    await runtime.dispose()
    throw error
  }
}
