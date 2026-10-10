/** Role composition over public Team creation and awaited Agent initialization. */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection, type Agent, type ModelSelection } from '@deepseek-ai/dsh-agent'
import type { TeamService } from '@deepseek-ai/dsh-experimental-agent-team'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import { foldSubagentDescriptor, type SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { z } from 'zod'

const PROVIDER = 'market-role-team'
export const TEAM_ROLE_SOURCE = 'teammate-role-binding'
const routeSchema = z.object({ provider: z.string().min(1), model: z.string().min(1), reasoningEffort: z.string().min(1).optional() }).strict()
const snapshotSchema = z.object({ roleId: z.string().min(1), persona: z.string(), route: routeSchema }).strict()
const bindingSchema = snapshotSchema.extend({ version: z.literal(1), childId: z.string().min(1) }).strict()
export type TeammateRoleSnapshot = z.infer<typeof snapshotSchema>
type Binding = z.infer<typeof bindingSchema>
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** The known user/message envelope keeps this plugin-owned creation snapshot replayable. */
    'teammate-role-binding': { kind: 'teammate-role-binding'; form: 'context'; binding: Binding }
  }
}
interface PendingRole {
  parent: Agent
  name: string
  /** Exact catalog name the creating call used; display only, never a durable binding field. */
  role: string
  snapshot: TeammateRoleSnapshot
  childId?: SessionId
  initialized: boolean
}
export interface RoleTeammateRequest {
  name: string
  description: string
  prompt: string
  /** Model-facing role name from the catalog, so the member reads a role rather than its encoded id. */
  agent?: string
}
export interface RoleTeammateResult {
  target: string
  roleId: string
  provider: string
  model: string
  reasoningEffort?: string
}

/** The teammate's own orientation, mirroring the host's native teammate wrapper. */
function memberIdentity(member: string, role: string): string {
  return [
    '<system-reminder>',
    '',
    `You are teammate ${JSON.stringify(member)}.`,
    'Your Team Lead is addressed as "lead".',
    'Use list_agents({}) to find your teammates and their names.',
    'To message your Team Lead, use send_message({ target: "lead", message: "..." }).',
    'To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).',
    ...(role === '' ? [] : [`Your role is ${role}. The role instructions are applied to your system prompt.`]),
    '',
    '</system-reminder>'
  ].join('\n')
}

/** Route fields a live Agent exposes; the host type marks them readonly while the object stays writable. */
interface WritableRoute {
  provider?: string
  model?: string
  reasoningEffort?: string
}

/**
 * Record the role route on the member's own `AgentOptions`.
 *
 * The host Team creation request carries no per-member route, so the child
 * Agent starts with the Lead's route. Host surfaces read this object rather
 * than the model selection: the Team roster shows it, the image-input gate
 * checks it, and the member's own delegation inherits it. A host that freezes
 * the object is reported and keeps the model selection, which still routes
 * every request.
 * @param agent - the member's live Agent.
 * @param route - the validated route from the creation snapshot.
 * @param diagnose - diagnostic sink for a host that refuses the write.
 * @returns the disposer that restores the inherited values.
 */
function applyRoleRoute(agent: Agent, route: TeammateRoleSnapshot['route'], diagnose: (message: string) => void): () => void {
  const options = agent.options as WritableRoute
  const inherited: WritableRoute = { provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort }
  const write = (next: WritableRoute): boolean => {
    try {
      options.provider = next.provider
      options.model = next.model
      if (next.reasoningEffort === undefined) delete options.reasoningEffort
      else options.reasoningEffort = next.reasoningEffort
      return true
    } catch {
      return false
    }
  }
  if (!write(route)) {
    diagnose(`role teammate ${agent.id}: AgentOptions is not writable, so the host reports the inherited route`)
    return () => {}
  }
  return () => {
    write(inherited)
  }
}

/** Creation and replay keep role data out of task text and never mutate the Lead's route. */
export class TeammateRoleRuntime {
  private readonly teams: TeamService
  private readonly subagents: SubagentRuntime
  private readonly pending = new AsyncLocalStorage<PendingRole>()
  private readonly stop = new AbortController()
  private readonly registrations: Array<() => void> = []
  private readonly compositions = new Map<Agent, () => void>()
  private readonly creations = new Set<Promise<RoleTeammateResult>>()
  private readonly initializing = new Map<Agent, Promise<void>>()
  private disposal?: Promise<void>

  constructor(private readonly ctx: Context) {
    this.teams = ctx.get('agentTeams') as TeamService
    this.subagents = ctx.get('subagents') as SubagentRuntime
    this.registrations.push(
      this.subagents.registerProvider({
        name: PROVIDER,
        inheritsParentContext: false,
        capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
        start: () => Promise.reject(new Error('role teammates require Team continuation')),
        prepareContinuable: request => {
          const pending = this.pending.getStore()
          if (this.stop.signal.aborted || !pending || pending.parent !== request.parent || pending.childId !== undefined)
            throw new Error('role teammate creation has no matching role binding')
          pending.childId = request.sessionId
          return Promise.resolve({})
        }
      })
    )
    this.registrations.push(
      ctx.on('agent/created', async ({ agent, signal }) => {
        await this.initialize(agent, signal)
      })
    )
    this.registrations.push(
      ctx.on('agent/disposed', ({ agent }) => {
        this.compositions.get(agent)?.()
        this.compositions.delete(agent)
      })
    )
  }

  /** Reattach immutable role snapshots after a plugin reload, before exposing its creation tool. */
  async restore(): Promise<void> {
    for (const agent of this.ctx.agents.list()) await this.initialize(agent, this.stop.signal)
  }

  /** Resolve after native Team admission; use the returned target with native Team management tools. */
  spawn(parent: Agent, request: RoleTeammateRequest, snapshot: TeammateRoleSnapshot, signal: AbortSignal): Promise<RoleTeammateResult> {
    this.stop.signal.throwIfAborted()
    signal.throwIfAborted()
    if (!request.prompt.trim()) return Promise.reject(new Error('spawn_teammate_role requires a non-empty prompt'))
    const membership = this.teams.membership(parent)
    if (membership.role !== 'lead') return Promise.reject(new Error('only the Team Lead can create role teammates'))
    const pending: PendingRole = {
      parent,
      name: request.name,
      role: request.agent?.trim() ?? '',
      snapshot: snapshotSchema.parse(snapshot),
      initialized: false
    }
    const operation = this.pending.run(pending, async () => {
      const result = await this.teams.spawnTeammate(parent, {
        name: request.name,
        description: request.description,
        prompt: [{ type: 'text', text: request.prompt }],
        context: 'fresh',
        provider: PROVIDER,
        signal: AbortSignal.any([signal, this.stop.signal])
      })
      if (!pending.initialized || result.member.id !== pending.childId) throw new Error('role teammate was not initialized before Team admission')
      return { target: result.member.name, roleId: pending.snapshot.roleId, ...pending.snapshot.route }
    })
    this.creations.add(operation)
    void operation.finally(() => this.creations.delete(operation)).catch(() => {})
    return operation
  }

  private initialize(agent: Agent, signal?: AbortSignal): Promise<void> {
    const existing = this.initializing.get(agent)
    if (existing) return existing
    const operation = this.initializeOnce(agent, signal)
    this.initializing.set(agent, operation)
    void operation.finally(() => this.initializing.delete(agent)).catch(() => {})
    return operation
  }

  private async initializeOnce(agent: Agent, signal?: AbortSignal): Promise<void> {
    if (this.compositions.has(agent)) return
    const query = this.ctx.get('sessionQuery') as SessionQueryEngine
    const observation = await query.observeSession(agent.id, { projectionMode: 'none', ...(signal === undefined ? {} : { signal }) })
    let events
    try {
      events = observation.events.filter(event => event.seq >= observation.inheritedEventCount)
    } finally {
      observation[Symbol.dispose]()
    }
    const descriptor = foldSubagentDescriptor(events)
    if (descriptor?.provider !== PROVIDER) return
    this.stop.signal.throwIfAborted()
    signal?.throwIfAborted()
    const messages = events.flatMap(event => (event.type === 'user/message' ? [event.data] : event.type === 'agent/inbox/spliced' ? event.data.inserted : []))
    const sources = new Map(messages.filter(message => message.source.kind === TEAM_ROLE_SOURCE).map(message => [message.id, message.source]))
    const records = [...sources.values()].map(source => (source.kind === TEAM_ROLE_SOURCE ? source.binding : undefined))
    if (records.length > 1) throw new Error('role teammate has multiple role bindings')
    let binding: Binding
    if (records.length === 1) {
      binding = bindingSchema.parse(records[0])
      if (binding.childId !== agent.id) throw new Error('role binding belongs to another teammate')
    } else {
      const pending = this.pending.getStore()
      const membership = this.teams.tryMembership(agent)
      if (!pending || pending.initialized || pending.childId !== agent.id || membership?.root !== pending.parent || membership.name !== pending.name) {
        throw new Error('role teammate has no durable or in-flight role binding')
      }
      binding = { version: 1, childId: agent.id, ...pending.snapshot }
      agent.inject(
        createUserMessage({
          source: { kind: TEAM_ROLE_SOURCE, form: 'context', binding },
          content: [{ type: 'text', text: memberIdentity(membership.name, pending.role) }]
        })
      )
      if (!(await this.ctx.sessions.flush(agent.session))) throw new Error('role teammate requires session persistence')
      pending.initialized = true
    }
    signal?.throwIfAborted()
    this.stop.signal.throwIfAborted()
    const prompt = agent.ctx.get('systemPrompt') as SystemPrompt
    const offPersona = prompt.section({ name: 'deployment:persona-prefix', order: prompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'), text: binding.persona, interpolate: false })
    const offRoute = applyRoleRoute(agent, binding.route, message => this.ctx.logger?.warn(message))
    let offModel: (() => void) | undefined
    try {
      offModel = installModelSelection(agent.ctx, { current: binding.route as ModelSelection, assembled: undefined })
    } catch (error) {
      offRoute()
      offPersona()
      throw error
    }
    this.compositions.set(agent, () => {
      offModel?.()
      offPersona()
      offRoute()
    })
  }

  /** Stop owned role work before removing its scoped configuration; native Team records stay authoritative. */
  dispose(): Promise<void> {
    return (this.disposal ??= this.finishDisposal())
  }
  private async finishDisposal(): Promise<void> {
    this.stop.abort('role teammate plugin disposed')
    // Keep initialization guards installed while draining, so concurrent cold
    // resumes cannot start without the role composition during teardown.
    await Promise.allSettled([...this.creations, ...this.initializing.values()])
    const byParent = new Map<Agent, SessionId[]>()
    for (const agent of this.compositions.keys()) {
      const parentId = agent.session.header.parentSession
      const parent = parentId === undefined ? undefined : this.ctx.agents.get(parentId)
      if (parent !== undefined) byParent.set(parent, [...(byParent.get(parent) ?? []), agent.id])
    }
    try {
      await Promise.all([...byParent].map(([parent, ids]) => this.subagents.drainContinuableChildren(parent, ids)))
    } finally {
      for (const off of this.registrations.splice(0).reverse()) off()
      for (const off of this.compositions.values()) off()
      this.compositions.clear()
      this.pending.disable()
    }
  }
}
